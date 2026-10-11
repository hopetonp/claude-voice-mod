import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { attachRealtimeVoice } from '../host/realtime-voice.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('optional realtime classifier advises the voice model before any coding dispatch', async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const sent = []
  let owner, offered
  let dispatches = 0
  const classify = async (_store, utterance) => {
    assert.equal(utterance, 'Read the README')
    return 'coding'
  }
  attachRealtimeVoice(socket, {
    selectedProvider: () => 'gemini', classifier: () => ({ enabled: true }),
    get: () => ({ key: 'test-key', model: 'test-model', voice: 'test-voice' }),
  }, {
    states: () => [], owed: () => [], async played() {},
    async dispatch() { dispatches++; return { requestId: 'unexpected' } },
  }, () => {}, async () => {}, () => [], {
    providers: { gemini: { id: 'gemini', toolResponseStartsResponse: true } }, classify,
    openChannel: async (settings, inbound) => {
      offered = settings.tools
      owner = inbound
      return { send: async event => sent.push(event), close: async () => {}, closed: new Promise(() => {}) }
    },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'gemini' })))
  await flush()
  assert.ok(offered.some(tool => tool.name === 'classify_spoken_request'))
  await owner.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'spoken-1', transcript: 'Read the README' })
  await owner.receive({ type: 'response.done', response: { id: 'route', status: 'completed', output: [
    { type: 'function_call', call_id: 'classifier-1', name: 'classify_spoken_request', arguments: '{}' },
    { type: 'function_call', call_id: 'premature-code', name: 'dispatch_coding_task', arguments: '{"instruction":"Read the README"}' },
  ] } })
  await flush()
  const result = sent.find(event => event.type === 'voice.tool-results')
  assert.ok(result)
  assert.equal(JSON.parse(result.items[0].output).route, 'coding')
  assert.equal(dispatches, 0, 'same-response dispatch must wait for classification advice')
  await owner.receive({ type: 'response.done', response: { id: 'after-route', status: 'completed', output: [
    { type: 'function_call', call_id: 'code-after-route', name: 'dispatch_coding_task',
      arguments: '{"instruction":"Read the README"}' },
  ] } })
  await flush()
  assert.equal(dispatches, 1, 'coding dispatch follows the classifier result')
  socket.close()
})

