import assert from 'node:assert/strict'
import test from 'node:test'

const element = type => props => ({ type, ...props })
const find = (tree, match) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, match)).find(Boolean) ?? null
    : match(tree) ? tree : find(tree.children, match)

test('the voice strip shows the live line on its left while the user talks', async () => {
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let clock
  let state = { phase: 'listening', mediaConnected: true, voiceConfigured: true, transcript: '', lastReply: '' }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {},
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async url => ({ ok: true, text: JSON.stringify(new URL(url).pathname === '/api/state' ? state : { task: null }) }) },
  }
  try {
    const { register } = await import('../hooks/register.js?live-line-render')
    const handlers = new Map()
    register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
    await handlers.get('session.start:')($, {}, async () => {})
    state = { ...state, transcript: 'Everything I say streams here as I speak' }
    now = 1100
    clock(); await new Promise(setImmediate)
    const strip = await handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt' }, async () => null)
    const words = find(strip, node => node.type === 'Text' && node.wrap === 'truncate-start')
    assert.ok(words, 'the spoken words keep their newest end visible')
    assert.deepEqual(words.children, ['Everything I say streams here as I speak'])
    assert.ok(!find(strip, node => node.type === 'Text' && ['You', 'Voice'].includes(node.children?.[0])), 'no speaker label')
  } finally { Date.now = realNow }
})

// A mod session with a controllable clock, host state and invalidate counter.
async function strip(tag, initial) {
  const element = type => props => ({ type, ...props })
  let now = 100000
  let clock
  let invalidated = 0
  let state = { phase: 'listening', mediaConnected: true, voiceConfigured: true, transcript: '', lastReply: '', ...initial }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    ui: { invalidate() { invalidated++ }, log() {}, toast() {},
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async url => ({ ok: true, text: JSON.stringify(new URL(url).pathname === '/api/state' ? state : { task: state.task ?? null }) }) },
  }
  Date.now = () => now
  const { register } = await import(`../hooks/register.js?${tag}`)
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  await handlers.get('session.start:')($, {}, async () => {})
  return {
    invalidated: () => invalidated,
    set: (patch, at) => { state = { ...state, ...patch }; now = at },
    tick: async at => { now = at; clock(); await new Promise(setImmediate) },
    render: () => handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt' }, async () => null),
    turn: async (event, payload) => handlers.get(`${event}:`)($, payload, async () => ({})),
  }
}

test('the live line gives the controls room: its box has no basis of its own', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('line-width', {})
    ui.set({ transcript: 'x'.repeat(300) }, 101100)
    await ui.tick(101100)
    const tree = await ui.render()
    const box = find(tree, node => node.type === 'Box' && node.flexGrow === 1 && node.minWidth === 0 && node.marginRight === 2)
    assert.ok(box, 'the live line box is drawn')
    assert.equal(box.width, 0)
  } finally { Date.now = realNow }
})

test('the voice row does not draw an inner border or fill', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('voice-row-theme', { theme: 'light' })
    const row = tree => find(tree, node => node.type === 'Box' && node.columnGap === 0.5 && node.paddingX === 0)
    const lightTree = await ui.render()
    const light = row(lightTree)
    assert.deepEqual([lightTree.borderStyle, lightTree.borderColor], [undefined, undefined])
    assert.deepEqual([light?.borderStyle, light?.borderColor, light?.backgroundColor], [undefined, undefined, undefined])
    assert.equal(light?.paddingY, 0)
    assert.equal(light?.marginY, undefined, 'the row does not reach outside Claude’s band')
    assert.equal(find(lightTree, node => node.type === 'Svg' && node.alt === 'Voice listening')?.height, 28)
    ui.set({ theme: 'dark' }, 100500)
    await ui.tick(100500)
    const darkTree = await ui.render()
    const dark = row(darkTree)
    assert.deepEqual([darkTree.borderStyle, darkTree.borderColor], [undefined, undefined])
    assert.deepEqual([dark?.borderStyle, dark?.borderColor, dark?.backgroundColor], [undefined, undefined, undefined])
  } finally { Date.now = realNow }
})

