import assert from 'node:assert/strict'
import test from 'node:test'

// Desktop does not redraw an existing request row. The voice's reply must be ready when Claude first draws it.
async function handOff({ name, rows: initialRows, delayTask = false, phase = 'speaking', noRoute = false }) {
  const { register } = await import(`../hooks/register.js?${name}`)
  const handlers = new Map()
  register((event, options, handler) => handlers.set(`${event}${options?.component ? `:${options.component}` : ''}`, handler ?? options))
  const events = []
  let clock
  let task = null
  let rows = initialRows
  let turns = delayTask && !noRoute ? [{ id: 'turn:1', state: 'pending', userCaptionIds: [] }] : []
  let revision = 2
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
    session: { id: async () => 'claude-session', cwd: async () => '/p/project' },
    command: { register: async () => {}, run: async ({ args }) => { events.push(`said ${args}`) } },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    prompt: { submit: async ({ text }) => { events.push(`submit ${text}`); return { isSubmitted: true } } },
    ui: { invalidate() {}, log() {}, toast() {}, resolve: () => ({
      Box: props => ({ type: 'Box', ...props }), Text: props => ({ type: 'Text', ...props }), Svg: props => ({ type: 'Svg', ...props }) }) },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      const body = path === '/api/state' ? { phase, mediaConnected: true, voiceConfigured: true, classifierEnabled: true, captionRevision: revision, selectedSession: 'claude-session' }
        : path === '/api/captions' ? { revision, rows, turns }
          : path === '/api/claude/request' && options.method !== 'POST' ? { task }
            : { ok: true }
      return { ok: true, status: 200, text: JSON.stringify(body) }
    } },
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate) }
  await handlers.get('session.start')($, {}, async () => {})
  const queue = async () => {
    task = { id: 'request:1', text: 'Read the README title', mode: 'submit', status: 'queued', turnId: null }
    turns = noRoute ? [] : [{ id: 'turn:1', state: 'coding', userCaptionIds: ['u1'], requestId: task.id }]
    revision += 1
    clock()
    await settle()
  }
  if (!delayTask) await queue()
  const render = () => handlers.get('ui.render:UserMessage')($, { props: { text: 'Read the README title', isExpanded: false } },
    async () => ({ type: 'Text', children: ['Read the README title'] }))
  // A caption update does not discard the host's already-claimed request.
  const grow = async next => { rows = next; revision += 1; clock(); await settle() }
  return { events, render, grow, queue }
}

const textOf = tree => JSON.stringify(tree)

test("the spoken acknowledgement is attached to Claude's request when it first renders", async () => {
  const { events, render, grow } = await handOff({ name: 'handoff-under', rows: [
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: true, spokenAt: 10, createdRevision: 1 },
    { id: 'r1', role: 'assistant', text: 'Okay, starting that.', delegated: false, final: true, spokenAt: 900, createdRevision: 2 },
  ] })
  assert.deepEqual(events, ['submit Read the README title'])
  assert.match(textOf(await render()), /Read the README title.*Okay, starting that\./)
})

test('a late acknowledgement is captured before the request is submitted', async () => {
  const { events, render, grow } = await handOff({ name: 'handoff-later', rows: [
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: true, spokenAt: 10, createdRevision: 1 },
  ] })
  assert.deepEqual(events, [], 'wait for the voice reply')
  await grow([
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: true, spokenAt: 10, createdRevision: 1 },
    { id: 'r1', role: 'assistant', text: 'Checking.', delegated: false, final: true, spokenAt: 1200, createdRevision: 3 },
  ])
  assert.deepEqual(events, ['submit Read the README title'])
  assert.match(textOf(await render()), /Read the README title.*Checking\./)
})

test('playback ending submits a coding request before the caption is finalized at standby', async () => {
  const { events, render } = await handOff({ name: 'handoff-listening', phase: 'listening', rows: [
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: true, spokenAt: 10, createdRevision: 1 },
    { id: 'r1', role: 'assistant', text: 'Checking.', delegated: false, final: false, spokenAt: 900, createdRevision: 2 },
  ] })
  assert.deepEqual(events, ['submit Read the README title'])
  const drawing = await render()
  assert.match(textOf(drawing), /Read the README title.*Checking\./)
  assert.equal(drawing.width, undefined, 'the engine request cannot be wrapped in a Box with width')
})

test('an acknowledgement spoken before classification finishes stays with the native request', async () => {
  const { events, render, queue } = await handOff({ name: 'handoff-routing-delay', delayTask: true, rows: [
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: false, final: true, spokenAt: 10, createdRevision: 1 },
    { id: 'r1', role: 'assistant', text: 'Checking.', delegated: false, final: true, spokenAt: 900, createdRevision: 2 },
  ] })
  assert.deepEqual(events, [], 'do not post the acknowledgement before routing finishes')
  await queue()
  assert.deepEqual(events, ['submit Read the README title'])
  assert.match(textOf(await render()), /Read the README title.*Checking\./)
})

test('a tool-based realtime coding request submits without a GPT Live routing record', async () => {
  const { events, render } = await handOff({ name: 'handoff-realtime-tool', noRoute: true, phase: 'listening', rows: [
    { id: 'u1', role: 'user', text: 'Read the README title', delegated: false, final: true, spokenAt: 10, createdRevision: 1 },
    { id: 'r1', role: 'assistant', text: 'Checking.', delegated: false, final: true, spokenAt: 900, createdRevision: 2 },
  ] })
  assert.deepEqual(events, ['submit Read the README title'])
  assert.match(textOf(await render()), /Read the README title.*Checking\./)
})

test('a realtime acknowledgement stays under its request when admission arrives after the caption', async () => {
  const { events, render, queue } = await handOff({ name: 'handoff-realtime-late-admission',
    delayTask: true, noRoute: true, phase: 'listening', rows: [
      { id: 'u1', role: 'user', text: 'Read the README title', delegated: true, final: true, spokenAt: 10, createdRevision: 1 },
      { id: 'r1', role: 'assistant', text: 'Checking.', delegated: false, final: true, spokenAt: 900, createdRevision: 2 },
    ] })
  assert.deepEqual(events, [], 'the acknowledgement must wait for the coding request')
  await queue()
  assert.deepEqual(events, ['submit Read the README title'])
  assert.match(textOf(await render()), /Read the README title.*Checking\./)
})
