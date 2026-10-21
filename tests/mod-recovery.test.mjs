import assert from 'node:assert/strict'
import test from 'node:test'

async function exerciseRecovery(task) {
  const { register } = await import(`../hooks/register.js?recovery=${task.status}`)
  const handlers = new Map()
  register((name, options, handler) => {
    handlers.set(name, handler ?? options)
  })

  const posts = []
  let submitted = 0
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log: async () => {} },
    prompt: { submit: async () => { submitted += 1 } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) })
        return { ok: true, text: '{}' }
      }
      const body = path === '/api/state'
        ? { phase: 'listening', muted: false, mediaConnected: true }
        : { task }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }

  await handlers.get('session.start')($, {}, async () => {})
  if (task.status === 'claimed') {
    await handlers.get('turn.start')($, { text: task.text, turnId: 'turn-one' }, async () => {})
  }
  await handlers.get('turn.complete')($, {
    turnId: 'turn-one', reason: 'answer', answer: 'Claude finished the coding task.',
  }, async () => {})

  assert.equal(submitted, 0, 'recovered tasks must not be submitted twice')
  assert.deepEqual(posts.map(({ path }) => path), task.status === 'claimed'
    ? ['/api/claude/started', '/api/claude/result']
    : ['/api/claude/result'])
  assert.equal(posts.at(-1).body.text, 'Claude finished the coding task.')
}

test('a running voice-owned turn survives Mod reload without resubmission', async () => {
  await exerciseRecovery({ id: 'voice-one', text: 'Read the README', mode: 'submit', status: 'running', turnId: 'turn-one' })
})

test('a claimed voice request can observe its turn after Mod reload', async () => {
  await exerciseRecovery({ id: 'voice-two', text: 'Read the README', mode: 'submit', status: 'claimed', turnId: null })
})

test('a pending Claude submission does not stop voice state polling', async () => {
  const { register } = await import('../hooks/register.js?recovery=pending-submit')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let tick
  let phase = 'standby'
  let task = { id: 'voice-pending', text: 'Read the README', mode: 'submit', status: 'queued' }
  let submitted = 0
  let invalidated = 0
  const posts = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { tick = callback } },
    ui: { invalidate() { invalidated++ }, log() {}, toast() {} },
    prompt: { submit: () => { submitted++; return new Promise(() => {}) } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push(path)
        if (path === '/api/claude/claim') task = { ...task, status: 'claimed' }
        if (path === '/api/claude/submitting') task = { ...task, status: 'submitting' }
        return { ok: true, text: '{}' }
      }
      return { ok: true, text: JSON.stringify(path === '/api/state'
        ? { phase, mediaConnected: true, voiceConfigured: true, selectedSession: 'claude-session' }
        : { task }) }
    } },
  }
  await Promise.race([
    handlers.get('session.start')($, {}, async () => {}),
    new Promise((_, reject) => setTimeout(() => reject(new Error('voice polling waited for Claude submission')), 100)),
  ])
  assert.equal(submitted, 1)
  const before = invalidated
  phase = 'listening'
  tick()
  await new Promise(setImmediate)
  assert.ok(invalidated > before, 'a new media phase redraws the panel while submission waits')
  await handlers.get('ui.message')($, { element: 'voice-icon-mute', data: { action: 'mute' } }, async () => {})
  assert.ok(posts.includes('/api/control'), 'panel controls still reach the host while submission waits')
  assert.equal(submitted, 1, 'polling does not submit the task twice')
})

test('a new pre-submit claim is released on Mod reload without replaying the prompt', async () => {
  const { register } = await import('../hooks/register.js?recovery=pre-submit')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const posts = []
  let submitted = 0
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log() {}, toast() {} },
    prompt: { submit: async () => { submitted += 1 } },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') posts.push(path)
      return { ok: true, text: JSON.stringify(path === '/api/state'
        ? { phase: 'listening', mediaConnected: true }
        : { task: { id: 'voice-one', text: 'Read the README', mode: 'submit', status: 'claimed',
          submissionState: 'not-started', turnId: null } }) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  assert.deepEqual(posts, ['/api/claude/claim-failed'])
  assert.equal(submitted, 0)
})

test('a failed claim releases the Mod so the next coding request can be claimed', async () => {
  const { register } = await import('../hooks/register.js?recovery=expired-claim')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let task = { id: 'voice-old', text: 'Old request', mode: 'submit', status: 'claimed', turnId: null }
  const posts = []
  const notices = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log: async () => {}, toast: text => notices.push(text) },
    prompt: { submit: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push(path)
        return { ok: true, text: '{}' }
      }
      return { ok: true, text: JSON.stringify(path === '/api/state'
        ? { phase: 'speaking', mediaConnected: true, selectedSession: 'claude-session' }
        : { task }) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  task = null // The host expired the claim without submitting it again.
  clock()
  await new Promise(setImmediate)
  assert(notices.some(text => text.includes('handoff did not start')))
  task = { id: 'voice-new', text: 'New request', mode: 'submit', status: 'queued', turnId: null }
  clock()
  await new Promise(setImmediate)
  assert(posts.includes('/api/claude/claim'), 'the next request is no longer blocked locally')
})

test('a cleared Claude session takes the voice for its new id when the desktop selects it', async () => {
  const { register } = await import('../hooks/register.js?recovery=clear')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let currentSession = 'original-session'
  const bound = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => currentSession, cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (path === '/api/claude/select') bound.push(JSON.parse(options.body).sessionId)
      const body = path === '/api/state'
        ? { phase: 'idle', muted: false, mediaConnected: true }
        : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  await handlers.get('session.attach')($, { surface: 'desktop', clientId: 'desktop-2' }, async e => e)
  currentSession = 'cleared-session'
  await handlers.get('classic.SessionStart')($, { source: 'clear' }, async () => {})
  assert.deepEqual(bound, ['original-session'], 'starting or clearing never takes the voice by itself')
  await handlers.get('session.attach')($, { surface: 'desktop', clientId: 'desktop-2' }, async e => e)
  assert.deepEqual(bound, ['original-session', 'cleared-session'])
})

