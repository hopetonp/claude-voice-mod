import assert from 'node:assert/strict'
import test from 'node:test'
import { quietGate, quietNotes } from '../host/voice-server.js'

const tick = () => new Promise(setImmediate)

test('the hand-off notice waits until the voice has finished speaking', async () => {
  const quiet = quietGate()
  const sent = []
  const send = quietNotes(async message => { sent.push(message.type); return true }, quiet)
  quiet.set(true)
  const notice = send({ type: 'session.thinking.append', content: 'The coding request was admitted.' }, () => true)
  await tick()
  assert.deepEqual(sent, [], 'held while the voice speaks')
  quiet.set(false)
  assert.equal(await notice, true)
  assert.deepEqual(sent, ['session.thinking.append'])
})

test('notes go straight out while the voice is silent, and other messages never wait', async () => {
  const quiet = quietGate()
  const sent = []
  const send = quietNotes(async message => { sent.push(message.type); return true }, quiet)
  await send({ type: 'session.thinking.append', content: 'Claude request completed.' }, () => true)
  quiet.set(true)
  await send({ type: 'session.commentary.append', content: 'Done.' }, () => true)
  assert.deepEqual(sent, ['session.thinking.append', 'session.commentary.append'])
})

test('a held notice is dropped if it stops being current, and closing frees it', async () => {
  const quiet = quietGate()
  const sent = []
  const send = quietNotes(async message => { sent.push(message.type); return true }, quiet)
  quiet.set(true)
  let current = true
  const notice = send({ type: 'session.thinking.append', content: 'x' }, () => current)
  current = false
  quiet.release()
  assert.equal(await notice, false)
  assert.deepEqual(sent, [])
})
