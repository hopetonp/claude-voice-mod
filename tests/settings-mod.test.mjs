import assert from 'node:assert/strict'
import test from 'node:test'

const element = type => props => ({ type, ...props })
const elements = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Select: element('Select'),
  Input: element('Input'), Svg: element('Svg'), Client: element('Client') }
const words = tree => tree == null || typeof tree !== 'object' ? (typeof tree === 'string' ? [tree] : [])
  : Array.isArray(tree) ? tree.flatMap(words) : [...(tree.label ? [tree.label] : []), ...words(tree.children)]
const find = (tree, key) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, key)).find(Boolean) ?? null
    : tree.key === key ? tree : find(tree.children, key)
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate) }

test('the settings icon opens the pane in terminal and the HTML dialog in Desktop', async () => {
  const { register } = await import('../hooks/register.js?settings-pane')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  const opened = []
  const posted = []
  let saved = { id: 'openai-live', model: 'gpt-realtime', voice: 'marin', configured: true }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {}, resolve: () => elements,
      open: async pane => { opened.push(pane.id); return { isPlaced: true } }, close: async () => {} },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        posted.push([path, body])
        if (path === '/api/settings') saved = { ...saved, ...body }
      }
      const body = path === '/api/state' ? { phase: 'idle', mediaConnected: true }
        : path === '/api/settings' ? { providers: [saved], selectedProvider: 'openai-live' }
          : path === '/api/catalog' ? { models: ['gpt-realtime'], voices: [{ id: 'marin', name: 'Marin' }, { id: 'cedar', name: 'Cedar' }] }
            : { task: null }
      return { ok: true, status: 200, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start:')($, {}, async () => {})
  await handlers.get('ui.message:')($, { element: 'voice-icon-settings', data: { action: 'settings' } }, async () => {})
  await settle()
  assert.deepEqual(opened, ['voice-settings'])
  assert.ok(!posted.some(([path]) => path === '/api/setup-dialog'))

  const pane = () => handlers.get('ui.render:Pane')($, { component: 'Pane', requestId: 'voice-settings', surface: 'desktop' }, async () => null)
  assert.equal(find(await pane(), 'voice').value, 'marin')
  find(await pane(), 'voice').onSelect('cedar')
  await settle()
  assert.deepEqual(posted.at(-1), ['/api/settings', { id: 'openai-live', model: 'gpt-realtime', voice: 'cedar' }])
  assert.equal(find(await pane(), 'voice').value, 'cedar')
  assert.ok(words(await pane()).includes('Saved for the next Voice session.'))

  await handlers.get('ui.message:')($, { surface: 'desktop', element: 'voice-icon-settings', data: { action: 'settings' } }, async () => {})
  assert.deepEqual(posted.at(-1), ['/api/setup-dialog', {}])
  const strip = () => handlers.get('ui.render:AbovePrompt')($,
    { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 80 } }, async () => elements.Box({ children: [] }))
  assert.equal(find(await strip(), 'popup-voice'), null, 'Desktop uses the HTML dialog instead of a Mod card')
})

