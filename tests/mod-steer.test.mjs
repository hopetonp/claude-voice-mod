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


test('a spoken stop is polled while a history command waits, and a manual stop admits the next task', async () => {
  const { register } = await import('../hooks/register.js?blocked-history-stop')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let task = { id: 'voice-task', text: 'Fix the bubbles', mode: 'submit', status: 'running', turnId: 'turn-one' }
  let steer = null
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let releaseHistory
  let historyStarted = false
  const held = new Promise(resolve => { releaseHistory = resolve })
  const aborted = []
  const posts = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {}, run: async () => { historyStarted = true; await held } },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {}, toast() {} },
    prompt: { submit: async () => {} },
    turn: { abort: async ({ turnId }) => { aborted.push(turnId) } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        posts.push({ path, body })
        if (path === '/api/claude/result') { task = null; steer = null }
        return { ok: true, text: '{}' }
      }
      const body = path === '/api/state' ? { phase: 'idle', mediaConnected: true, captionRevision: 1 }
        : path === '/api/captions' ? { revision: 1, rows: [{ id: 'stop-caption', role: 'user', text: 'Stop.', final: true }] }
        : path === '/api/claude/steer' ? { steer } : { task }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate) }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    await settle()
    now = 6000
    clock(); await settle()
    assert.equal(historyStarted, true)
    steer = { parentId: 'voice-task', kind: 'stop', notes: [] }
    clock(); await settle()
    clock(); await settle()
    assert.deepEqual(aborted, ['turn-one'], 'a pending history write cannot block cancellation')
    await handlers.get('turn.complete')($, { turnId: 'turn-one', isAborted: true, reason: 'answer', answer: 'partial' }, async () => {})
    assert.equal(posts.find(p => p.path === '/api/claude/result').body.status, 'aborted')
    task = { id: 'voice-next', text: 'Read the README', mode: 'submit', status: 'queued' }
    clock(); await settle()
    assert(posts.some(p => p.path === '/api/claude/claim' && p.body.id === 'voice-next'), 'bridge accepts another request without restarting Claude')
  } finally { Date.now = realNow; releaseHistory(); await settle() }
})


test('an explicit submission drop waits for a fresh voice-button gesture before retrying', async () => {
  const { register } = await import('../hooks/register.js?stop-input-refusal')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let clock
  let attempts = 0
  const posts = []
  const notices = []
  const task = { id: 'dropped-task', text: 'Read the README', mode: 'submit', status: 'queued' }
  const $ = {
    env: { get: async () => '/tmp' }, fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test' }) },
    session: { id: async () => 'session', cwd: async () => '/tmp' },
    command: { register: async () => {} }, store: { get: async () => [], set: async () => {} },
    clock: { every(ms, callback) { clock = callback } }, ui: { invalidate() {}, toast(text) { notices.push(text) } },
    prompt: { submit: async () => { attempts++; return { drop: 'the session was stopped and nobody has sent input since' } } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') { posts.push(path); return { ok: true, text: '{}' } }
      return { ok: true, text: JSON.stringify(path === '/api/state' ? { phase: 'idle', mediaConnected: true } : { task }) }
    } },
  }
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate) }
  await handlers.get('session.start')($, {}, async () => {})
  await settle()
  assert.equal(attempts, 1)
  assert(posts.includes('/api/claude/submission-rejected'))
  assert.deepEqual(notices, ['Claude is paused. Click Resume Claude.'])
  clock(); await settle()
  assert.equal(attempts, 1, 'the timer must not retry a blocked prompt')
  let gestureSubmissions = 0
  const gestureApi = { ...$, prompt: { submit: async () => { gestureSubmissions++; return { text: task.text } } } }
  let resume
  gestureApi.ui = { ...$.ui, resolve: () => new Proxy({}, { get: (_, name) => props => {
    if (name === 'Button' && props.key === 'voice-resume-coding') resume = props.onPress
    return props
  } }) }
  await handlers.get('ui.render')(gestureApi, { surface: 'desktop', props: {} }, async () => null)
  assert.equal(typeof resume, 'function', 'a blocked request draws a native resume button')
  await resume()
  await settle()
  assert.equal(gestureSubmissions, 1, 'retry uses the fresh person-input context')
  clock(); await settle()
  assert.equal(gestureSubmissions, 1, 'the accepted prompt is never replayed')
})