test('the voice button is drawn at its 28 pixel size, its seat and click target 1.4 rows tall', async () => {
  const ui = await strip('voice-button-size', { phase: 'idle' })
  const tree = await ui.render()
  const button = find(tree, node => node.type === 'Svg' && node.source?.includes('<circle cx="17" cy="17" r="16"'))
  const target = find(tree, node => node.type === 'Client' && node.key === 'voice-toggle')
  assert.deepEqual([button?.width, button?.height], [28, 28])
  assert.match(button.source, /width="28" height="28" viewBox="0 0 34 34"/)
  assert.deepEqual([target?.width, target?.height], [4, 1.4])
})

test('the live clock uses the selected locale’s numerals', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('localized-clock', { locale: 'ar-EG', activeSeconds: 68 })
    const clockText = tree => find(tree, node => node.type === 'Text' && node.children?.[0] === '١:٠٨')
    assert.ok(clockText(await ui.render()), 'Arabic locale uses Arabic digits')
    ui.set({ locale: 'en-US' }, 100500)
    await ui.tick(100500)
    assert.ok(find(await ui.render(), node => node.type === 'Text' && node.children?.[0] === '1:08'), 'English retains the familiar clock')
    ui.set({ locale: 'zh-Hant' }, 101000)
    await ui.tick(101000)
    assert.ok(find(await ui.render(), node => node.type === 'Text' && node.children?.[0] === '一:〇八'), 'Chinese uses Chinese numerals')
    ui.set({ locale: 'hi-IN' }, 101500)
    await ui.tick(101500)
    assert.ok(find(await ui.render(), node => node.type === 'Text' && node.children?.[0] === '१:०८'), 'Hindi uses Devanagari numerals')
  } finally { Date.now = realNow }
})

test('the gray orb stays visible while voice is off and connecting', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('voice-off-orb', { phase: 'idle' })
    const off = tree => find(tree, node => node.type === 'Svg' && node.alt === 'Voice off')
    const first = off(await ui.render())
    assert.ok(first, 'the off orb is visible')
    assert.ok(first.source.includes('#aab1bb') && first.source.includes('aria-label="Voice off"'), 'it is gray and labelled')
    await ui.tick(101600)
    assert.equal(off(await ui.render()).source, first.source, 'the off orb does not animate')
    ui.set({ phase: 'connecting' }, 101700)
    await ui.tick(101700)
    const connecting = find(await ui.render(), node => node.type === 'Svg' && node.alt === 'Voice connecting')
    assert.ok(connecting?.source.includes('#aab1bb'), 'the gray orb remains while connecting')
    assert.equal(connecting.source, first.source.replace('Voice off', 'Voice connecting'), 'the orb does not visually blink at connection start')
    ui.set({ phase: 'listening', transcript: 'Recent words' }, 101800)
    await ui.tick(101800)
    ui.set({ phase: 'idle' }, 101900)
    await ui.tick(101900)
    assert.ok(off(await ui.render()), 'a recent caption cannot hide the off orb')
    ui.set({ phase: 'offline', mediaConnected: false }, 102000)
    await ui.tick(102000)
    assert.ok(off(await ui.render()), 'the orb remains visible if the host is offline')
  } finally { Date.now = realNow }
})