// A fresh Mod with a fake host whose catalog, settings saves and audio playback can be held open by hand.
async function startMod(name, { holdCatalog = false, holdSave = false, play = async () => {} } = {}) {
  const { register } = await import(`../hooks/register.js?${name}`)
  const handlers = new Map()
  register((event, options, handler) => handlers.set(`${event}:${options?.component ?? ''}`, handler ?? options))
  const posted = []
  const catalogs = []
  const catalogReplies = []
  const saves = []
  let current = { id: 'openai-live', model: 'gpt-realtime', voice: 'marin', configured: true }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    config: { list: async () => [] },
    audio: { play },
    ui: { invalidate() {}, log() {}, toast() {}, resolve: () => elements, open: async () => ({ isPlaced: true }) },
    http: { fetch: async (url, options = {}) => {
      const { pathname, searchParams } = new URL(url)
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        posted.push([pathname, body])
        if (pathname === '/api/provider-selection') current = { id: body.id, model: 'grok-voice', voice: 'Ara', configured: true }
        if (pathname === '/api/settings') {
          if (holdSave) await new Promise(resolve => saves.push(resolve))
          current = { ...current, ...body }
        }
      }
      let body = { task: null }
      if (pathname === '/api/state') body = { phase: 'idle', mediaConnected: true }
      else if (pathname === '/api/settings' || pathname === '/api/provider-selection') body = { providers: [current], selectedProvider: current.id }
      else if (pathname === '/api/preview') body = { base64: 'UklGRg==', mime: 'audio/wav' }
      else if (pathname === '/api/catalog') {
        catalogs.push(searchParams.get('provider'))
        if (holdCatalog) await new Promise(resolve => catalogReplies.push(resolve))
        body = { models: ['gpt-realtime'], voices: [{ id: current.voice, name: current.voice }, { id: `extra-${current.id}`, name: 'Extra' }] }
      }
      return { ok: true, status: 200, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start:')($, {}, async () => {})
  await handlers.get('ui.message:')($, { element: 'voice-icon-settings', data: { action: 'settings' } }, async () => {})
  await settle()
  const pane = () => handlers.get('ui.render:Pane')($, { component: 'Pane', requestId: 'voice-settings', surface: 'desktop' }, async () => null)
  return { pane, posted, catalogs, catalogReplies, saves }
}

const voiceValues = tree => find(tree, 'voice').options.map(option => option.value)

test('a provider change clears the old lists, and only the newest catalog reply is applied', async () => {
  const mod = await startMod('catalog-race', { holdCatalog: true })
  // Request 1 (opening the pane) is pending: only the saved voice is offered.
  assert.deepEqual(voiceValues(await mod.pane()), ['marin'])
  mod.catalogReplies[0]()
  await settle()
  assert.deepEqual(voiceValues(await mod.pane()), ['marin', 'extra-openai-live'])

  find(await mod.pane(), 'provider').onSelect('xai')
  await settle()
  // Request 2 is pending: the old provider's voices are gone, not selectable.
  assert.deepEqual(mod.catalogs, ['openai-live', 'xai'])
  assert.deepEqual(voiceValues(await mod.pane()), ['Ara'])

  find(await mod.pane(), 'provider').onSelect('gemini')
  await settle()
  assert.deepEqual(mod.catalogs, ['openai-live', 'xai', 'gemini'])
  mod.catalogReplies[2]()
  await settle()
  // The slow reply for the earlier provider arrives last and is ignored.
  mod.catalogReplies[1]()
  await settle()
  assert.deepEqual(voiceValues(await mod.pane()), ['Ara', 'extra-gemini'])
})

test('saving a replacement key refetches the catalog even when nothing else changed', async () => {
  const mod = await startMod('key-refetch')
  assert.deepEqual(mod.catalogs, ['openai-live'])
  find(await mod.pane(), 'api-key').onSubmit('sk-new')
  await settle()
  assert.deepEqual(mod.posted.at(-1), ['/api/settings', { id: 'openai-live', key: 'sk-new' }])
  assert.deepEqual(mod.catalogs, ['openai-live', 'openai-live'])
})

test('a press during a pending save shows a notice and is not posted twice', async () => {
  const mod = await startMod('busy-notice', { holdSave: true })
  find(await mod.pane(), 'voice').onSelect('cedar')
  await settle()
  find(await mod.pane(), 'voice').onSelect('marin')
  await settle()
  assert.ok(words(await mod.pane()).includes('Still working on the last change…'))
  assert.equal(mod.posted.filter(([path]) => path === '/api/settings').length, 1)
  mod.saves[0]()
  await settle()
})

test('preview does not hold the pane busy, and a failed playback is reported', async () => {
  let played = 0
  const mod = await startMod('preview-busy', { play: () => { played++; return new Promise(() => {}) } })
  find(await mod.pane(), 'preview').onPress()
  await settle()
  assert.equal(played, 1)
  // Playback never ends, yet the next change still goes through.
  find(await mod.pane(), 'voice').onSelect('cedar')
  await settle()
  assert.deepEqual(mod.posted.at(-1), ['/api/settings', { id: 'openai-live', model: 'gpt-realtime', voice: 'cedar' }])

  const failing = await startMod('preview-fails', { play: async () => { throw new Error('no audio') } })
  find(await failing.pane(), 'preview').onPress()
  await settle()
  assert.ok(words(await failing.pane()).includes('Preview could not play.'))
})

test('a typed key survives a redraw until it is saved', async () => {
  const mod = await startMod('key-draft')
  find(await mod.pane(), 'api-key').onInput('sk-par')
  assert.equal(find(await mod.pane(), 'api-key').value, 'sk-par')
  find(await mod.pane(), 'api-key').onSubmit('sk-part')
  await settle()
  assert.equal(find(await mod.pane(), 'api-key').value, '')
})

test('chat bubbles start off; switching them on and off saves to the file the bubble plugin reads', async () => {
  const { register } = await import('../hooks/register.js?settings-chat-bubbles')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  const files = new Map([['/home/test/.claude/voicemesh-controls/connection.json', JSON.stringify({ url: 'http://voice.test', token: 't' })]])
  const $ = {
    env: { get: async () => '/home/test' },
    fs: { read: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path) },
      write: async (path, text) => { files.set(path, text) } },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {}, resolve: () => elements, open: async () => ({ isPlaced: true }) },
    http: { fetch: async url => {
      const path = new URL(url).pathname
      const body = path === '/api/state' ? { phase: 'idle', mediaConnected: true }
        : path === '/api/settings' ? { providers: [{ id: 'openai-live', configured: true }], selectedProvider: 'openai-live' }
          : path === '/api/catalog' ? { models: [], voices: [] } : { task: null }
      return { ok: true, status: 200, text: JSON.stringify(body) }
    } },
  }
  await handlers.get('session.start:')($, {}, async () => {})
  await handlers.get('ui.message:')($, { element: 'voice-icon-settings', data: { action: 'settings' } }, async () => {})
  await settle()
  const pane = () => handlers.get('ui.render:Pane')($, { component: 'Pane', requestId: 'voice-settings', surface: 'desktop' }, async () => null)
  find(await pane(), 'section-general').onPress()
  assert.equal(find(await pane(), 'chat-bubbles').value, 'off')
  find(await pane(), 'chat-bubbles').onSelect('on')
  await settle()
  assert.deepEqual(JSON.parse(files.get('/home/test/.claude/voicemesh-controls/display.json')), { chatBubbles: true })
  assert.equal(find(await pane(), 'chat-bubbles').value, 'on')
  find(await pane(), 'chat-bubbles').onSelect('off')
  await settle()
  assert.deepEqual(JSON.parse(files.get('/home/test/.claude/voicemesh-controls/display.json')), { chatBubbles: false })
  assert.equal(find(await pane(), 'chat-bubbles').value, 'off')
})