test('OpenAI Realtime delegates to Claude and marks the WebRTC result after playback', async () => {
  const socket = new EventEmitter()
  const outgoing = []
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = text => outgoing.push(JSON.parse(text))
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const sendBrowser = event => socket.emit('message', Buffer.from(JSON.stringify(event)))
  const sentToComposer = []
  const captions = []
  let owner, connected
  let owed = []
  const dispatches = [], played = []
  const tasks = {
    states: () => dispatches.length ? [{ requestId: 'scoped-call', status: 'running' }] : [],
    async dispatch(id, args) { dispatches.push({ id, args }); return { requestId: 'scoped-call' } },
    owed: () => owed,
    async played(turn) { played.push(turn); owed = []; return true },
  }
  const store = {
    selectedProvider: () => 'openai',
    get: () => ({ key: 'test-key', model: 'test-model', voice: 'test-voice', responseDetail: 'concise' }),
  }
  const provider = { id: 'openai', toolResponseStartsResponse: false,
    webrtc: { connect: async () => ({ connection: {}, answer: 'test-answer', close: async () => {} }) } }
  attachRealtimeVoice(socket, store, tasks, live => { connected = live },
    async caption => { captions.push(caption) }, () => [], {
      providers: { openai: provider },
      transcriptionModels: async () => ['whisper-1'],
      openChannel: async (_settings, inbound) => {
        owner = inbound
        return { send: async event => { sentToComposer.push(event) }, close: async () => {}, closed: new Promise(() => {}) }
      },
    })
  sendBrowser({ type: 'start', provider: 'openai', offer: 'test-offer' })
  await flush()
  assert.ok(outgoing.some(event => event.type === 'ready'))
  await owner.receive({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{
    type: 'function_call', call_id: 'call-1', name: 'dispatch_coding_task', arguments: '{"instruction":"Inspect the README"}',
  }] } })
  await flush()
  assert.deepEqual(dispatches, [{ id: 'call-1', args: { instruction: 'Inspect the README' } }])
  assert.ok(sentToComposer.some(event => event.type === 'conversation.item.create'
    && event.item.type === 'function_call_output'))
  await owner.receive({ type: 'response.created', response: { id: 'ack' } })
  await owner.receive({ type: 'response.done', response: { id: 'ack', status: 'completed', output: [] } })
  assert.equal(await connected.milestone('I am checking the README.', () => true), true)
  assert.ok(sentToComposer.some(event => event.type === 'conversation.item.create'
    && event.item.content?.[0]?.text?.includes('I am checking the README.')))
  await owner.receive({ type: 'response.created', response: { id: 'milestone' } })
  await owner.receive({ type: 'response.done', response: { id: 'milestone', status: 'completed', output: [{
    type: 'function_call', call_id: 'unexpected', name: 'dispatch_coding_task',
    arguments: '{"instruction":"Do not dispatch this"}',
  }] } })
  sendBrowser({ type: 'voice.playback-idle', responseId: 'milestone' })
  await flush()
  assert.equal(dispatches.length, 1, 'a milestone reply must not dispatch another coding task')
  owed = [{ playbackId: 7, id: 'scoped-call', status: 'complete', text: 'The README title is Claude Voice Mod.' }]
  await connected.replayOwed()
  assert.ok(sentToComposer.some(event => event.type === 'conversation.item.create'
    && event.item.content?.[0]?.text?.includes('Claude Voice Mod')))
  await owner.receive({ type: 'response.created', response: { id: 'result' } })
  // WebRTC playback emits a buffer-start event, not audio deltas on the sideband.
  await owner.receive({ type: 'output_audio_buffer.started', response_id: 'result' })
  await owner.receive({ type: 'response.output_audio_transcript.done', response_id: 'result', transcript: 'Done.' })
  await owner.receive({ type: 'response.done', response: { id: 'result', status: 'completed', output: [{ type: 'message' }] } })
  sendBrowser({ type: 'voice.playback-caption', responseId: 'result', length: 5, final: true, interrupted: false })
  sendBrowser({ type: 'voice.playback-idle', responseId: 'result' })
  await flush()
  assert.deepEqual(played, [7])
  assert.ok(captions.some(row => row.role === 'assistant' && row.text === 'Done.'))
  socket.close()
})

test('Gemini tool results use Composer automatic response scheduling', async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const sent = []
  let owner
  attachRealtimeVoice(socket, {
    selectedProvider: () => 'gemini',
    get: () => ({ key: 'test-key', model: 'test-model', voice: 'test-voice' }),
  }, {
    states: () => [], owed: () => [], async played() {},
    async dispatch() { return { requestId: 'scoped-gemini' } },
  }, () => {}, async () => {}, () => [], {
    providers: { gemini: { id: 'gemini', toolResponseStartsResponse: true } },
    openChannel: async (_settings, inbound) => {
      owner = inbound
      return { send: async event => sent.push(event), close: async () => {}, closed: new Promise(() => {}) }
    },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'gemini' })))
  await flush()
  await owner.receive({ type: 'response.done', response: { id: 'gemini-tool', status: 'completed', output: [{
    type: 'function_call', call_id: 'gemini-call', name: 'dispatch_coding_task', arguments: '{"instruction":"Inspect code"}',
  }] } })
  await flush()
  assert.equal(sent.filter(event => event.type === 'voice.tool-results').length, 1)
  assert.equal(sent.filter(event => event.type === 'response.create').length, 0)
  socket.close()
})

