import assert from 'node:assert/strict'
import test from 'node:test'
import { scopedVoiceId } from '../host/voice-identity.js'

test('the same provider event cannot collide across voice conversations or Claude sessions', () => {
  const first = scopedVoiceId('request', 'claude-one', 'conversation-one', 'provider-7')
  assert.equal(first, scopedVoiceId('request', 'claude-one', 'conversation-one', 'provider-7'))
  assert.notEqual(first, scopedVoiceId('request', 'claude-one', 'conversation-two', 'provider-7'))
  assert.notEqual(first, scopedVoiceId('request', 'claude-two', 'conversation-one', 'provider-7'))
  assert.notEqual(first, scopedVoiceId('caption', 'claude-one', 'conversation-one', 'provider-7'))
  assert(first.length <= 128)
})
