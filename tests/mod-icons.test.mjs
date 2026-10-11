import assert from 'node:assert/strict'
import test from 'node:test'

test('the voice bar icons send their commands to the host', async () => {
  const { register } = await import('../hooks/register.js?icons')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  const posted = []
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {}, open: async () => ({ isPlaced: true }) },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') { posted.push([path, JSON.parse(options.body).action ?? null]); return { ok: true, text: '{}' } }
      const body = path === '/api/state' ? { phase: 'listening', mediaConnected: true } : { task: null }
      return { ok: true, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start')($, {}, async () => {})
  const press = action => handlers.get('ui.message')($, { element: `voice-icon-${action}`, data: { action } }, async () => {})
  await press('mute')
  await press('speaker-mute')
  await press('settings')
  assert.deepEqual(posted.filter(([path]) => path !== '/api/claude/session'),
    [['/api/control', 'mute'], ['/api/control', 'speaker-mute']])
})
