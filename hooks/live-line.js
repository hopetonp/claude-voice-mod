// The live line: who is talking right now and their newest words, drawn in the voice strip while the
// turn is spoken. The history only gets the turn once it has ended (voice-history.js).

// The voice's listening sounds ("Mm-hmm") arrive while the user is still talking, so the line stays on
// the user until the user's words have been still this long.
export const USER_QUIET_MS = 1500
// After the last words change, the line stays this long so the end of a turn can still be read.
export const LINE_LINGER_MS = 2000
const OFF = ['offline', 'idle', 'standby', 'error', 'needs-activation', 'connecting']

/** What the live line shows now, or null for nothing. */
export function liveLine({ transcript = '', lastReply = '', userChangedAt = 0, replyChangedAt = 0, phase = 'idle' }, now) {
  if (OFF.includes(phase)) return null
  const user = transcript.trim()
  const reply = lastReply.trim()
  const userTalking = !!user && now - userChangedAt < USER_QUIET_MS
  const voiceTurn = !!reply && replyChangedAt > userChangedAt && !userTalking
  const pick = voiceTurn ? { speaker: 'Voice', text: reply, at: replyChangedAt }
    : user ? { speaker: 'You', text: user, at: userChangedAt } : null
  if (!pick || now - pick.at >= LINE_LINGER_MS) return null
  return { speaker: pick.speaker, text: pick.text }
}

/** The newest words that fit in `columns`, cut at a word and led by "…" when anything is dropped. */
export function tail(text, columns) {
  if (columns <= 0) return ''
  if (text.length <= columns) return text
  const end = text.slice(text.length - (columns - 1))
  const space = end.indexOf(' ')
  const words = space >= 0 && space < end.length - 1 ? end.slice(space + 1) : end
  return `…${words}`
}