test('spoken end closes voice without dispatching or stopping Claude work', async () => {
  const socket = new EventEmitter()
  const outgoing = []
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = text => outgoing.push(JSON.parse(text))
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  let owner, dispatches = 0
  const tasks = {
    states: () => [], owed: () => [], async played() {},
    async dispatch() { dispatches++; throw new Error('Unexpected coding request') },
  }
  attachRealtimeVoice(socket, {
    selectedProvider: () => 'xai',
    get: () => ({ key: 'test-key', model: 'test-model', voice: 'test-voice', endConversationEnabled: true }),
  }, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: false } },
    openChannel: async (settings, inbound) => {
      owner = inbound
      assert.ok(settings.tools.some(tool => tool.name === 'end_conversation'))
      return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) }
    },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'xai' })))
  await flush()
  await owner.receive({ type: 'response.done', response: { id: 'goodbye', status: 'completed', output: [{
    type: 'function_call', call_id: 'end-1', name: 'end_conversation', arguments: '{ }',
  }] } })
  assert.equal(outgoing.filter(event => event.type === 'voice.conversation-ended').length, 1)
  assert.equal(dispatches, 0)
  socket.close()
})

test('a playback caption for an ordinary reply stays in the host and keeps the voice session open', async () => {
  const socket = new EventEmitter()
  const outgoing = []
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = text => outgoing.push(JSON.parse(text))
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const sendBrowser = event => socket.emit('message', Buffer.from(JSON.stringify(event)))
  const sentToComposer = []
  let owner
  const tasks = { states: () => [], async dispatch() { return {} }, owed: () => [], async played() { return true } }
  const store = { selectedProvider: () => 'xai', get: () => ({ key: 'k', model: 'm', voice: 'v', responseDetail: 'concise' }) }
  attachRealtimeVoice(socket, store, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: true } },
    transcriptionModels: async () => [],
    openChannel: async (_settings, inbound) => {
      owner = inbound
      // Like Composer's provider channels, an unknown page event is not a provider command.
      return { send: async event => {
        if (String(event.type).startsWith('voice.playback')) throw new Error(`Unsupported command ${event.type}`)
        sentToComposer.push(event)
      }, close: async () => {}, closed: new Promise(() => {}) }
    },
  })
  sendBrowser({ type: 'start', provider: 'xai' })
  await flush()
  await owner.receive({ type: 'response.created', response: { id: 'answer' } })
  sendBrowser({ type: 'voice.playback-caption', responseId: 'answer', length: 3, final: false, interrupted: false })
  await flush()
  assert.ok(!sentToComposer.some(event => event.type === 'voice.playback-caption'), 'the caption is not a provider command')
  assert.ok(!outgoing.some(event => event.type === 'voice.error'), 'the session reports no error')
  assert.equal(socket.readyState, WebSocket.OPEN, 'the voice session stays open')
  socket.close()
})

test("the realtime path hands Claude the user's latest spoken line, not the model's rewrite", async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  let owner
  const dispatched = []
  const tasks = { states: () => [], owed: () => [], async played() { return true },
    async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const store = { selectedProvider: () => 'xai', get: () => ({ key: 'k', model: 'm', voice: 'v', responseDetail: 'concise' }) }
  attachRealtimeVoice(socket, store, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: true } },
    transcriptionModels: async () => [],
    openChannel: async (_settings, inbound) => { owner = inbound; return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) } },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'xai' })))
  await flush()
  await owner.receive({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'u1', transcript: 'Can you check why the bubble splits?' })
  await owner.receive({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{
    type: 'function_call', call_id: 'call-1', name: 'dispatch_coding_task', arguments: '{"instruction":"User reports that bubbles split."}',
  }] } })
  await flush(); await flush()
  assert.deepEqual(dispatched, ['Can you check why the bubble splits?'])
  socket.close()
})

// A xAI session wired to a recording task ledger; returns what Claude was handed.
async function spokenHarness() {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  let owner
  const dispatched = []
  const tasks = { states: () => [], owed: () => [], async played() { return true },
    async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const store = { selectedProvider: () => 'xai', get: () => ({ key: 'k', model: 'm', voice: 'v', responseDetail: 'concise' }) }
  attachRealtimeVoice(socket, store, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: true } },
    transcriptionModels: async () => [],
    openChannel: async (_settings, inbound) => { owner = inbound; return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) } },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'xai' })))
  await flush()
  const said = (id, transcript) => owner.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript })
  const started = id => owner.receive({ type: 'input_audio_buffer.speech_started', item_id: id })
  const answered = async id => {
    await owner.receive({ type: 'response.created', response: { id } })
    await owner.receive({ type: 'response.done', response: { id, status: 'completed', output: [{ type: 'message' }] } })
  }
  const dispatch = async (id, instruction) => {
    await owner.receive({ type: 'response.done', response: { id, status: 'completed', output: [{
      type: 'function_call', call_id: `call-${id}`, name: 'dispatch_coding_task', arguments: JSON.stringify({ instruction }),
    }] } })
    await flush(); await flush()
  }
  return { socket, dispatched, said, started, answered, dispatch }
}

