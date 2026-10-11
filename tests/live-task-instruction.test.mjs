import assert from 'node:assert/strict'
import test from 'node:test'
import { latestLiveUserRequest } from '../host/live-task-instruction.js'

test('delegation forwards only the newest user request', () => {
  assert.equal(latestLiveUserRequest([
    { role: 'user', text: 'Read the README' },
    { role: 'assistant', text: 'The title is Claude Voice Mod.' },
    { role: 'user', text: '  What did Claude change?  ' },
  ]), 'What did Claude change?')
})

test('delegation rejects transcript history without a user request', () => {
  assert.throws(() => latestLiveUserRequest([
    { role: 'assistant', text: 'Hello' },
  ]), /no user request/)
})
