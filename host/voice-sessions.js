// Which Claude session owns the voice: the one the desktop app last attached to (the user's selection).
// Every session's plugin checks in while it runs, so results owed to a closed session are not announced.

const SESSION_GONE_MS = 60000

export function createVoiceSessions({ now = Date.now } = {}) {
  let selected = null
  const known = new Map() // sessionId -> { folder, cwd, seenAt }
  const touch = (sessionId, cwd) => {
    const previous = known.get(sessionId)
    const given = typeof cwd === 'string' && cwd ? cwd : previous?.cwd ?? ''
    known.set(sessionId, { folder: given.split('/').filter(Boolean).at(-1) ?? '', cwd: given, seenAt: now() })
  }
  return {
    select(sessionId, cwd) {
      touch(sessionId, cwd)
      if (selected === sessionId) return false
      selected = sessionId
      return true
    },
    selected: () => selected,
    // A session checking in is alive; one the host has not seen select since a restart is known by id only.
    seen(sessionId) { touch(sessionId) },
    folder: sessionId => known.get(sessionId)?.folder ?? '',
    cwd: sessionId => known.get(sessionId)?.cwd ?? '',
    waiting(owedSessionIds) {
      if (!selected) return []
      return [...new Set(owedSessionIds)]
        .filter(id => id !== selected && known.has(id) && now() - known.get(id).seenAt < SESSION_GONE_MS)
        .map(id => ({ sessionId: id, folder: known.get(id).folder }))
    },
  }
}
