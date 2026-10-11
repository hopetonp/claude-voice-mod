import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { probeRealtimeConnection } from '../host/realtime-diagnostics.js'
import { probeRealtimeAudioTools } from '../host/sts-audio-diagnostic.js'

test('connection diagnostic waits for Composer session readiness without opening a coding task', async () => {
  const socket = new EventEmitter()
  const sent = []
  socket.readyState = WebSocket.OPEN
  socket.send = text => sent.push(JSON.parse(text))
  socket.terminate = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const checking = probeRealtimeConnection('xai', { key: 'secret', model: 'model', voice: 'voice' }, {
    providers: { xai: { create: settings => {
      assert.deepEqual(settings.tools, [])
      assert.equal(settings.startupHistory, undefined)
      return { url: 'wss://example.test', headers: {}, setup: { type: 'session.update' },
        decode: value => [value] }
    } } },
    makeSocket: () => socket,
  })
  socket.emit('open')
  assert.deepEqual(sent, [{ type: 'session.update' }])
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })), false)
  assert.equal(await checking, true)
  assert.equal(socket.readyState, WebSocket.CLOSED)
})

test('connection diagnostic rejects incomplete settings before opening a socket', async () => {
  assert.throws(() => probeRealtimeConnection('gemini', { key: '', model: 'model', voice: 'voice' }),
    /Configure a realtime provider/)
})

test('audio-and-tool diagnostic verifies a simulated tool receipt and two spoken replies', async () => {
  const socket = new EventEmitter(), sent = []
  socket.readyState = WebSocket.OPEN
  socket.send = text => sent.push(JSON.parse(text))
  socket.terminate = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const checking = probeRealtimeAudioTools('xai', { key: 'secret', model: 'model', voice: 'voice' }, {
    providers: { xai: { create: config => {
      assert.equal(config.tools[0].name, 'dispatch_coding_task')
      return { url: 'wss://example.test', headers: {}, setup: { type: 'session.update' },
        encode: value => [value], decode: value => [value] }
    } } }, makeSocket: () => socket,
  })
  const receive = value => socket.emit('message', Buffer.from(JSON.stringify(value)), false)
  socket.emit('open')
  receive({ type: 'session.updated' })
  assert.equal(sent.some(value => value.type === 'response.create'), true)
  receive({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call',
    name: 'dispatch_coding_task', call_id: 'call-1', arguments: '{"instruction":"check fixture"}' }] } })
  assert.equal(sent.some(value => value.item?.type === 'function_call_output'), true)
  receive({ type: 'response.output_audio.delta', delta: 'AAA=' })
  receive({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } })
  assert.equal(sent.some(value => value.item?.content?.[0]?.text?.includes('completed successfully')), true)
  receive({ type: 'response.output_audio.delta', delta: 'AAA=' })
  receive({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } })
  assert.equal(await checking, true)
})

test('GPT Live diagnostic requires delegation, audio, spoken confirmation, and acknowledged close', async () => {
  const socket = new EventEmitter(), sent = []
  socket.readyState = WebSocket.OPEN
  socket.send = text => sent.push(JSON.parse(text))
  socket.terminate = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const checking = probeRealtimeAudioTools('openai-live', { key: 'secret', model: 'model', voice: 'voice' }, {
    providers: { 'openai-live': { create: () => ({ url: 'wss://example.test', headers: {},
      setup: { type: 'session.update' }, decode: value => [value] }) } }, makeSocket: () => socket,
  })
  const receive = value => socket.emit('message', Buffer.from(JSON.stringify(value)), false)
  socket.emit('open')
  receive({ type: 'session.updated' })
  assert.equal(sent.some(value => value.type === 'session.input_audio.append'), true)
  receive({ type: 'voice.live-delegation', id: 'delegation-1' })
  assert.equal(sent.some(value => value.type === 'session.commentary.append'), true)
  receive({ type: 'session.output_audio.delta', delta: 'AAAA' })
  receive({ type: 'voice.live-transcript', role: 'assistant', delta: 'The voice test is ready.' })
  assert.equal(sent.some(value => value.type === 'session.close'), true)
  receive({ type: 'session.closed' })
  assert.equal(await checking, true)
})

test('Gemini diagnostic lets Composer schedule the tool-result response', async () => {
  const socket = new EventEmitter(), sent = []
  socket.readyState = WebSocket.OPEN
  socket.send = text => sent.push(JSON.parse(text))
  socket.terminate = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const checking = probeRealtimeAudioTools('gemini', { key: 'secret', model: 'model', voice: 'voice' }, {
    providers: { gemini: { toolResponseStartsResponse: true, create: () => ({ url: 'wss://example.test', headers: {},
      setup: { type: 'session.update' }, encode: value => [value], decode: value => [value] }) } },
    makeSocket: () => socket,
  })
  const receive = value => socket.emit('message', Buffer.from(JSON.stringify(value)), false)
  socket.emit('open')
  receive({ type: 'session.updated' })
  const before = sent.filter(value => value.type === 'response.create').length
  receive({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call',
    name: 'dispatch_coding_task', call_id: 'call-1', arguments: '{"instruction":"check fixture"}' }] } })
  assert.equal(sent.some(value => value.item?.type === 'function_call_output'), true)
  assert.equal(sent.filter(value => value.type === 'response.create').length, before)
  socket.terminate()
  assert.equal(await checking, false)
})
