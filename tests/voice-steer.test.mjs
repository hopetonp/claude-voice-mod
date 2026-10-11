import assert from 'node:assert/strict'
import test from 'node:test'
import { interruptedPrompt } from '../host/voice-steer.js'

test('an interruption reaches Claude with the request it interrupted', () => {
  const prompt = interruptedPrompt('Fix the bubble spacing', 'stop')
  assert.match(prompt, /interrupted/i)
  assert.match(prompt, /Fix the bubble spacing/)
  assert.match(prompt, /"stop"/)
})

test('stop words halt the work; anything else is a note for the running work', async () => {
  const { isStopRequest } = await import('../host/voice-steer.js')
  for (const said of ['stop', 'Stop that.', 'no, wait', 'Um, cancel it', 'never mind', 'hold on a second', "don't do that"]) {
    assert.equal(isStopRequest(said), true, said)
  }
  for (const said of ['also update the README', 'use tabs instead', 'make sure the tests pass', 'stopwatch should be in the header']) {
    assert.equal(isStopRequest(said), false, said)
  }
})

test('notes the turn never read become the next request, and a stop outranks them', async () => {
  const { addSteer, steerFollowUp } = await import('../host/voice-steer.js')
  let pending = addSteer(null, { id: 'a', parentId: 'task', previous: 'Fix the bubbles', said: 'also check the spacing' })
  assert.equal(pending.kind, 'note')
  pending = addSteer(pending, { id: 'b', parentId: 'task', previous: 'Fix the bubbles', said: 'and the colours' })
  const followUp = steerFollowUp(pending)
  assert.equal(followUp.id, 'b')
  assert.match(followUp.text, /"also check the spacing" then "and the colours"/)
  assert.match(followUp.text, /Fix the bubbles/)
  pending = addSteer(pending, { id: 'c', parentId: 'task', previous: 'Fix the bubbles', said: 'actually stop' })
  assert.equal(pending.kind, 'stop')
  assert.match(steerFollowUp(pending).text, /interrupted/)
  assert.equal(steerFollowUp({ ...pending, notes: [] }), null)
})
