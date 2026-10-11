import test from 'node:test'
import assert from 'node:assert/strict'
import { createVoiceSessions } from '../host/voice-sessions.js'

test('with no session selected, no result counts as waiting elsewhere', () => {
  const sessions = createVoiceSessions()
  sessions.seen('session-a')
  assert.deepEqual(sessions.waiting(['session-a']), [])
  sessions.select('session-b', '/p/codex-voice-mod')
  assert.deepEqual(sessions.waiting(['session-a', 'session-b']), [{ sessionId: 'session-a', folder: '' }])
})
