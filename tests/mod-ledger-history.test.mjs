import assert from 'node:assert/strict'
import test from 'node:test'

test('voice history waits for the user row before starting the reply row', async () => {
  const { register } = await import('../hooks/register.js?ordered-voice-writes')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const started = []
  const finished = []
  let releaseUser
  const holdUser = new Promise(resolve => { releaseUser = resolve })
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let revision = 0
  const rows = [
    { id: 'question', role: 'user', text: 'How are you?', final: true, spokenAt: 1000 },
    { id: 'reply', role: 'assistant', text: 'Doing well.', final: true, spokenAt: 1200 },
  ]
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {}, run: async ({ args }) => {
      started.push(args)
      if (args.startsWith('you ')) await holdUser
      finished.push(args)
    } },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {} },
    http: { fetch: async url => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true,
            selectedSession: 'claude-session', captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    revision = 2
    now = 5000
    clock(); await new Promise(setImmediate)
    now = 8000
    clock(); await new Promise(setImmediate)
    assert.deepEqual(started, ['you How are you?'], 'the reply must wait while the user row is being written')
    releaseUser()
    await new Promise(setImmediate)
    await new Promise(setImmediate)
    assert.deepEqual(started, ['you How are you?', 'voice Doing well.'])
    assert.deepEqual(finished, started)
  } finally { Date.now = realNow; releaseUser() }
})

test('a completed voice exchange releases a prior unanswered caption and both appear in history', async () => {
  const { register } = await import('../hooks/register.js?voice-after-unanswered')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  const rows = [
    { id: 'unanswered', role: 'user', text: 'Okay.', final: true, spokenAt: 1000 },
    { id: 'question', role: 'user', text: 'Can you hear me?', final: true, spokenAt: 10000 },
    { id: 'answer', role: 'assistant', text: 'Yes, I can hear you.', final: true, spokenAt: 11000 },
  ]
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, classifierEnabled: true,
            selectedSession: 'claude-session', captionRevision: 3 }
        : path === '/api/captions' ? { revision: 3, rows, turns: [] } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    now = 12000
    clock(); await new Promise(setImmediate)
    now = 16000
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, ['You: Okay.', 'You: Can you hear me?', 'Voice: Yes, I can hear you.'])
  } finally { Date.now = realNow }
})

test('voice-only turns pass an older coding route and appear before standby', async () => {
  const { register } = await import('../hooks/register.js?voice-after-coding')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  let clock
  const realNow = Date.now
  let now = 5000
  Date.now = () => now
  const rows = [
    { id: 'old-request', role: 'user', text: 'Read the title', delegated: true, spokenAt: 1000 },
    { id: 'old-ack', role: 'assistant', text: 'Checking.', final: true, spokenAt: 1100 },
    { id: 'conversation', role: 'user', text: 'How are you?', spokenAt: 2000 },
    { id: 'voice-reply', role: 'assistant', text: 'Doing well.', spokenAt: 2300 },
  ]
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, classifierEnabled: true,
            selectedSession: 'claude-session', captionRevision: 4 }
        : path === '/api/captions'
          ? { revision: 4, rows, turns: [] }
          : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    now = 7000
    clock(); await new Promise(setImmediate)
    assert(visible.includes('You: How are you?'))
    assert(visible.includes('Voice: Doing well.'))
  } finally { Date.now = realNow }
})

test('the Mod keeps consecutive ledger turns distinct and omits delegated prompts', async () => {
  const { register } = await import('../hooks/register.js?ledger-history-test')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  const saved = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let phase = 'idle'
  let revision = 0
  let rows = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved.at(-1) ?? [], set: async (_key, value) => { saved.push(value) } },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase, mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    rows = [
      { id: 'first', role: 'user', text: 'Hello', delegated: false },
      { id: 'reply', role: 'assistant', text: 'Hi there', delegated: false },
      { id: 'coding', role: 'user', text: 'Read the README title', delegated: true },
      { id: 'second', role: 'user', text: 'Thanks', delegated: false },
    ]
    phase = 'idle'
    revision = 4
    now = 4000
    clock(); await new Promise(setImmediate)
    now = 6500
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, ['You: Hello', 'Voice: Hi there', 'You: Thanks'])
    assert(!saved.at(-1).some(item => item.line.includes('README')))

    const { register: reloaded } = await import('../hooks/register.js?ledger-history-reload')
    const recovered = new Map()
    reloaded((name, options, handler) => recovered.set(name, handler ?? options))
    await recovered.get('session.start')($, {}, async () => {})
    assert.equal(visible.length, 3)
  } finally { Date.now = realNow }
})