test('a conversation turn the voice answered is not handed to Claude with the next dispatch', async () => {
  const { socket, dispatched, said, started, answered, dispatch } = await spokenHarness()
  await started('u1'); await said('u1', 'How are you today?')
  await answered('chat')
  await started('u2'); await said('u2', 'Fix the bug in the parser.')
  await dispatch('tool', 'User wants the parser fixed.')
  assert.deepEqual(dispatched, ['Fix the bug in the parser.'])
  socket.close()
})

test('a transcript that arrives after the voice answered that item is not handed over later', async () => {
  const { socket, dispatched, said, started, answered, dispatch } = await spokenHarness()
  await started('u1')
  await answered('chat')
  await said('u1', 'How are you today?')
  await started('u2')
  await dispatch('tool', 'User wants the parser fixed.')
  assert.deepEqual(dispatched, ['User wants the parser fixed.'])
  socket.close()
})

test('two items in one turn are joined in order', async () => {
  const { socket, dispatched, said, started, dispatch } = await spokenHarness()
  await started('u1'); await started('u2')
  await said('u2', 'the README title.')
  await said('u1', 'Please read')
  await dispatch('tool', 'Read the README.')
  assert.deepEqual(dispatched, ['Please read the README title.'])
  socket.close()
})

test('a reply that says a word and hands work over still hands Claude the user\'s words', async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  let owner
  const dispatched = []
  const tasks = { states: () => [], owed: () => [], async played() { return true },
    async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const store = { selectedProvider: () => 'xai', get: () => ({ key: 'k', model: 'm', voice: 'v', responseDetail: 'concise' }) }
  attachRealtimeVoice(socket, store, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: true } },
    transcriptionModels: async () => [],
    openChannel: async (_settings, inbound) => { owner = inbound; return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) } },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'xai' })))
  await flush()
  await owner.receive({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'u1', transcript: 'Please fix the split bubbles.' })
  await owner.receive({ type: 'response.done', response: { id: 'say-and-call', status: 'completed', output: [
    { type: 'message' },
    { type: 'function_call', call_id: 'call-1', name: 'dispatch_coding_task', arguments: '{"instruction":"User wants bubbles fixed."}' },
  ] } })
  await flush(); await flush()
  assert.deepEqual(dispatched, ['Please fix the split bubbles.'])
  socket.close()
})

test('another session finishing is mentioned as a heads-up, without its result', async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  const sentToComposer = []
  let connected
  const tasks = { states: () => [], async dispatch() { throw new Error('unexpected') }, owed: () => [], async played() { return true } }
  const store = {
    selectedProvider: () => 'openai',
    get: () => ({ key: 'test-key', model: 'test-model', voice: 'test-voice', responseDetail: 'concise' }),
  }
  const provider = { id: 'openai', toolResponseStartsResponse: false,
    webrtc: { connect: async () => ({ connection: {}, answer: 'test-answer', close: async () => {} }) } }
  attachRealtimeVoice(socket, store, tasks, live => { connected = live }, async () => {}, () => [], {
    providers: { openai: provider },
    transcriptionModels: async () => ['whisper-1'],
    openChannel: async () => ({ send: async event => { sentToComposer.push(event) }, close: async () => {}, closed: new Promise(() => {}) }),
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'openai', offer: 'test-offer' })))
  await flush()
  assert.equal(await connected.notice('By the way, the work in the chopitup session is finished.'), true)
  await flush()
  const item = sentToComposer.find(event => event.type === 'conversation.item.create')
  assert.match(item.item.content[0].text, /chopitup session is finished/)
  const reply = sentToComposer.find(event => event.type === 'response.create')
  assert.match(reply.response.instructions, /do not describe, guess or offer to read its result/)
})
