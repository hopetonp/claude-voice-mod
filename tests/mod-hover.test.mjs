import assert from 'node:assert/strict'
import test from 'node:test'

test('live voice keeps tooltip anchors stable through hover changes and resumes drawing after dismissal', async () => {
  const { register } = await import('../hooks/register.js?live-hover')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let poll, renders = 0, stateReads = 0, taskReads = 0
  const timers = []
  let phase = 'listening'
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test' }) },
    session: { id: async () => 'hover-session', cwd: async () => '/tmp' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: {
      every(_ms, callback) { poll = callback },
      after(ms, callback) {
        const timer = { ms, callback, cancelled: false }
        timers.push(timer)
        return { cancel() { timer.cancelled = true } }
      },
    },
    ui: {
      invalidate() { renders++ },
      resolve() { return Object.fromEntries(['Box', 'Button', 'Client', 'Svg', 'Text'].map(type =>
        [type, props => ({ type, props, children: props.children ?? [] })])) },
    },
    http: { fetch: async url => {
      const path = new URL(url).pathname
      if (path === '/api/state') stateReads++
      else taskReads++
      return { ok: true, text: JSON.stringify(path === '/api/state'
        ? { phase, mediaConnected: true, voiceConfigured: true,
            selectedSession: 'hover-session', captionRevision: 0, inputLevels: [stateReads], activeSeconds: stateReads }
        : path === '/api/captions' ? { revision: 0, rows: [] } : { task: null }) }
    } },
  }
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate) }
  const hover = (element, hovered) => handlers.get('ui.message')($,
    { element, data: { hoverOnly: true, hovered } }, async () => {})
  await handlers.get('session.start')($, {}, async () => {})
  await settle()
  const reads = stateReads, tasks = taskReads
  await hover('voice-icon-settings', true)
  let before = renders
  const drawing = async (hovered, expectedHint) => {
    const tree = await handlers.get('ui.render')($, { surface: 'desktop', props: {} }, async () => null)
    const nodes = []
    const walk = node => {
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
    const popovers = nodes.filter(node => node.type === 'Box' && node.props.position === 'absolute'
      && node.props.display === 'none' && node.props.hover?.display === 'flex' && !node.props.hover.scope)
    assert.equal(popovers.length, 1, 'only one native popover may exist in the row')
    if (expectedHint) assert.equal(popovers[0].children[0].children[0], expectedHint)
    const anchor = nodes.find(node => node.props.key === 'voice-tooltip-anchor')
    assert.ok(anchor)
    const row = anchor.children[0]
    assert.equal(anchor.props.marginLeft + row.props.marginLeft, 0, 'moving the anchor must not move the buttons')
    const settingsIcon = nodes.find(node => node.props.key === 'voice-control-settings').children[0].props.source
    const toggleIcon = nodes.find(node => node.props.key === 'voice-toggle-seat').children[0].props.source
    assert.equal(settingsIcon.includes('fill="#e5e4df"'), hovered === 'settings', 'settings hover background follows the active control')
    assert.equal(toggleIcon.includes('fill="#315ee8"'), hovered === 'toggle', 'toggle hover background follows the active control')
    return anchor.props.marginLeft
  }
  const settingsOffset = await drawing('settings')
  for (let i = 0; i < 3; i++) { poll(); await settle() }
  assert.equal(renders, before, 'audio levels and orb animation must not replace hovered anchors')
  assert.ok(stateReads > reads && taskReads > tasks, 'voice and coding bridge polling must continue')
  await hover('voice-icon-settings', false)
  await hover('voice-toggle', true)
  assert.equal(renders, before + 1, 'switching controls moves the single tooltip anchor once')
  before = renders
  assert.ok(await drawing('toggle') > settingsOffset, 'the tooltip must move right from Settings to the toggle')
  assert.equal(timers[0].cancelled, true, 'moving to the next control cancels the pending redraw')
  poll(); await settle()
  assert.equal(renders, before)
  await hover('voice-toggle', false)
  poll(); await settle()
  assert.equal(renders, before, 'wait for native tooltip dismissal before redrawing')
  assert.ok(timers.at(-1).ms > 150)
  timers.at(-1).callback()
  assert.equal(renders, before + 1, 'refresh once after leaving the controls')
  poll(); await settle()
  assert.ok(renders > before + 1, 'live animation resumes')
  phase = 'idle'
  poll(); await settle()
  await hover('voice-toggle', true)
  await drawing('toggle', 'Start voice')
  await handlers.get('ui.message')($,
    { element: 'voice-toggle', surface: 'desktop', data: { action: 'toggle' } }, async () => {})
  await drawing(undefined, 'Stop voice')
  const connectingRenders = renders
  phase = 'connecting'
  for (let i = 0; i < 3; i++) { poll(); await settle() }
  assert.equal(renders, connectingRenders, 'connecting animation must not restart on audio-level redraws')
  phase = 'listening'
  poll(); await settle()
  assert.ok(renders > connectingRenders, 'connection completion must still redraw')
  await drawing(undefined, 'Stop voice')
})