test('a Mod reload in the middle of an utterance shows the whole utterance once it finishes', async () => {
  const visible = []
  const saved = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let revision = 0
  let rows = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved.at(-1) ?? [], set: async (_key, value) => { saved.push(value) } },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const start = async (tag) => {
    const { register } = await import(`../hooks/register.js?mid-utterance-${tag}`)
    const handlers = new Map()
    register((name, options, handler) => handlers.set(name, handler ?? options))
    await handlers.get('session.start')($, {}, async () => {})
  }
  try {
    await start('first')
    rows = [{ id: 'talk', role: 'user', text: 'I want the captions in the history, not', delegated: false }]
    revision = 1
    now = 1100
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, [], 'nothing shows until the utterance finishes')

    await start('reloaded')
    rows = [
      { id: 'talk', role: 'user', text: 'I want the captions in the history, not in the panel', delegated: false },
      { id: 'reply', role: 'assistant', text: 'Okay.', delegated: false },
    ]
    revision = 2
    now = 2500
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, [], 'a finished utterance waits in case the voice hands it over as a request')
    now = 4100
    clock(); await new Promise(setImmediate)
    assert.deepEqual(visible, ['You: I want the captions in the history, not in the panel', 'Voice: Okay.'])
  } finally { Date.now = realNow }
})

test('a reload does not repost captions whose saved entries were evicted', async () => {
  const visible = []
  const realNow = Date.now
  Date.now = () => 5000
  const rows = [
    { id: 'old', role: 'user', text: 'An old caption that fell out of the saved history', delegated: false },
    { id: 'kept', role: 'assistant', text: 'A caption the saved history still knows', delegated: false },
  ]
  const saved = [{ id: 'kept', line: 'Voice: A caption the saved history still knows', posted: 40, final: true }]
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved, set: async () => {} },
    clock: { every() {} },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, captionRevision: 2 }
        : path === '/api/captions' ? { revision: 2, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    const { register } = await import('../hooks/register.js?evicted-reload')
    const handlers = new Map()
    register((name, options, handler) => handlers.set(name, handler ?? options))
    await handlers.get('session.start')($, {}, async () => {})
    assert.deepEqual(visible, [])
  } finally { Date.now = realNow }
})

test('the saved history keeps one entry per caption', async () => {
  const saved = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let rows = []
  let revision = 0
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved.at(-1) ?? [], set: async (_key, value) => { saved.push(value) } },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {} },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    const { register } = await import('../hooks/register.js?one-entry')
    const handlers = new Map()
    register((name, options, handler) => handlers.set(name, handler ?? options))
    await handlers.get('session.start')($, {}, async () => {})
    rows = [{ id: 'talk', role: 'user', text: 'First clause of it, second clause of it, third', delegated: false }]
    revision = 1
    now = 1100
    clock(); await new Promise(setImmediate)
    now = 2200
    clock(); await new Promise(setImmediate)
    rows = [...rows, { id: 'next', role: 'assistant', text: 'Sure.', delegated: false }]
    revision = 2
    now = 2300
    clock(); await new Promise(setImmediate)
    now = 3900
    clock(); await new Promise(setImmediate)
    assert.deepEqual(saved.at(-1).filter(entry => entry.id === 'talk').map(entry => [entry.posted, entry.final]), [[46, true]])
  } finally { Date.now = realNow }
})

test('finished conversation captions become /voice-said bubble rows without a model turn', async () => {
  const { register: registerSaid } = await import('../said-plugin/hooks/register.js')
  const said = new Map()
  registerSaid((name, options, handler) => said.set(name, handler ?? options))
  const bubbles = []
  const logged = []
  const handlers = new Map()
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let revision = 0
  let rows = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: {
      register: async () => {},
      run: async ({ command, args }) => {
        const out = await said.get('command.run')($, { command, args }, async () => ({}))
        bubbles.push([command, args, out.text])
        return out
      },
    },
    prompt: { submit: async () => { throw new Error('conversation must not start a turn') } },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { logged.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    const { register } = await import('../hooks/register.js?said-bubbles')
    register((name, options, handler) => handlers.set(name, handler ?? options))
    await handlers.get('session.start')($, {}, async () => {})
    rows = [
      { id: 'hi', role: 'user', text: ' How is it going?', delegated: false },
      { id: 'coding', role: 'user', text: 'Read the README title', delegated: true },
      { id: 'reply', role: 'assistant', text: ' Going well, thanks.', delegated: false },
    ]
    revision = 1
    now = 1100
    clock(); await new Promise(setImmediate)
    now = 2700
    clock(); await new Promise(setImmediate)
    await new Promise(setImmediate)
    assert.deepEqual(bubbles, [
      ['voice-said', 'you How is it going?', 'How is it going?'],
      ['voice-said', 'voice Going well, thanks.', 'Going well, thanks.'],
    ])
    assert.deepEqual(logged, [])
  } finally { Date.now = realNow }
})

