import { randomUUID } from 'node:crypto'

export const updateCheckMessage = 'Check whether an update is available for the VoiceMesh Voice Mod. Report the installed and latest available versions. Do not install an update unless I ask.'

/** A settings request is claimed once by the Claude chat that opened settings. */
export function createUpdateChecks() {
  const pending = new Map()
  return {
    request(sessionId) {
      if (!sessionId) throw new Error('Open a Claude chat with VoiceMesh first')
      if (!pending.has(sessionId)) pending.set(sessionId, { id: randomUUID(), sessionId, text: updateCheckMessage })
      return pending.get(sessionId)
    },
    get(sessionId) { return pending.get(sessionId) ?? null },
    claim(sessionId, id) {
      const request = pending.get(sessionId)
      if (!request || request.id !== id) return null
      pending.delete(sessionId)
      return request
    },
  }
}
