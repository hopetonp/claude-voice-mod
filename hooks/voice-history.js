const normalized = text => text.trim().replace(/\s+/g, ' ').toLowerCase()
// The voice's listening sounds while the user talks (GPT Live says these mid-sentence): one or two of them.
const LISTENING = /^(?:(?:m+|m+-?h+m+|mhm+|uh-?huh|hmm+)[.!?,]?\s*){1,2}$/i
const listening = row => row.role === 'assistant' && LISTENING.test(row.text.trim())

// The live line (live-line.js) shows a turn while it is spoken; the history gets each turn once, whole,
// when it has ended. Providers differ too much to post earlier: GPT Live grows a caption word by word
// and slips listening sounds into the user's turn; xAI sends speech seconds apart and calls captions
// complete early.

// A finished reply waits briefly for its last caption words.
const ASSISTANT_SETTLE_MS = 1200
// A later row ends the user's turn only once the user's words have been still this long, so a
// listening sound ("Mm-hmm") in the middle of the user's speech does not end it.
const USER_QUIET_MS = 1500
// The voice hands a coding request over just after its first words ("Checking."), and that request
// shows as its own prompt; so a user turn waits until shortly after the reply's caption ends.
const HANDOVER_MS = 500
// With a reply under way, or voice idle, a still user turn ends after this long.
const USER_HOLD_MS = 2500
// A live session with no reply: a still user turn ends after this long. Long enough for xAI, which
// sends a turn's words in bursts about 3 s apart; a longer pause only splits the turn, since words added
// after a bubble is written become a bubble of their own.
const USER_ALONE_MS = 4000

// One row per caption id.
export class VoiceHistory {
  constructor() { this.rows = []; this.classifierEnabled = false }

  /**
   * `at` is when the caption was spoken (the provider's clock, via the host). Rows sit in that order,
   * so words transcribed late still come before a reply that began after them. A row already written
   * never moves; without `at` a row goes last, in arrival order.
   */
  observe(role, id, text, now = Date.now(), at = undefined) {
    if (!['user', 'assistant'].includes(role) || !id || !text?.trim()) return
    // A caption may span several rows: GPT Live keeps adding the user's words to one caption while the
    // voice does not answer, and the words after a written bubble start a row of their own at `from`.
    let row = this.rows.findLast(item => item.source === id && item.role === role)
    const grown = row?.delivered && !row.delegated && role === 'user' && text.slice(row.end).trim()
    if (!row || grown) {
      const from = grown ? row.end : 0
      const spoken = Number.isFinite(at) ? at : grown ? row.at : undefined
      let index = this.rows.length
      if (spoken !== undefined) {
        while (index > 0 && !this.rows[index - 1].delivered && this.rows[index - 1].at > spoken) index--
      }
      const previous = this.rows[index - 1]
      // A new turn at the end finishes the one before it; words that belong earlier interrupt nothing.
      if (index === this.rows.length && previous && !previous.delivered && !previous.finished) {
        previous.finished = true
        previous.finishedAt = now
      }
      row = { role, id: from ? `${id}+${from}` : id, source: id, from, full: '', text: '', posted: 0, shown: 0, at: spoken,
        createdAt: now, changedAt: now, finished: false, finishedAt: 0, delivered: false, delegated: false }
      this.rows.splice(index, 0, row)
      // The voice's first reply after a hand-off is drawn under the request (see `attach`).
      if (role === 'assistant' && this.waiting && !LISTENING.test(text.trim()) && this.rows.indexOf(this.waiting.after) < index
        && !this.rows.slice(this.rows.indexOf(this.waiting.after) + 1, index).some(item => item.role === 'user')) {
        row.note = this.waiting.key
        this.waiting = null
      }
      if (role === 'user' && this.waiting && this.rows.indexOf(this.waiting.after) < index) this.waiting = null
    }
    if (Number.isFinite(at) && !row.delivered && !(row.at <= at)) row.at = at
    if (row.full !== text && !row.delivered) {
      row.full = text
      row.text = text.slice(row.from, row.from + 4000)
      row.changedAt = now
      if (row.finished && role === 'assistant') row.finishedAt = now
    }
    if (this.rows.length > 128) this.rows.splice(0, this.rows.length - 128)
    return row
  }

