import assert from 'node:assert/strict'
import test from 'node:test'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }
const elements = Object.fromEntries(['Box', 'Client', 'Svg', 'Text'].map(type => [type, props => ({ type, ...props })]))
const find = (tree, predicate) => !tree || typeof tree !== 'object' ? undefined
  : Array.isArray(tree) ? tree.map(item => find(item, predicate)).find(Boolean)
    : predicate(tree) ? tree : find(tree.children, predicate)

test('voice controls load in every session while a busy bridge keeps history pending', { timeout: 2000 }, async () => {
  const selected = 'owner'
  const instances = []
  try {
    for (const id of ['owner', 'other']) {
      const { register } = await import(`../hooks/register.js?visibility-${id}`)
      const handlers = new Map()
      register((event, options, handler) => handlers.set(`${event}:${options?.component ?? ''}`, handler ?? options))
      let release, releaseStorage, timer, nextCalled = false, timers = 0
      const pending = new Promise(resolve => { release = resolve })
      const storage = new Promise(resolve => { releaseStorage = resolve })
      instances.push({ release, releaseStorage })
      const $ = {
        env: { get: async () => '/tmp' },
        fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
        session: { id: async () => id, cwd: async () => '/project', surfaces: async () => [] },
        store: { get: async () => { await storage; return [] }, set: async () => {} },
        clock: { every(_ms, callback) { timer = callback; timers++ } },
        ui: { invalidate() {}, resolve: () => elements },
        http: { fetch: async url => {
          const path = new URL(url).pathname
          if (path === '/api/claude/request') await pending
          return { ok: true, text: JSON.stringify(path === '/api/state'
            ? { phase: 'listening', voiceConfigured: true, mediaConnected: true, selectedSession: selected, captionRevision: 0 }
            : path === '/api/captions' ? { revision: 0, rows: [] } : { task: null }) }
        } },
      }
      const startup = handlers.get('session.start:')($, {}, async () => { nextCalled = true })
      await startup
      assert.equal(nextCalled, true, `${id}: history storage must not block session startup`)
      assert.equal(timers, 1)
      const render = () => handlers.get('ui.render:AbovePrompt')($,
        { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 80 } }, async () => null)
      const immediate = await render()
      assert.ok(find(immediate, node => node.key === 'voice-toggle'), `${id}: controls appear immediately`)
      assert.ok(find(immediate, node => node.type === 'Text' && node.children?.includes('Loading voice history...')))
      releaseStorage()
      await settle()
      const tree = await render()
      assert.ok(find(tree, node => node.key === 'voice-toggle'), `${id}: voice controls remain visible`)
      assert.ok(find(tree, node => node.alt === (id === selected ? 'Stop voice' : 'Start voice')),
        `${id}: only the owner displays active voice`)
      if (id === selected) assert.ok(find(tree, node => node.type === 'Text' && node.children?.includes('Loading voice history...')), 'pending bridge keeps the history status visible')
      timer(); await settle()
      assert.ok(find(await render(), node => node.key === 'voice-toggle'), `${id}: visible while polling a busy session`)
      release(); await settle()
      assert.equal(find(await render(), node => node.type === 'Text' && node.children?.includes('Loading voice history...')), undefined, 'history status clears after loading finishes')
    }
  } finally {
    for (const instance of instances) { instance.releaseStorage(); instance.release() }
    await settle()
  }
})
