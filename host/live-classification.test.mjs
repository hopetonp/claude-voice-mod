import assert from 'node:assert/strict'
import test from 'node:test'
import { liveClassification } from './voice-server.js'

test('GPT Live classifier follows the optional harness setting', async () => {
  const disabled = { classifier: () => ({ enabled: false }) }
  assert.equal(liveClassification(disabled), undefined)

  const enabled = { classifier: () => ({ enabled: true }) }
  let received
  const routing = liveClassification(enabled, async (...args) => {
    received = args
    return 'voice'
  })
  const signal = new AbortController().signal
  assert.equal(await routing.classify('hello', 'user: hello', signal), 'voice')
  assert.deepEqual(received, [enabled, 'hello', 'user: hello', signal])
  assert.match(routing.voice, /Answer the latest user request/)
  assert.match(routing.unavailable, /not sent this request to Claude/)
})