test('a caption the host marks final shows on the next tick', async () => {
  const logged = []
  let clock
  const realNow = Date.now
  Date.now = () => 1000
  let revision = 0
  let rows = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { logged.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'speaking', mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  try {
    const { register } = await import('../hooks/register.js?final-phase')
    const handlers = new Map()
    register((name, options, handler) => handlers.set(name, handler ?? options))
    await handlers.get('session.start')($, {}, async () => {})
    rows = [{ id: 'reply', role: 'assistant', text: 'All done.', delegated: false, final: true }]
    revision = 1
    clock(); await new Promise(setImmediate)
    assert.deepEqual(logged, ['Voice: All done.'])
  } finally { Date.now = realNow }
})


test('a ledger caption that grows after its bubble was written posts only the new words, once', async () => {
  const { register } = await import('../hooks/register.js?ledger-continuation')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  const saved = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let revision = 0
  let rows = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => saved.at(-1) ?? [], set: async (_key, value) => { saved.push(value) } },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async (url) => {
      const path = new URL(url).pathname
      const body = path === '/api/state'
        ? { phase: 'listening', mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const tick = async at => { now = at; clock(); await new Promise(setImmediate) }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    rows = [{ id: 'u1', role: 'user', text: 'That looks good', delegated: false }]
    revision = 1
    await tick(1100)
    await tick(5200)
    assert.deepEqual(visible, ['You: That looks good'])
    rows = [{ id: 'u1', role: 'user', text: 'That looks good How long is it set', delegated: false }]
    revision = 2
    await tick(9000)
    await tick(13100)
    assert.deepEqual(visible, ['You: That looks good', 'You: How long is it set'])
    await tick(20000)
    assert.equal(visible.length, 2, 'posted once')
    // A caption's words can arrive late, after a later caption was already written: they still post.
    rows = [{ id: 'u1', role: 'user', text: 'That looks good How long is it set', delegated: false },
      { id: 'u2', role: 'user', text: 'Just like regular text', delegated: false }]
    revision = 3
    await tick(21000)
    await tick(25100)
    assert.deepEqual(visible.slice(2), ['You: Just like regular text'])
    rows = [{ id: 'u1', role: 'user', text: 'That looks good How long is it set The voice is plain text', delegated: false },
      { id: 'u2', role: 'user', text: 'Just like regular text', delegated: false }]
    revision = 4
    await tick(26000)
    await tick(30100)
    assert.deepEqual(visible.slice(3), ['You: The voice is plain text'])
  } finally { Date.now = realNow }
})

test("a last word transcribed late joins the user's bubble ahead of the voice's reply", async () => {
  const { register } = await import('../hooks/register.js?ledger-late-tail')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const visible = []
  let clock
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let revision = 0
  let rows = []
  let phase = 'speaking'
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log(line) { visible.push(line) } },
    http: { fetch: async url => {
      const path = new URL(url).pathname
      const body = path === '/api/state' ? { phase, mediaConnected: true, voiceConfigured: true, captionRevision: revision }
        : path === '/api/captions' ? { revision, rows } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const tick = async at => { now = at; clock(); await new Promise(setImmediate) }
  try {
    await handlers.get('session.start')($, {}, async () => {})
    // The host lists captions in the order they were spoken, each with when (`spokenAt`) and when it was
    // first recorded (`createdRevision`); 'quiet' was transcribed after the reply began, but said before it.
    rows = [{ id: 'u1', role: 'user', text: 'It went off. It was', delegated: false, spokenAt: 10, createdRevision: 1 }]
    revision = 1
    await tick(1100)
    rows = [...rows, { id: 'r1', role: 'assistant', text: 'Good,', delegated: false, spokenAt: 900, createdRevision: 2 }]
    revision = 2
    await tick(2000)
    rows = [rows[0], { id: 'u2', role: 'user', text: 'quiet', delegated: false, spokenAt: 800, createdRevision: 3 },
      { id: 'r1', role: 'assistant', text: "Good, that's what we want.", delegated: false, spokenAt: 900, createdRevision: 2 }]
    revision = 3
    await tick(2300)
    phase = 'listening'
    await tick(3000)
    await tick(6000)
    assert.deepEqual(visible, ['You: It went off. It was quiet', "Voice: Good, that's what we want."])
  } finally { Date.now = realNow }
})