  /** This role's turn is over (for the user: voice went idle, so no reply is coming). */
  finish(role, now = Date.now()) {
    const row = [...this.rows].reverse().find(item => item.role === role && !item.delivered)
    if (row && !row.finished) {
      row.finished = true
      row.finishedAt = now
    }
    if (row) row.ended = true
  }

  /**
   * The request `key` (the prompt text) goes to Claude now. Everything said before the request is over,
   * so it is closed and can be written first. The voice's reply that follows the request is its note:
   * drawn under the request, never a bubble of its own, since a bubble posted now would land after
   * Claude's work. A reply not begun yet becomes the note when it begins, unless the user speaks first.
   */
  attach(key, now = Date.now(), captionIds = null) {
    const request = normalized(key)
    const turn = this.requestRow(request, captionIds)
    if (!turn) return
    const index = this.rows.indexOf(turn)
    for (const row of this.rows.slice(0, index)) {
      if (row.delivered) continue
      if (row.role === 'assistant') this.complete(row, now)
      else row.closed = true
    }
    const replies = []
    let alreadyReplied = false
    for (const row of this.rows.slice(index + 1)) {
      if (row.role === 'user') break
      if (row.role !== 'assistant' || listening(row)) continue
      alreadyReplied = true
      if (!row.delivered && !row.note && !row.delegated) replies.push(row)
    }
    for (const row of replies) row.note = key
    this.waiting = alreadyReplied ? null : { key, after: turn }
  }

  /** The voice spoke about Claude's progress: no later reply is the hand-off's. */
  stopWaiting() { this.waiting = null }

  /** The note under request `key`: the voice's words so far. */
  note(key) {
    return this.rows.filter(row => row.note === key).map(row => row.text.trim()).filter(Boolean).join(' ')
  }

  /** The provider marked this caption final. Trusted for the voice's replies; ignored for user speech. */
  complete(row, now = Date.now()) {
    if (row.delivered) return
    if (!row.finished) row.finishedAt = now
    row.finished = true
    row.complete = true
  }

  /**
   * The voice handed this request to Claude. Unwritten user rows it covers are never written, so the
   * prompt is the one copy. Returns the words already written as a bubble for it, or null.
   */
  handOff(instruction, captionIds = null) {
    const request = normalized(instruction)
    let written = null
    for (const row of this.rows) {
      if (row.role !== 'user' || (!request && !captionIds?.length)) continue
      const text = normalized(row.text)
      if (!text || !(captionIds?.length ? captionIds.includes(row.source)
        : request.includes(text) || text.includes(request))) continue
      row.pendingDelegation = false
      if (row.delivered && !row.delegated) written = row.text.trim()
      else row.delegated = true
    }
    return written
  }

  /** The first spoken reply to a coding request, once playback ends or Composer finalizes it. */
  handoffReply(instruction, captionIds = null) {
    const request = normalized(instruction)
    const turn = this.requestRow(request, captionIds)
    if (!turn) return null
    const reply = this.rows.slice(this.rows.indexOf(turn) + 1)
      .find(item => item.role === 'assistant' && !listening(item))
    return { turn, reply, ready: !!(reply?.complete || reply?.ended) }
  }

  requestRow(request, captionIds = null) {
    return this.rows.findLast(item => item.role === 'user' && item.text.trim()
      && (captionIds?.length ? captionIds.includes(item.source)
        : request && (request.includes(normalized(item.text)) || normalized(item.text).includes(request))))
  }

  /** A finished voice answer, including one after a later user turn, resolves older voice-only speech. */
  hasCompletedReplyAfter(turn) {
    for (const row of this.rows.slice(this.rows.indexOf(turn) + 1)) {
      if (row.role === 'assistant' && (row.complete || row.ended) && !listening(row)) return true
    }
    return false
  }

