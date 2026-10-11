import assert from 'node:assert/strict'
import test from 'node:test'

test('a spoken interruption cancels the running voice turn', async () => {
  const { register } = await import('../hooks/register.js?steer')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let steer = null
  const aborted = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {}, toast() {} },
    prompt: { submit: async () => {} },
    turn: { abort: async ({ turnId }) => { aborted.push(turnId) } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') return { ok: true, text: '{}' }
      const body = path === '/api/state' ? { phase: 'listening', mediaConnected: true }
        : path === '/api/claude/steer' ? { steer }
        : { task: { id: 'voice-task', text: 'Fix the bubbles', mode: 'submit', status: 'queued' } }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  clock(); await new Promise(setImmediate)
  await handlers.get('turn.start')($, { text: 'Fix the bubbles', turnId: 'turn-one' }, async () => {})
  clock(); await new Promise(setImmediate)
  assert.deepEqual(aborted, [], 'nothing to interrupt yet')
  steer = { parentId: 'voice-task', kind: 'stop', notes: [] }
  clock(); await new Promise(setImmediate)
  clock(); await new Promise(setImmediate)
  assert.deepEqual(aborted, ['turn-one'], 'the running turn is cancelled once')
})

test('a spoken note reaches the running turn after its next tool call, without cancelling it', async () => {
  const { register } = await import('../hooks/register.js?note')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let steer = null
  const aborted = []
  const delivered = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {}, toast() {} },
    prompt: { submit: async () => {} },
    turn: { abort: async ({ turnId }) => { aborted.push(turnId) } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        if (path === '/api/claude/steer/delivered') delivered.push(JSON.parse(options.body).ids)
        return { ok: true, text: '{}' }
      }
      const body = path === '/api/state' ? { phase: 'listening', mediaConnected: true }
        : path === '/api/claude/steer' ? { steer }
        : { task: { id: 'voice-task', text: 'Fix the bubbles', mode: 'submit', status: 'queued' } }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const toolCall = handlers.get('tool.call')
  await handlers.get('session.start')($, {}, async () => {})
  clock(); await new Promise(setImmediate)
  await handlers.get('turn.start')($, { text: 'Fix the bubbles', turnId: 'turn-one' }, async () => {})
  steer = { parentId: 'voice-task', kind: 'note', notes: [{ id: 'note-one', text: '[voice] also check the spacing' }] }
  clock(); await new Promise(setImmediate)
  const subagent = await toolCall($, { tool: 'Read', agentId: 'sub' }, async () => ({ result: 'file' }))
  assert.equal(subagent.context, undefined, 'a subagent does not take the note')
  const result = await toolCall($, { tool: 'Read' }, async () => ({ result: 'file' }))
  assert.deepEqual(result.context, ['[voice] also check the spacing'])
  assert.deepEqual(delivered, [['note-one']])
  clock(); await new Promise(setImmediate)
  const later = await toolCall($, { tool: 'Read' }, async () => ({ result: 'file' }))
  assert.equal(later.context, undefined, 'a note already read is not handed over again')
  assert.deepEqual(aborted, [], 'the turn keeps running')
})
