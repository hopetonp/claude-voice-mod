import assert from 'node:assert/strict'
import test from 'node:test'

const element = type => props => ({ type, ...props })
const find = (tree, match) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, match)).find(Boolean) ?? null
    : match(tree) ? tree : find(tree.children, match)

async function mod(tag, initial, surfaces = []) {
  let state = { phase: 'listening', mediaConnected: true, voiceConfigured: true, transcript: '', lastReply: '', ...initial }
  const posted = []
  const toasts = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
    session: { id: async () => 'session-b', cwd: async () => '/p/codex-voice-mod', surfaces: async () => surfaces },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast: text => toasts.push(text),
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') posted.push([path, JSON.parse(options.body)])
      return { ok: true, status: 200, text: JSON.stringify(path === '/api/state' ? state : { task: null, ok: true }) }
    } },
  }
  const { register } = await import(`../hooks/register.js?${tag}`)
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  await handlers.get('session.start:')($, {}, async () => {})
  return {
    posted, toasts,
    set: patch => { state = { ...state, ...patch } },
    tick: async () => { clock(); await new Promise(setImmediate) },
    attach: surface => handlers.get('session.attach:')($, { surface, clientId: 'desktop-2' }, async e => e),
    detach: () => handlers.get('session.detach:')?.($, { surface: 'desktop', clientId: 'desktop-2', reason: 'detach' }, async e => e),
    render: () => handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt', surface: 'desktop' }, async () => null),
  }
}

test('starting a session does not take the voice; the desktop attaching does', async () => {
  const ui = await mod('own-attach', {})
  await ui.tick()
  assert.equal(ui.posted.some(([path]) => ['/api/claude/session', '/api/claude/select'].includes(path)), false)
  await ui.attach('mobile')
  assert.equal(ui.posted.some(([path]) => path === '/api/claude/select'), false, 'only the desktop selects')
  await ui.attach('desktop')
  assert.deepEqual(ui.posted.find(([path]) => path === '/api/claude/select'), ['/api/claude/select', { sessionId: 'session-b', cwd: '/p/codex-voice-mod' }])
  const before = ui.posted.length
  await ui.detach()
  assert.equal(ui.posted.length, before, 'leaving a session never moves the voice')
})

test('a session that does not own the voice draws no live line', async () => {
  const ui = await mod('own-gate', { selectedSession: 'session-a' })
  await ui.tick()
  ui.set({ transcript: 'Words spoken in another session' })
  await ui.tick()
  assert.equal(find(await ui.render(), node => node.type === 'Text' && node.wrap === 'truncate-start'), null)
})

test('a result finishing in another session raises one toast and one chime, and draws no badge', async () => {
  const ui = await mod('own-badge', { selectedSession: 'session-b' })
  await ui.tick()
  const now = Date.now() + 1000
  ui.set({ waitingResults: [{ sessionId: 'session-a', folder: 'chopitup', finishedAt: now }] })
  await ui.tick()
  await ui.tick()
  assert.deepEqual(ui.toasts, ['chopitup: work finished'])
  assert.equal(ui.posted.filter(([path, body]) => path === '/api/control' && body.action === 'chime').length, 1)
  assert.equal(find(await ui.render(), node => node.type === 'Text' && /ready/.test(node.children?.[0] ?? '')), null)
  ui.set({ waitingResults: [{ sessionId: 'session-a', folder: 'chopitup', finishedAt: now },
    { sessionId: 'session-c', folder: 'deepseek-harness', finishedAt: now + 1 }] })
  await ui.tick()
  assert.deepEqual(ui.toasts, ['chopitup: work finished', 'deepseek-harness: work finished'])
  assert.equal(find(await ui.render(), node => node.type === 'Text' && /ready/.test(node.children?.[0] ?? '')), null)
  ui.set({ waitingResults: [{ sessionId: 'session-d', folder: 'chopitup', title: 'Fix login', finishedAt: now + 2 }] })
  await ui.tick()
  assert.equal(ui.toasts.at(-1), 'chopitup · Fix login: work finished')
})

test('results already waiting when the plugin loads are not announced again', async () => {
  const ui = await mod('own-stale', { selectedSession: 'session-b',
    waitingResults: [{ sessionId: 'session-a', folder: 'chopitup', finishedAt: 0 }] })
  await ui.tick()
  await ui.tick()
  ui.set({ waitingResults: [{ sessionId: 'session-a', folder: 'chopitup', finishedAt: 0 },
    { sessionId: 'session-c', folder: 'deepseek-harness', finishedAt: Date.now() - 60000 }] })
  await ui.tick()
  assert.deepEqual(ui.toasts, [])
  assert.equal(ui.posted.filter(([path, body]) => path === '/api/control' && body.action === 'chime').length, 0)
})

test('after a host restart (no session selected), the session on screen selects itself; one off screen does not', async () => {
  const shown = await mod('reselect-shown', { selectedSession: null }, ['desktop'])
  await shown.tick()
  assert.ok(shown.posted.some(([path, body]) => path === '/api/claude/select' && body.sessionId === 'session-b'))
  const hidden = await mod('reselect-hidden', { selectedSession: null }, [])
  await hidden.tick()
  assert.equal(hidden.posted.filter(([path]) => path === '/api/claude/select').length, 0)
})
