import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { prepareTranscriptHistory } from '@voicemesh/composer'

const normalized = text => text.trim().replace(/\s+/g, ' ').toLowerCase()
const validRow = row => row && typeof row === 'object' && !Array.isArray(row)
  && typeof row.sessionId === 'string' && row.sessionId.length > 0 && row.sessionId.length <= 256
  && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128
  && ['user', 'assistant'].includes(row.role)
  && typeof row.text === 'string' && row.text.length <= 4000
  && Number.isSafeInteger(row.createdRevision) && row.createdRevision > 0
  && Number.isSafeInteger(row.revision) && row.revision >= row.createdRevision
  && typeof row.delegated === 'boolean'
  && (row.final === undefined || typeof row.final === 'boolean')
  && (row.spokenAt === undefined || Number.isFinite(row.spokenAt))
  && (row.conversationId === undefined || (typeof row.conversationId === 'string' && row.conversationId.length <= 128))

// How a spoken turn was routed, as the host saw it happen: `pending` from the voice's delegation until
// classification or admission resolves; `coding` only once the request is filed for Claude (`requestId`
// is that task's id); `superseded` when a later turn settled first; `closed` when the call ended first.
export const TURN_STATES = ['pending', 'voice', 'clarify', 'coding', 'unavailable', 'rejected',
  'missing-transcript', 'superseded', 'closed']
const validTurn = turn => turn && typeof turn === 'object' && !Array.isArray(turn)
  && typeof turn.sessionId === 'string' && turn.sessionId.length > 0 && turn.sessionId.length <= 256
  && typeof turn.id === 'string' && turn.id.length > 0 && turn.id.length <= 128
  && TURN_STATES.includes(turn.state) && Number.isFinite(turn.offsetAt)
  && Number.isSafeInteger(turn.revision) && turn.revision > 0
  && (turn.conversationId === undefined || (typeof turn.conversationId === 'string' && turn.conversationId.length <= 128))