test('a voice-owned tool step forwards chunks and reports only its visible milestone', async () => {
  const { register } = await import('../hooks/register.js?recovery=milestone')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const posts = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) })
        return { ok: true, text: '{}' }
      }
      return { ok: true, text: JSON.stringify(path === '/api/state'
        ? { phase: 'listening', mediaConnected: true }
        : { task: { id: 'voice-one', text: 'Read the README', mode: 'submit', status: 'running', turnId: 'turn-one' } }) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  async function* step() {
    yield { kind: 'thinking', text: 'private reasoning' }
    yield { kind: 'text', text: 'I will read ' }
    yield { kind: 'text', text: 'the README.' }
    yield { kind: 'tool', name: 'Read', id: 'tool-one' }
    return { answer: 'I will read the README.', toolUses: [{ name: 'Read' }] }
  }
  const stream = handlers.get('turn.step')($,
    { turnId: 'turn-one', index: 2 }, () => step())
  const chunks = []
  let result
  while (true) {
    const item = await stream.next()
    if (item.done) { result = item.value; break }
    chunks.push(item.value)
  }
  assert.equal(chunks.length, 4)
  assert.equal(result.answer, 'I will read the README.')
  assert.deepEqual(posts.filter(row => row.path === '/api/claude/milestone'), [{
    path: '/api/claude/milestone',
    body: { id: 'voice-one', sessionId: 'claude-session', turnId: 'turn-one', step: 2,
      text: 'I will read the README.' },
  }])
  for await (const _ of handlers.get('turn.step')($,
    { turnId: 'turn-one', index: 3, agentId: 'subagent' }, () => step())) { /* forwarded */ }
  for await (const _ of handlers.get('turn.step')($,
    { turnId: 'unrelated-turn', index: 4 }, () => step())) { /* forwarded */ }
  assert.equal(posts.filter(row => row.path === '/api/claude/milestone').length, 1)
})

async function orphanHarness(tag) {
  const { register } = await import(`../hooks/register.js?orphan=${tag}`)
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const posts = []
  let task = { id: 'voice-old', text: 'Old request', mode: 'submit', status: 'running', turnId: 'turn-gone' }
  let polls = 0
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log: async () => {} },
    prompt: { submit: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) })
        if (path === '/api/claude/result') task = null
        return { ok: true, text: '{}' }
      }
      if (path === '/api/claude/request') polls += 1
      const body = path === '/api/state' ? { phase: 'listening', muted: false, mediaConnected: true } : { task }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  return { handlers, $, posts, tick: async () => { clock(); await new Promise(setImmediate) }, polls: () => polls }
}

test('host-side recovery clears stale local turn ownership and admits the next request', async () => {
  const { register } = await import('../hooks/register.js?orphan=host-recovered')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let task = { id: 'voice-old', text: 'Old request', mode: 'submit', status: 'running', turnId: 'old-turn' }
  const posts = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log: async () => {}, toast() {} },
    prompt: { submit: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const route = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push({ path: route, body: JSON.parse(options.body) })
        return { ok: true, text: '{}' }
      }
      return { ok: true, text: JSON.stringify(route === '/api/state'
        ? { phase: 'speaking', mediaConnected: true } : route === '/api/claude/request' ? { task } : {}) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  task = { id: 'voice-next', text: 'New request', mode: 'submit', status: 'queued', turnId: null }
  clock()
  for (let i = 0; i < 5; i++) await new Promise(setImmediate)
  assert(posts.some(post => post.path === '/api/claude/claim' && post.body.id === 'voice-next'))
  assert(!posts.some(post => post.path === '/api/claude/result'), 'host recovery must not fabricate another completion or cancel a turn')
})

test('a fresh Claude session aborts a voice turn left running before the restart', async () => {
  const run = await orphanHarness('restart')
  await run.handlers.get('classic.SessionStart')(run.$, { source: 'resume' }, async () => {})
  const result = run.posts.find(post => post.path === '/api/claude/result')
  assert.deepEqual(result?.body, { id: 'voice-old', sessionId: 'claude-session', turnId: 'turn-gone', status: 'aborted', text: '' })
  const before = run.polls()
  await run.tick()
  assert(run.polls() > before, 'the Mod polls for new voice requests again')
})

test('a different turn starting aborts a voice turn that never completed', async () => {
  const run = await orphanHarness('next-turn')
  await run.handlers.get('turn.start')(run.$, { text: 'typed prompt', turnId: 'turn-new' }, async () => {})
  assert(run.posts.some(post => post.path === '/api/claude/result' && post.body.turnId === 'turn-gone' && post.body.status === 'aborted'))
})

test('a session start before the first poll still aborts the orphaned voice turn', async () => {
  const { register } = await import('../hooks/register.js?orphan=early')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const posts = []
  let task = { id: 'voice-old', text: 'Old request', mode: 'submit', status: 'running', turnId: 'turn-gone' }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log: async () => {} },
    prompt: { submit: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) })
        if (path === '/api/claude/result') task = null
        return { ok: true, text: '{}' }
      }
      const body = path === '/api/state' ? { phase: 'listening', muted: false, mediaConnected: true } : { task }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('classic.SessionStart')($, { source: 'startup' }, async () => {})
  await handlers.get('session.start')($, {}, async () => {})
  assert(posts.some(post => post.path === '/api/claude/result' && post.body.status === 'aborted' && post.body.turnId === 'turn-gone'))
})
