import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpokenStopRouter } from '../host/spoken-stop.js'

function harness(options) {
  let state = { requestId: 'coding-one', status: 'running' }
  const steers = [], dispatched = []
  const router = createSpokenStopRouter({
    states: () => [state],
    async steer(id, input) { steers.push({ id, ...input }); return [state] },
    async dispatch(id, input) { dispatched.push({ id, ...input }); return { requestId: id } },
  }, () => {}, options)
  return { router, steers, dispatched, state: value => { state = value } }
}

test('the observed stop reaches coding from a final caption without any model delegation', async () => {
  const h = harness()
  const caption = { id: 'speech-one', role: 'user', phase: 'final', text: 'Actually, can you stop? Stop' }
  await h.router.caption(caption)
  assert.equal(h.steers.length, 1)
  assert.equal(h.steers[0].instruction, caption.text)
  assert.equal(h.dispatched.length, 0)
  await h.router.caption({ ...caption, text: caption.text + ' that.' })
  h.state({ requestId: 'coding-one', status: 'stopped' })
  await h.router.tasks.dispatch('late-model-call', { instruction: caption.text })
  assert.equal(h.steers.length, 1, 'a revised caption and late model call cannot stop twice')
  assert.equal(h.dispatched.length, 0, 'late delegation cannot create another coding task')
  h.state({ requestId: 'coding-two', status: 'running' })
  await h.router.caption({ ...caption, id: 'speech-two' })
  assert.equal(h.steers.length, 2, 'a later coding task can be stopped normally')
})

test('interim speech, assistant speech, voice controls, explanations, and idle sessions do not auto-cancel', async () => {
  const h = harness()
  for (const caption of [
    { role: 'user', phase: 'update', text: 'Stop' },
    { role: 'assistant', phase: 'final', text: 'Stop' },
    ...['Stop voice', 'Stop using tabs', "Why didn't the coding agent stop?", 'do not stop'].map(text => ({ role: 'user', phase: 'final', text })),
  ]) await h.router.caption({ id: 'speech', ...caption })
  h.state({ requestId: 'coding-one', status: 'completed' })
  await h.router.caption({ id: 'idle-stop', role: 'user', phase: 'final', text: 'Stop' })
  assert.deepEqual(h.steers, [])
})

test('concurrent final caption and model stop share one cancellation', async () => {
  const h = harness()
  await Promise.all([
    h.router.caption({ id: 'speech', role: 'user', phase: 'final', text: 'Can you stop?' }),
    h.router.tasks.steer('model-call', { instruction: 'Can you stop?' }),
  ])
  assert.equal(h.steers.length, 1)
})


test('actual LiveDelegation caption shape cancels while the voice conversation is still open', async () => {
  const h = harness({ quietMs: 10 })
  // LiveDelegation.transcript() returns {type, role, text, id}, with no phase.
  await h.router.caption({ type: 'voice.live-caption', role: 'user', id: 'live-stop',
    text: "Actually stop, please. Don't do that anymore. Change my mind" })
  assert.equal(h.steers.length, 0)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(h.steers.length, 1, 'stop reaches coding without close() or any final caption')
  assert.match(h.steers[0].instruction, /Actually stop/)
  h.router.close()
})

test('live stop wait is cancelled by continuing speech, conversation close, or a different coding task', async () => {
  for (const next of ['continuation', 'close', 'new-task']) {
    const h = harness({ quietMs: 10 })
    await h.router.caption({ role: 'user', id: 'live-stop', text: 'Stop' })
    if (next === 'continuation') await h.router.caption({ role: 'user', id: 'live-stop', text: 'Stop voice' })
    if (next === 'close') h.router.close()
    if (next === 'new-task') h.state({ requestId: 'new-task', status: 'running' })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(h.steers.length, 0, next)
    h.router.close()
  }
})