test('the Voice row follows Claude’s display locale', async () => {
  const realNow = Date.now
  try {
    const { voiceText } = await import('../hooks/voice-status-i18n.js')
    const ui = await strip('voice-row-locale', { phase: 'connecting', locale: 'en-US' })
    assert.ok(find(await ui.render(), node => node.type === 'Text' && node.children?.[0] === 'Connecting…'))
    const redraws = ui.invalidated()
    ui.set({ locale: 'zh-Hant' }, 100500)
    await ui.tick(100500)
    assert.ok(ui.invalidated() > redraws, 'switching Claude’s locale redraws the row')
    const tree = await ui.render()
    assert.notEqual(voiceText('zh-Hant', 'orb.connecting'), voiceText('en', 'orb.connecting'))
    assert.ok(find(tree, node => node.type === 'Svg' && node.alt === voiceText('zh-Hant', 'orb.connecting')), 'the orb label is translated')
    assert.ok(find(tree, node => node.type === 'Text' && node.children?.[0] === voiceText('zh-Hant', 'status.connectingShort')), 'the connecting status is translated')
    ui.set({ phase: 'standby' }, 101000)
    await ui.tick(101000)
    assert.ok(find(await ui.render(), node => node.type === 'Text' && node.children?.[0] === voiceText('zh-Hant', 'status.standby')), 'standby is translated')
  } finally { Date.now = realNow }
})

test('the strip redraws once when the live line goes away', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('line-clears', {})
    ui.set({ transcript: 'Hello there' }, 101100)
    await ui.tick(101100)
    const before = ui.invalidated()
    await ui.tick(109000)
    assert.ok(ui.invalidated() > before, 'the vanished line is redrawn')
    // While voice listens the resting orb breathes, so redraws go on; with nothing to animate they stop.
    ui.set({ phase: 'standby' }, 109250)
    await ui.tick(109250)
    const after = ui.invalidated()
    await ui.tick(109500)
    assert.equal(ui.invalidated(), after, 'and no redraw loop afterwards')
  } finally { Date.now = realNow }
})

test('a Mod reload does not show the host\'s old words as a fresh line', async () => {
  const realNow = Date.now
  try {
    const ui = await strip('line-reload', { transcript: 'Old words from before', lastReply: 'An old reply' })
    await ui.tick(101100)
    const words = find(await ui.render(), node => node.type === 'Text' && node.wrap === 'truncate-start')
    assert.equal(words, null, 'only new changes show')
  } finally { Date.now = realNow }
})

test("the voice's line leads with an orb that moves with its audio; the user's line has none", async () => {
  const realNow = Date.now
  try {
    const ui = await strip('line-orb', {})
    ui.set({ transcript: 'What time is it' }, 101100)
    await ui.tick(101100)
    const isOrb = node => node.type === 'Svg' && node.alt === 'Voice speaking'
    assert.equal(find(await ui.render(), isOrb), null, 'nothing marks the user speaking')
    ui.set({ phase: 'speaking', lastReply: 'It is three o clock', outputLevels: [.1, .1, .1, .1, .1, .1, .1, .1, .1] }, 104000)
    await ui.tick(104000)
    const quiet = find(await ui.render(), isOrb)
    assert.ok(quiet, 'the orb leads the voice line')
    ui.set({ outputLevels: [.9, .9, .9, .9, .9, .9, .9, .9, .9] }, 104200)
    await ui.tick(104200)
    const loud = find(await ui.render(), isOrb)
    assert.notEqual(loud.source, quiet.source, 'the orb follows the voice level')
  } finally { Date.now = realNow }
})

