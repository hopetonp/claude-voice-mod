import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { createStreamingCaptions } from '../host/streaming-captions.js'
import { attachRealtimeVoice } from '../host/realtime-voice.js'

test('streaming captions use the same key, stream interim text, bound startup buffering, and close on stop', () => {
  const socket = new EventEmitter(), sent = [], previews = []
  socket.readyState = WebSocket.OPEN; socket.bufferedAmount = 0
  socket.send = raw => sent.push(JSON.parse(raw))
  let closes = 0, failures = 0
  socket.close = () => { closes++; socket.emit('close') }
  const abort = new AbortController()
  const stream = createStreamingCaptions({ key: 'same-gemini-key', model: 'gemini-3.5-transcribe-live',
    signal: abort.signal, preview: text => previews.push(text), failed: () => failures++,
    connect(url, options) { assert.ok(!url.includes('same-gemini-key'))
      assert.equal(options.headers['x-goog-api-key'], 'same-gemini-key'); return socket } })
  const receive = event => socket.emit('message', Buffer.from(JSON.stringify(event)))
  stream.push('audio'); socket.emit('open')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].setup.model, 'models/gemini-3.5-transcribe-live')
  assert.deepEqual(sent[0].setup.inputAudioTranscription.languageCodes, [])
  receive({ setupComplete: {} })
  assert.equal(sent[1].realtimeInput.audio.data, 'audio')
  receive({ serverContent: { interimInputTranscription: { text: 'I am' } } })
  receive({ serverContent: { interimInputTranscription: { text: 'I am speaking' } } })
  assert.deepEqual(previews, ['I am', 'I am speaking'])
  stream.suppress()
  receive({ serverContent: { inputTranscription: { text: 'I am speaking.' } } })
  assert.equal(previews.length, 2, 'late preview must not replace conversation final text')
  receive({ voiceActivity: { voiceActivityType: 'ACTIVITY_START' } })
  receive({ serverContent: { interimInputTranscription: { text: 'Next sentence' } } })
  assert.equal(previews.at(-1), 'Next sentence')
  abort.abort(); assert.equal(closes, 1); assert.equal(failures, 0)
  stream.push('ignored'); assert.equal(sent.length, 2)
  const queuedSocket = new EventEmitter()
  queuedSocket.readyState = WebSocket.OPEN; queuedSocket.close = () => {}
  const bounded = createStreamingCaptions({ key: 'key', model: 'gemini-3.5-transcribe-live',
    signal: new AbortController().signal, preview() {}, failed: () => failures++, connect: () => queuedSocket })
  bounded.push('x'.repeat(256 * 1024 + 1)); assert.equal(failures, 1)
})

test('optional caption stream is off by default and never enters coding or history', async () => {
  for (const enabled of [false, true]) {
    const socket = new EventEmitter(), sent = [], history = [], pushes = []
    socket.readyState = WebSocket.OPEN; socket.bufferedAmount = 0
    socket.send = raw => sent.push(JSON.parse(raw))
    socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
    let releaseChannel
    const opening = new Promise(resolve => { releaseChannel = resolve })
    let owner, factoryCalls = 0, preview, closed = 0, suppressed = 0
    attachRealtimeVoice(socket, {
      selectedProvider: () => 'gemini', get: () => ({ key: 'same-key', model: 'gemini-3.8-live', voice: 'Charon',
        streamingCaptions: enabled, captionModel: 'gemini-3.5-transcribe-live' }),
    }, { states: () => [], owed: () => [] }, () => {}, async row => history.push(row), () => [], {
      providers: { gemini: { id: 'gemini' } }, userName: () => '',
      openChannel: async (_settings, inbound) => { owner = inbound
        await opening
        return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) } },
      createStreamingCaptions(options) { factoryCalls++; assert.equal(options.key, 'same-key'); preview = options.preview
        return { push: audio => pushes.push(audio), suppress() { suppressed++ }, close() { closed++ } } },
    })
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'gemini' })))
    await new Promise(setImmediate)
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'queued-pcm' })))
    releaseChannel(); await new Promise(setImmediate)
    assert.equal(factoryCalls, Number(enabled))
    if (enabled) {
      preview('Words arriving now')
      assert.ok(sent.some(event => event.transcript === 'Words arriving now'))
      assert.equal(history.length, 0, 'preview is display-only')
      socket.emit('message', Buffer.from(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'pcm' })))
      assert.deepEqual(pushes, ['queued-pcm', 'pcm'])
      await owner.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'official', transcript: 'Official words.' })
      assert.equal(history.length, 1); assert.equal(history[0].text, 'Official words.')
      assert.equal(suppressed, 1)
    }
    socket.close(); await new Promise(setImmediate)
    assert.equal(closed, Number(enabled))
  }
})
