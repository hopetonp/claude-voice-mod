import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompletionOutbox } from '../hooks/completion-outbox.js'

const result = { id: 'request-one', sessionId: 'session-one', turnId: 'turn-one', status: 'complete', text: 'Done.' }

test('a failed completion survives a Mod reload and is retried without resubmission', async () => {
  let stored = []
  const offline = createCompletionOutbox({ load: async () => stored, save: async rows => { stored = rows },
    deliver: async () => { throw new Error('Host restarting') } })
  await offline.queue(result)
  assert.deepEqual(stored, [result])
  const sent = []
  const reloaded = createCompletionOutbox({ load: async () => stored, save: async rows => { stored = rows },
    deliver: async item => { sent.push(item) } })
  await reloaded.flush()
  assert.deepEqual(sent, [result])
  assert.deepEqual(stored, [])
})

test('an acknowledgement lost after recording is retried, and one failed item cannot block another', async () => {
  let stored = []
  const received = new Map()
  const next = { ...result, id: 'request-two', turnId: 'turn-two' }
  const outbox = createCompletionOutbox({ load: async () => stored, save: async rows => { stored = rows },
    deliver: async item => {
      const count = (received.get(item.id) ?? 0) + 1
      received.set(item.id, count)
      if (item.id === result.id && count < 3) throw new Error('Lost acknowledgement')
    } })
  await outbox.queue(result)
  await outbox.queue(next)
  assert.equal(received.get(next.id), 1)
  assert.deepEqual(stored, [result])
  await outbox.flush()
  assert.deepEqual(stored, [])
})