  markDelegated(instruction) {
    const request = normalized(instruction)
    for (const row of this.rows) {
      if (row.role === 'user' && request && (request.includes(normalized(row.text)) || normalized(row.text).includes(request))) {
        row.delegated = true
      }
    }
  }

  ended(row, now) {
    if (row.closed) return true
    if (row.role === 'assistant') return row.finished && (row.complete || now >= row.finishedAt + ASSISTANT_SETTLE_MS)
    // The turn ends at the voice's first real reply. A listening sound is never one, even when it
    // lands in a pause the user then talks on from; nor are more of the user's own words.
    const reply = this.rows.slice(this.rows.indexOf(row) + 1).find(item => item.role === 'assistant' && !listening(item))
    const still = now - row.changedAt
    if (reply) {
      return still >= USER_QUIET_MS && (reply.delivered || (reply.finished && now >= reply.finishedAt + HANDOVER_MS) || still >= USER_HOLD_MS)
    }
    return still >= (row.ended ? USER_HOLD_MS : USER_ALONE_MS)
  }

  /** The oldest unwritten turn, once it has ended; turns are written in order. */
  next(now = Date.now()) {
    const row = this.rows.find(item => !item.delivered)
    // Classification and task admission are events, not a duration. Until the host reports a
    // decision, this user's caption also holds back the voice's following acknowledgement.
    if (row?.pendingDelegation || (row?.role === 'user' && this.classifierEnabled
      && !row.routingResolved && !row.delegated)) return null
    if (row?.role === 'assistant') {
      // A listening sound is consumed without a bubble once the user turn before it is written.
      const index = this.rows.indexOf(row)
      const user = this.rows.slice(0, index).reverse().find(item => item.role === 'user')
      if (listening(row) && (!user || user.delivered)) {
        return { row, text: '', final: true, from: 0, quiet: true }
      }
    }
    if (!row || !(row.delegated || this.ended(row, now))) return null
    // A note is drawn under its request, so it is written without a bubble once it has ended.
    if (row.note) return { row, text: '', final: true, from: 0, quiet: true, note: row.note }
    if (row.role === 'user' && !row.delegated) {
      // The user's words with no reply between them are one turn, one bubble, however the provider split them.
      const rows = [row]
      for (const item of this.rows.slice(this.rows.indexOf(row) + 1)) {
        if (item.role !== 'user' || item.delivered || item.delegated) break
        // A later utterance is not a continuation merely because the voice gave no reply.
        if (Number.isFinite(item.at) && Number.isFinite(rows.at(-1).at)
          && item.at - rows.at(-1).at > USER_ALONE_MS) break
        rows.push(item)
      }
      if (!rows.every(item => this.ended(item, now))) return null
      return { row, rows, text: rows.map(item => item.text.trim()).join(' '), first: true, final: true, from: 0 }
    }
    return { row, text: row.text.trim(), first: true, final: true, from: 0 }
  }

  posted(piece) { for (const row of piece.rows ?? [piece.row]) this.delivered(row) }

  delivered(row) {
    row.delivered = true
    row.shown = row.posted = row.text.length
    row.end = row.from + row.text.length
  }

  /** The part of the user's live caption that is not yet written as a bubble; all of it when unrelated. */
  unwritten(transcript) {
    const row = this.rows.findLast(item => item.role === 'user')
    if (!row) return transcript
    const written = row.delivered ? row.full.slice(0, row.end) : row.full.slice(0, row.from)
    if (written && transcript.length > written.length && transcript.startsWith(written)) return transcript.slice(written.length).trim()
    if (row.from && transcript.startsWith(row.full.slice(0, row.from))) return transcript.slice(row.from).trim()
    return transcript
  }
}

/** The words a hand-off prompt adds after the bubble already written for that turn, or ''. */
export function extraWords(written, prompt) {
  const shown = written.trim()
  const asked = prompt.trim()
  if (!shown || asked.length <= shown.length || !normalized(asked).startsWith(normalized(shown))) return ''
  return asked.slice(shown.length).trim()
}
