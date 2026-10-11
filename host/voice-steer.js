/** Spoken interruptions of a running Claude turn. Composer steers the host while a task runs; the
 * host decides how what was said reaches Claude:
 * - a stop: the Mod cancels the turn and Claude reads `interruptedPrompt` next;
 * - anything else: a note the Mod hands Claude after its next tool call, without stopping it. A note
 *   the turn never reached (it ended first, or sat in one long command) becomes the next request. */

// "stop", "no, wait", "cancel that", "never mind": words that halt the work rather than redirect it.
const STOP = /^(?:(?:no|okay|ok|um+|uh+|hey|actually|claude|please)[\s,.!]+)*(?:stop|cancel|abort|halt|quit|wait|hold on|hang on|never ?mind|forget it|scratch that|don'?t do (?:that|it))\b/i

export function isStopRequest(said) {
  return STOP.test(said.trim())
}

/** The prompt Claude receives after its turn was cancelled, so it knows what was interrupted and why. */
export function interruptedPrompt(previous, said) {
  return `The user interrupted your previous voice request while you were working on it.\n`
    + `Previous request: "${previous}"\n`
    + `What they said now: "${said}"\n`
    + 'If they asked you to stop or cancel, stop and confirm briefly. Otherwise carry out what they said now.'
}

/** What Claude reads after a tool result while it keeps working. It says plainly what it is. */
export function steerNote(said) {
  return `[voice] The user spoke aloud while you were working on their voice request. `
    + `Transcribed speech, relayed verbatim: "${said}". `
    + 'Fold it into the work in progress: adjust, add to, or stop it as they said.'
}

/** Notes the turn never read: it finished first, so they become the next request. */
export function followUpPrompt(previous, said) {
  return `While you were working on the user's voice request, they added something you had not seen yet.\n`
    + `Previous request: "${previous}"\n`
    + `What they added: ${said.map(text => `"${text}"`).join(' then ')}\n`
    + 'Carry it out now, building on what you already did.'
}

/** Adds one spoken interruption to the pending steer of the running task; a stop outranks notes. */
export function addSteer(pending, { id, parentId, previous, said }) {
  const current = pending?.parentId === parentId ? pending : { id, parentId, previous, kind: 'note', notes: [] }
  const notes = [...current.notes, { id, text: said }].slice(-8)
  return { ...current, notes, kind: current.kind === 'stop' || isStopRequest(said) ? 'stop' : 'note' }
}

/** The task a pending steer becomes once the steered turn has ended, or null when nothing is left. */
export function steerFollowUp(pending) {
  if (!pending?.notes.length) return null
  const said = pending.notes.map(note => note.text)
  const text = pending.kind === 'stop' ? interruptedPrompt(pending.previous, said.join(' ')) : followUpPrompt(pending.previous, said)
  return { id: pending.notes.at(-1).id, text }
}