test('with voice live and nobody talking, a resting orb breathes; Claude at work is named beside it', async () => {
  const realNow = Date.now
  try {
    const isResting = node => node.type === 'Svg' && node.alt === 'Voice listening'
    const working = tree => find(tree, node => node.type === 'Text' && node.children?.[0] === 'Claude is working…')
    const ui = await strip('line-resting', {})
    await ui.tick(101100)
    const quiet = await ui.render()
    const orb = find(quiet, isResting)
    assert.ok(orb, 'the resting orb shows while voice listens')
    assert.notEqual(orb.isInteractive, true, 'an interactive SVG draws in a framed box on desktop')
    await ui.tick(102700)
    assert.notEqual(find(await ui.render(), isResting).source, orb.source, 'it breathes from one redraw to the next')
    assert.equal(working(quiet), null)
    await ui.turn('turn.start', { text: 'Read the README', turnId: 't1' })
    assert.ok(working(await ui.render()), 'Claude at work is named')
    await ui.turn('turn.complete', { turnId: 't1', reason: 'answer', answer: 'Done' })
    assert.equal(working(await ui.render()), null, 'and cleared when the turn ends')
    ui.set({ transcript: 'Hello there' }, 101300)
    await ui.tick(101300)
    assert.equal(find(await ui.render(), isResting), null, 'the user talking shows only their words')
    ui.set({ phase: 'standby' }, 120000)
    await ui.tick(120000)
    const idle = await ui.render()
    assert.equal(find(idle, isResting), null, 'standby with nothing running is not shown as listening')
    const gray = find(idle, node => node.type === 'Svg' && node.alt === 'Voice on standby')
    assert.ok(gray && gray.source.includes('#aab1bb') && !gray.source.includes('#4fc3f7'), 'but as a gray orb')
    await ui.turn('turn.start', { text: 'Run the tests', turnId: 't2' })
    const parked = await ui.render()
    assert.ok(find(parked, isResting) && working(parked), 'in standby, Claude at work still shows with the orb')
    await ui.tick(121600)
    assert.equal(find(await ui.render(), isResting).source, find(parked, isResting).source, 'the orb holds still in standby')
    await ui.turn('turn.complete', { turnId: 't2', reason: 'answer', answer: 'Done' })
    const done = await ui.render()
    assert.equal(find(done, isResting), null, 'and goes once the work is done')
    assert.ok(find(done, node => node.type === 'Svg' && node.alt === 'Voice on standby'), 'back to gray')
  } finally { Date.now = realNow }
})

test('after a Mod reload mid-request, Claude at work still shows, learned from the host', async () => {
  const realNow = Date.now
  try {
    const task = { id: 'request:1', text: 'Run the tests', status: 'running', mode: 'submit', sessionId: 'claude-session', turnId: 't1' }
    const ui = await strip('line-reload-working', { phase: 'standby', task })
    await ui.tick(101100)
    const tree = await ui.render()
    assert.ok(find(tree, node => node.type === 'Text' && node.children?.[0] === 'Claude is working…'), 'named from the host')
    assert.ok(find(tree, node => node.type === 'Svg' && node.alt === 'Voice listening'), 'with the orb, in standby')
  } finally { Date.now = realNow }
})

test('a claimed voice request does not say Claude is working before a turn starts', async () => {
  const task = { id: 'request:2', text: 'Run the tests', status: 'claimed', mode: 'submit', sessionId: 'claude-session', turnId: null }
  const ui = await strip('line-claimed-not-working', { phase: 'standby', task })
  await ui.tick(101100)
  const tree = await ui.render()
  assert.equal(find(tree, node => node.type === 'Text' && node.children?.[0] === 'Claude is working…'), null)
  assert.ok(find(tree, node => node.type === 'Svg' && node.alt === 'Voice on standby'))
})

test('if the voice row fails to draw, a minimal row with the start button is drawn and the error is written', async () => {
  const { register } = await import('../hooks/register.js?draw-error')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  const files = new Map()
  const $ = {
    env: { get: async () => '/home/test' },
    fs: { read: async path => { if (files.has(path)) return files.get(path); if (path.endsWith('connection.json')) return JSON.stringify({ url: 'http://voice.test', token: 't' }); throw new Error('missing') },
      write: async (path, text) => { files.set(path, text) } },
    session: { id: async () => 'claude-session', cwd: async () => '/p/deepseek-harness' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every() {} },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {},
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Client: element('Client'),
        Svg: () => { throw new Error('Svg exploded') } }) },
    http: { fetch: async () => ({ ok: true, text: JSON.stringify({ phase: 'idle', mediaConnected: true }) }) },
  }
  await handlers.get('session.start:')($, {}, async () => {})
  const tree = await handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt', surface: 'desktop' }, async () => null)
  assert.ok(find(tree, node => node.type === 'Client' && node.key === 'voice-toggle'), 'the start button is still there')
  await new Promise(setImmediate)
  const log = files.get('/home/test/.claude/voicemesh-controls/draw-errors.log') ?? ''
  assert.match(log, /\/p\/deepseek-harness .*Svg exploded/)
})
