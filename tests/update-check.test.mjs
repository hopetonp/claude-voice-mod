import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecks, updateCheckMessage } from '../host/update-check.js'

test('settings update requests are scoped to a chat and claimed only once', () => {
  const queue = createUpdateChecks()
  assert.throws(() => queue.request(null), /Claude chat/)
  const request = queue.request('owner')
  assert.equal(queue.request('owner'), request, 'repeated settings clicks do not duplicate a pending request')
  assert.equal(queue.claim('other', request.id), null)
  assert.equal(queue.claim('owner', 'wrong-id'), null)
  assert.equal(queue.claim('owner', request.id), request)
  assert.equal(queue.claim('owner', request.id), null)
  assert.equal(queue.get('owner'), null)
})

test('the settings button request submits one ordinary Claude message, even with voice off', async () => {
  for (const sessionId of ['other', 'owner']) {
    const queue = createUpdateChecks(); queue.request('owner')
    const { register } = await import(`../hooks/register.js?update-check-${sessionId}`)
    const handlers = new Map(), submitted = []
    register((name, options, handler) => handlers.set(name, handler ?? options))
    let poll
    const $ = {
      env: { get: async () => '/tmp' },
      fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
      session: { id: async () => sessionId, cwd: async () => '/project', surfaces: async () => [] },
      store: { get: async () => [], set: async () => {} },
      clock: { every(_ms, callback) { poll = callback } },
      ui: { invalidate() {}, toast() {} },
      prompt: { submit: async value => { submitted.push(value); return {} } },
      http: { fetch: async (url, init) => {
        const path = new URL(url).pathname
        const data = path === '/api/state'
          ? { phase: 'idle', mediaConnected: true, voiceConfigured: true, selectedSession: 'owner',
              captionRevision: 0, updateCheck: queue.get('owner') }
          : path === '/api/claude/check-updates/claim'
            ? { request: queue.claim(JSON.parse(init.body).sessionId, JSON.parse(init.body).id) }
            : path === '/api/captions' ? { revision: 0, rows: [] } : { task: null }
        return { ok: true, text: JSON.stringify(data) }
      } },
    }
    const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }
    await handlers.get('session.start')($, {}, async () => {})
    await settle(); poll(); await settle(); poll(); await settle()
    assert.deepEqual(submitted, sessionId === 'owner' ? [{ text: updateCheckMessage, asUser: true }] : [])
  }
})
