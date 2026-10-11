import assert from 'node:assert/strict'
import test from 'node:test'

test('the Mod appends ordinary voice turns as model-invisible history notices', async () => {
  const { register } = await import('../hooks/register.js?history-test')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  const saved = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let state = { phase: 'idle', muted: false, mediaConnected: true,
    transcript: '', transcriptId: '', lastReply: '', lastReplyId: '' }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved.at(-1) ?? [], set: async (_key, value) => { saved.push(value) } },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log: async (text, options) => { visible.push({ text, options }) } },
    http: { fetch: async (url) => ({ ok: true, text: JSON.stringify(new URL(url).pathname === '/api/state' ? state : { task: null }) }) },
  }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    state = { ...state, phase: 'listening', transcript: 'Hello there', transcriptId: 'user-one' }
    now = 1100
    clock(); await new Promise(setImmediate)
    now = 3500
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, [], 'an unfinished utterance shows nothing yet')
    state = { ...state, phase: 'speaking', lastReply: 'Hello back', lastReplyId: 'reply-one' }
    now = 4000
    clock(); await new Promise(setImmediate)
    state = { ...state, phase: 'listening' }
    now = 6500
    clock(); await new Promise(setImmediate)
    now = 7800
    clock(); await new Promise(setImmediate)
    assert.deepEqual(saved.at(-1).filter(row => row.line).map(row => row.line), ['You: Hello there', 'Voice: Hello back'])
    assert(saved.at(-1).filter(row => row.final).length === 2)
    assert.deepEqual(visible.map(row => row.text), ['You: Hello there', 'Voice: Hello back'])
    const { register: reloaded } = await import('../hooks/register.js?history-reload')
    const recovered = new Map()
    reloaded((name, options, handler) => recovered.set(name, handler ?? options))
    state = { ...state, phase: 'standby' }
    await recovered.get('session.start')($, {}, async () => {})
    assert.deepEqual(visible.slice(2), [], 'a reload does not show the same lines again; the transcript already has them')
  } finally { Date.now = realNow }
})
