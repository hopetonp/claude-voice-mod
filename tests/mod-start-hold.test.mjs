import assert from 'node:assert/strict'
import test from 'node:test'

const texts = tree => tree == null || typeof tree !== 'object' ? (typeof tree === 'string' ? [tree] : [])
  : Array.isArray(tree) ? tree.flatMap(texts) : texts(tree.children)

test('starting voice shows connecting until the page reports progress, without flicking back to idle', async () => {
  const { register } = await import('../hooks/register.js?start-hold')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let hostPhase = 'idle'
  let clock
  const element = type => props => ({ type, ...props })
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    ui: { invalidate() {}, log() {}, toast() {}, resolve: () => ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async (url, options = {}) => {
      if (options.method === 'POST') return { ok: true, text: '{}' }
      const path = new URL(url).pathname
      const body = path === '/api/state' ? { phase: hostPhase, mediaConnected: true, muted: false } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  const status = async () => texts(await handlers.get('ui.render')($, { component: 'AbovePrompt' }, async () => null))[0] ?? ''
  await handlers.get('session.start')($, {}, async () => {})
  await handlers.get('ui.message')($, { element: 'voice-toggle', data: { action: 'toggle' } }, async () => {})
  assert.equal(await status(), 'Connecting…')
  clock(); await new Promise(setImmediate)
  assert.equal(await status(), 'Connecting…', 'the host has not picked up the start yet')
  hostPhase = 'listening'
  clock(); await new Promise(setImmediate)
  assert.match(await status(), /^\d+:\d\d$/, 'a live voice shows its clock')
})