/** Durable provider-neutral caption rows, owned by this harness and keyed to Claude sessions. */
export async function createTranscriptLedger(path) {
  let state = { revision: 0, rows: [], turns: [] }
  try {
    const loaded = JSON.parse(await readFile(path, 'utf8'))
    if (!loaded || !Number.isSafeInteger(loaded.revision) || loaded.revision < 0
      || !Array.isArray(loaded.rows) || loaded.rows.length > 1024 || !loaded.rows.every(validRow)
      || (loaded.turns !== undefined && (!Array.isArray(loaded.turns) || loaded.turns.length > 1024 || !loaded.turns.every(validTurn)))) {
      throw new Error('Invalid saved VoiceMesh transcript ledger')
    }
    state = { ...loaded, turns: loaded.turns ?? [] }
  } catch (error) { if (error.code !== 'ENOENT') throw error }

  let tail = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify(state) + '\n'
    const operation = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(path), `.transcript-${randomUUID()}`)
      try {
        await writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
    })
    tail = operation.catch(() => {})
    return operation
  }
  // A voice socket cannot survive a host restart. Close turns left pending by an abrupt stop
  // so an old call cannot hold the next call's captions behind a routing decision forever.
  const interrupted = state.turns.filter(turn => turn.state === 'pending')
  if (interrupted.length) {
    for (const turn of interrupted) {
      turn.state = 'closed'
      turn.settledAt = Date.now()
      turn.revision = ++state.revision
    }
    await persist()
  }
  // In the order things were said. Rows saved before `spokenAt` existed are older than any with it.
  const rows = sessionId => state.rows.filter(row => row.sessionId === sessionId)
    .sort((a, b) => (a.spokenAt ?? 0) - (b.spokenAt ?? 0) || a.createdRevision - b.createdRevision)
  const turns = sessionId => state.turns.filter(turn => turn.sessionId === sessionId)
    .map(({ sessionId: _owner, conversationId: _call, ...turn }) => ({ ...turn, userCaptionIds: [...(turn.userCaptionIds ?? [])] }))
  const revision = sessionId => [...rows(sessionId), ...state.turns.filter(turn => turn.sessionId === sessionId)]
    .reduce((latest, item) => Math.max(latest, item.revision), 0)
  const history = sessionId => prepareTranscriptHistory(
    rows(sessionId).map(({ role, text }) => ({ role, text })),
    { maxBytes: 8192, maxMessages: 127 },
  )
  const prune = sessionId => {
    const own = rows(sessionId)
    if (own.length > 128) {
      const old = new Set(own.slice(0, own.length - 128).map(row => row.createdRevision))
      state.rows = state.rows.filter(row => row.sessionId !== sessionId || !old.has(row.createdRevision))
    }
    if (state.rows.length > 1024) state.rows = state.rows.slice(-1024)
  }

  async function record(sessionId, caption, delegatedText = '') {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256
      || !caption || typeof caption.id !== 'string' || !caption.id || caption.id.length > 128
      || !['user', 'assistant'].includes(caption.role) || typeof caption.text !== 'string') return
    const text = caption.text.slice(0, 4000)
    if (!text.trim()) return
    const delegated = caption.role === 'user' && delegatedText.trim()
      && (normalized(delegatedText).includes(normalized(text)) || normalized(text).includes(normalized(delegatedText)))
    // Composer's `final` phase marks the utterance complete; a final row stays final.
    const final = caption.phase === 'final'
    // When it was spoken, from the provider; a provider without it is ordered by arrival.
    const at = Number.isFinite(caption.at) ? caption.at : undefined
    let row = state.rows.find(item => item.sessionId === sessionId && item.id === caption.id && item.role === caption.role)
    const earlier = row && at !== undefined && !(row.spokenAt <= at)
    if (row?.text === text && (!delegated || row.delegated) && (!final || row.final) && !earlier) return
    const nextRevision = ++state.revision
    if (row) {
      row.text = text; row.revision = nextRevision; row.delegated ||= !!delegated; row.final ||= final
      if (earlier) row.spokenAt = at
    } else {
      row = { sessionId, id: caption.id, role: caption.role, text, delegated: !!delegated, final,
        spokenAt: at ?? Date.now(), createdRevision: nextRevision, revision: nextRevision,
        // The voice call it was spoken in, so a call's turns never claim another call's captions.
        ...(typeof caption.conversationId === 'string' && caption.conversationId ? { conversationId: caption.conversationId.slice(0, 128) } : {}) }
      state.rows.push(row)
      prune(sessionId)
    }
    await persist()
  }

  async function markDelegated(sessionId, instruction) {
    if (typeof instruction !== 'string' || !instruction.trim()) return
    const request = normalized(instruction)
    const row = rows(sessionId).reverse().find(item => item.role === 'user' && item.text.trim() &&
      (request.includes(normalized(item.text)) || normalized(item.text).includes(request)))
    if (!row || row.delegated) return
    row.delegated = true
    row.revision = ++state.revision
    await persist()
  }

  /** Record a coding admission in the same route ledger used by realtime voice. */
  async function recordCodingRoute(sessionId, requestId, instruction, fallbackLatest = false) {
    if (!sessionId || !requestId || !instruction?.trim()) return null
    const existing = state.turns.find(turn => turn.sessionId === sessionId && turn.requestId === requestId)
    if (existing) return existing
    const request = normalized(instruction)
    const users = rows(sessionId).filter(row => row.role === 'user' && row.text.trim())
    const matched = users.findLast(row => request.includes(normalized(row.text)) || normalized(row.text).includes(request))
    const row = matched ?? (fallbackLatest ? users.at(-1) : null)
    const turn = { sessionId, id: `pipeline:${requestId}`.slice(0, 128), state: 'coding',
      offsetAt: row?.spokenAt ?? Date.now(), requestId, userCaptionIds: row ? [row.id] : [],
      revision: ++state.revision }
    state.turns.push(turn)
    if (state.turns.length > 1024) state.turns = state.turns.slice(-1024)
    await persist()
    return turn
  }

  /**
   * The voice delegated a spoken turn: its routing is pending. `offsetAt` is on the captions' `spokenAt`
   * clock; `conversationId` names the voice call, whose captions alone the turn can cover.
   */
  async function openTurn(sessionId, id, offsetAt, conversationId) {
    if (typeof sessionId !== 'string' || !sessionId || typeof id !== 'string' || !id || id.length > 128
      || !Number.isFinite(offsetAt) || state.turns.some(turn => turn.sessionId === sessionId && turn.id === id)) return
    state.turns.push({ sessionId, id, state: 'pending', offsetAt, revision: ++state.revision,
      ...(typeof conversationId === 'string' && conversationId ? { conversationId: conversationId.slice(0, 128) } : {}) })
    const own = state.turns.filter(turn => turn.sessionId === sessionId)
    if (own.length > 64) {
      const old = new Set(own.slice(0, own.length - 64))
      state.turns = state.turns.filter(turn => !old.has(turn))
    }
    if (state.turns.length > 1024) state.turns = state.turns.slice(-1024)
    await persist()
  }

  // The user's captions in a turn: spoken in the same voice call, after that call's previous turn's
  // offset (the call's start for its first turn), up to and including its own offset.
  const captionsOf = (sessionId, turn) => {
    const call = item => item.conversationId === turn.conversationId
    const own = state.turns.filter(item => item.sessionId === sessionId && call(item))
    const before = own.slice(0, own.indexOf(turn)).at(-1)?.offsetAt ?? -Infinity
    return rows(sessionId).filter(row => row.role === 'user' && call(row) && Number.isFinite(row.spokenAt)
      && row.spokenAt > before && row.spokenAt <= turn.offsetAt).map(row => row.id)
  }

  const settled = (sessionId, turn, outcome, at) => {
    turn.state = outcome.state
    turn.settledAt = at
    if (outcome.requestId) turn.requestId = outcome.requestId
    if (outcome.mode) turn.mode = outcome.mode
    turn.userCaptionIds = captionsOf(sessionId, turn)
    turn.revision = ++state.revision
  }

  /**
   * The turn's routing resolved: `{ state, requestId?, mode? }`. Turns before it still pending were dropped
   * by the voice library (a later delegation replaces one not yet admitted), so they become `superseded`;
   * one that later resolves after all takes its real state.
   */
  async function settleTurn(sessionId, id, outcome, now = Date.now()) {
    if (!outcome || !TURN_STATES.includes(outcome.state) || ['pending', 'superseded', 'closed'].includes(outcome.state)) return null
    const own = state.turns.filter(turn => turn.sessionId === sessionId)
    const turn = own.find(item => item.id === id)
    if (!turn || !['pending', 'superseded', 'closed'].includes(turn.state)) return null
    for (const earlier of own.slice(0, own.indexOf(turn))) {
      if (earlier.state === 'pending') settled(sessionId, earlier, { state: 'superseded' }, now)
    }
    settled(sessionId, turn, outcome, now)
    await persist()
    return turns(sessionId).find(item => item.id === id)
  }

  /** The voice call ended: turns still pending will never resolve. */
  async function closeTurns(sessionId, now = Date.now()) {
    const open = state.turns.filter(turn => turn.sessionId === sessionId && turn.state === 'pending')
    for (const turn of open) settled(sessionId, turn, { state: 'closed' }, now)
    if (open.length) await persist()
  }

  return { rows, revision, history, record, markDelegated, recordCodingRoute, turns, openTurn, settleTurn, closeTurns }
}
