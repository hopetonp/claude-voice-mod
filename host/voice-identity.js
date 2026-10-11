import { createHash } from 'node:crypto'

/** Stable ID for one provider event inside one Claude-owned voice conversation. */
export function scopedVoiceId(kind, sessionId, conversationId, providerId) {
  if (!['request', 'caption', 'turn'].includes(kind) || !sessionId || !conversationId || !providerId) {
    throw new Error('Invalid voice event identity')
  }
  return `${kind}:${createHash('sha256').update(JSON.stringify([sessionId, conversationId, providerId])).digest('hex')}`
}
