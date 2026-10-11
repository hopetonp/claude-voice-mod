# Voice Settings Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate macOS settings window with a Claude Code pane, drawn from Claude's own controls, that docks on the right of the Desktop Code tab.

**Architecture:** The Mod opens a pane with `$.ui.open({ id: 'voice-settings' })` when the person presses the existing settings icon, and draws it in a `ui.render` hook for `{ component: 'Pane', requestId: 'voice-settings' }`. The pane has two collapsible sections, **General** and **Speech & Voice**, following DeepSeek's layout. Every value is still read and saved through the local host's existing authenticated settings API. The Mod only draws and forwards. Voice previews come back from the host as WAV and play through `$.audio.play`.

**Tech Stack:** Claude Code Mod API (v2.1.288: `$.ui.open`, `ui.render`, `Box`/`Text`/`Button`/`Select`/`Input`, `$.http.fetch`, `$.audio.play`), Node 24 host (`host/server.js`), `node:test`.

## Global Constraints

- Desktop only. The terminal, VS Code, mobile and the browser are out of scope. Per Anthropic's "Where mods run" table, only the terminal and Desktop draw Mod UI, and the person chose not to support the terminal.
- Use Claude's standard controls only: `Box`, `Text`, `Button`, `Select`, `Input`. No custom cards, colours or SVG in the pane. It must look native to Claude.
- Claude's elements have no `disabled` prop, no checkbox, no slider and no masked input. On/off settings become `Select` On/Off. Standby becomes a `Select` of preset times. Actions guard against double presses in code.
- The host stays the only owner of settings and keys. The Mod never stores a key and never receives one back, only `configured: true/false`.
- Both sections start collapsed, like DeepSeek.
- This plan covers **Realtime** providers only (GPT Live, OpenAI Realtime, xAI Grok, Gemini Live). The Realtime/Pipeline switch and pipeline groups come in Plan 2 (see Roadmap).
- The project is not a git repository, so there are no commit steps. Each task ends with its tests passing instead.
- Baseline before starting: `node --test tests/` gives 61 tests and all 61 pass. Nothing may fail at any step.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `host/wav.js` | Wrap 16-bit mono PCM in a WAV container |
| Modify `host/server.js` | `/api/preview` returns WAV when asked (`format: 'wav'`); later, remove the settings-window routes |
| Create `hooks/settings-api.js` | The Mod's calls to the host's settings endpoints, plus `preferences()` mapping |
| Create `hooks/settings-pane.js` | Pure drawing: section summaries, standby choices, the pane's element tree |
| Modify `hooks/register.js` | Open the pane from the settings icon, hold pane state, bind actions, render hook |
| Create `tests/wav.test.mjs`, `tests/settings-api.test.mjs`, `tests/settings-pane.test.mjs`, `tests/settings-mod.test.mjs` | Tests |
| Modify `tests/mod-icons.test.mjs` | The settings icon opens the pane instead of posting `/api/setup-dialog` |
| Delete `setup/`, `.settings-window/`, `dist-setup/`, `scripts/build-settings-window.js` | The old window, after the pane is verified |
| Modify `package.json`, `README.md` | Drop `setup:build` and React, and describe the pane |

---

### Task 1: Host returns voice previews as WAV

`/api/preview` returns raw 16-bit PCM (`{ audio, sampleRate }`) for the old web page's player. `$.audio.play` needs a playable file (`{ base64, mime }`), so the host wraps the PCM when the pane asks for `format: 'wav'`.

**Files:**
- Create: `host/wav.js`
- Modify: `host/server.js:161-175` (the `/api/preview` route)
- Test: `tests/wav.test.mjs`

**Interfaces:**
- Produces: `pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer`; `POST /api/preview` with body `{ voice, format: 'wav' }` → `{ base64: string, mime: 'audio/wav' }`. Without `format`, the reply is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// tests/wav.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { pcm16ToWav } from '../host/wav.js'

test('wraps 16-bit mono PCM in a 44-byte WAV header', () => {
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0])
  const wav = pcm16ToWav(pcm, 24000)
  assert.equal(wav.length, 44 + pcm.length)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length)
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ')
  assert.equal(wav.readUInt16LE(20), 1, 'PCM')
  assert.equal(wav.readUInt16LE(22), 1, 'mono')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt32LE(28), 48000, 'byte rate')
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample')
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(40), pcm.length)
  assert.deepEqual(wav.subarray(44), pcm)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/wav.test.mjs`
Expected: FAIL with `Cannot find module '.../host/wav.js'`

- [ ] **Step 3: Write the implementation**

```js
// host/wav.js
/** Wraps 16-bit mono PCM in a WAV container, so Claude's audio player can play a voice preview. */
export function pcm16ToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/wav.test.mjs`
Expected: PASS

- [ ] **Step 5: Let `/api/preview` answer in WAV**

In `host/server.js`, add the import beside the other host imports:

```js
import { pcm16ToWav } from './wav.js'
```

In the `/api/preview` route, change `const { voice } = await readJson(request)` to:

```js
      const { voice, format } = await readJson(request)
```

and change `send(response, 200, sample)` to:

```js
        send(response, 200, format === 'wav'
          ? { base64: pcm16ToWav(Buffer.from(sample.audio, 'base64'), sample.sampleRate).toString('base64'), mime: 'audio/wav' }
          : sample)
```

- [ ] **Step 6: Check the host still parses**

Run: `node --check host/server.js && node --test tests/`
Expected: no syntax error; 62 tests, all pass.

---

### Task 2: The Mod's settings calls to the host

**Files:**
- Create: `hooks/settings-api.js`
- Test: `tests/settings-api.test.mjs`

**Interfaces:**
- Consumes: Task 1's `/api/preview` `{ voice, format: 'wav' }` → `{ base64, mime }`.
- Produces:
  - `preferences(reply: { providers?: object[], selectedProvider?: string }): Prefs`, where `Prefs = { provider, model, voice, voiceStandbySec, statusSounds, responseDetail, progressMode, backchannelEnabled, endConversationEnabled, configured }`
  - `settingsApi(fetch, connection: { url, token })`, where `fetch` is the Mod's `$.http.fetch` wrapped in `register.js`, because the Mod validator follows `$` only inside the file that uses it → `{ load(): Promise<Prefs>, selectProvider(id): Promise<Prefs>, save(provider, fields): Promise<Prefs>, catalog(provider, model): Promise<{ models: string[], voices: { id, name }[] }>, preview(voice): Promise<{ base64, mime }>, probeConnection(): Promise<boolean>, probeAudioTools(): Promise<boolean> }`. Every method rejects with the host's `error` text when the host answers non-2xx.

- [ ] **Step 1: Write the failing test**

```js
// tests/settings-api.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { preferences, settingsApi } from '../hooks/settings-api.js'

const reply = { selectedProvider: 'xai', providers: [
  { id: 'openai-live', model: 'gpt-realtime', voice: 'marin', configured: true },
  { id: 'xai', model: 'grok-voice', voice: 'Ara', configured: true, responseDetail: 'detailed', voiceStandbySec: 60 },
] }

test('preferences reads the selected provider and fills defaults', () => {
  assert.deepEqual(preferences(reply), { provider: 'xai', model: 'grok-voice', voice: 'Ara', voiceStandbySec: 60,
    statusSounds: true, responseDetail: 'detailed', progressMode: 'outcome', backchannelEnabled: false,
    endConversationEnabled: false, configured: true })
  assert.equal(preferences({}).provider, 'openai-live')
  assert.equal(preferences({}).configured, false)
})

test('settingsApi sends the bearer token and JSON bodies, and maps replies', async () => {
  const calls = []
  const $ = { http: { fetch: async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', auth: options.headers.Authorization, body: options.body && JSON.parse(options.body) })
    const path = new URL(url).pathname
    const body = path === '/api/catalog' ? { models: [{ id: 'grok-voice' }, 'grok-2'], voices: [{ id: 'Ara', name: 'Ara' }] }
      : path === '/api/preview' ? { base64: 'UklGRg==', mime: 'audio/wav' }
        : path.startsWith('/api/diagnostics') ? { ready: true } : reply
    return { ok: true, status: 200, text: JSON.stringify(body) }
  } } }
  const api = settingsApi($.http.fetch, { url: 'http://voice.test', token: 'secret' })
  assert.equal((await api.load()).provider, 'xai')
  await api.save('xai', { voice: 'Rex' })
  assert.deepEqual(await api.catalog('xai', 'grok-voice'), { models: ['grok-voice', 'grok-2'], voices: [{ id: 'Ara', name: 'Ara' }] })
  assert.deepEqual(await api.preview('Ara'), { base64: 'UklGRg==', mime: 'audio/wav' })
  assert.equal(await api.probeConnection(), true)
  assert.ok(calls.every(call => call.auth === 'Bearer secret'))
  assert.deepEqual(calls[1], { url: 'http://voice.test/api/settings', method: 'POST', auth: 'Bearer secret', body: { id: 'xai', voice: 'Rex' } })
  assert.equal(calls[2].url, 'http://voice.test/api/catalog?provider=xai&model=grok-voice')
  assert.deepEqual(calls[3].body, { voice: 'Ara', format: 'wav' })
})

test('settingsApi rejects with the host error text', async () => {
  const $ = { http: { fetch: async () => ({ ok: false, status: 409, text: JSON.stringify({ error: 'Stop Voice before changing providers' }) }) } }
  await assert.rejects(settingsApi($.http.fetch, { url: 'http://voice.test', token: 't' }).selectProvider('xai'), /Stop Voice before changing providers/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/settings-api.test.mjs`
Expected: FAIL with `Cannot find module '.../hooks/settings-api.js'`

- [ ] **Step 3: Write the implementation**

```js
// hooks/settings-api.js
// The settings pane's calls to the local VoiceMesh host. The host keeps every value and key; a
// saved key never comes back, only whether one is configured.

const DEFAULTS = { provider: 'openai-live', model: '', voice: '', voiceStandbySec: 30, statusSounds: true,
  responseDetail: 'concise', progressMode: 'outcome', backchannelEnabled: false, endConversationEnabled: false }

/** The selected provider's preferences from a host settings reply. */
export function preferences({ providers = [], selectedProvider } = {}) {
  const provider = selectedProvider || DEFAULTS.provider
  const value = providers.find(item => item.id === provider) ?? {}
  const pick = field => value[field] ?? DEFAULTS[field]
  return { provider, model: pick('model'), voice: pick('voice'), voiceStandbySec: pick('voiceStandbySec'),
    statusSounds: pick('statusSounds'), responseDetail: pick('responseDetail'), progressMode: pick('progressMode'),
    backchannelEnabled: pick('backchannelEnabled'), endConversationEnabled: pick('endConversationEnabled'),
    configured: !!value.configured }
}

/**
 * Host calls bound to one connection: a GET without a body, a JSON POST with one. Takes the Mod's
 * fetch rather than `$`, because the Mod validator follows `$` only inside the file that uses it.
 */
export function settingsApi(fetch, connection) {
  const request = async (path, body) => {
    const headers = { Authorization: `Bearer ${connection.token}` }
    const response = await fetch(`${connection.url}${path}`, body === undefined ? { headers }
      : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = response.text ? JSON.parse(response.text) : {}
    if (!response.ok) throw new Error(value.error || `Voice host returned ${response.status}`)
    return value
  }
  return {
    load: async () => preferences(await request('/api/settings')),
    selectProvider: async id => preferences(await request('/api/provider-selection', { id })),
    save: async (provider, fields) => preferences(await request('/api/settings', { id: provider, ...fields })),
    catalog: async (provider, model) => {
      const value = await request(`/api/catalog?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`)
      return { models: value.models.map(item => typeof item === 'string' ? item : item.id), voices: value.voices }
    },
    preview: voice => request('/api/preview', { voice, format: 'wav' }),
    probeConnection: async () => (await request('/api/diagnostics/connection', {})).ready === true,
    probeAudioTools: async () => (await request('/api/diagnostics/audio-tools', {})).ready === true,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/settings-api.test.mjs`
Expected: PASS (3 tests)

---

### Task 3: Draw the pane

Pure drawing, with no host and no state. `register.js` passes in the surface's elements, the current view and the action handlers.

**Files:**
- Create: `hooks/settings-pane.js`
- Test: `tests/settings-pane.test.mjs`

**Interfaces:**
- Consumes: `Prefs` from Task 2.
- Produces:
  - `SETTINGS_PANE = 'voice-settings'`
  - `PROVIDERS: { value, label }[]`
  - `summaries(prefs: Prefs): { general: string, speech: string }`
  - `standbyOptions(current: number): { value: string, label: string }[]`
  - `settingsPane(el: { Box, Text, Button, Select, Input }, view: View, act: Actions)`, where `View = { prefs: Prefs | null, models: string[], voices: { id, name }[], catalogLoading: boolean, open: { general, speech, standby }, notice: string }` and `Actions = { toggle(id), selectProvider(id), saveKey(key), saveOptions(fields), saveStandby(seconds), saveSelection(model, voice), preview(voice), testConnection(), testAudioTools() }`

- [ ] **Step 1: Write the failing test**

```js
// tests/settings-pane.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsPane, standbyOptions, summaries } from '../hooks/settings-pane.js'

const element = type => props => ({ type, ...props })
const el = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Select: element('Select'), Input: element('Input') }
// Every visible word: text children and control labels.
const words = tree => tree == null || typeof tree !== 'object' ? (typeof tree === 'string' ? [tree] : [])
  : Array.isArray(tree) ? tree.flatMap(words) : [...(tree.label ? [tree.label] : []), ...words(tree.children)]
const find = (tree, key) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, key)).find(Boolean) ?? null
    : tree.key === key ? tree : find(tree.children, key)

const prefs = { provider: 'openai-live', model: 'gpt-realtime', voice: 'marin', voiceStandbySec: 30, statusSounds: true,
  responseDetail: 'concise', progressMode: 'outcome', backchannelEnabled: false, endConversationEnabled: false, configured: true }
const view = open => ({ prefs, models: ['gpt-realtime'], voices: [{ id: 'marin', name: 'Marin' }], catalogLoading: false,
  open: { general: false, speech: false, standby: false, ...open }, notice: '' })
const calls = []
const act = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) })

test('summaries describe each closed section', () => {
  assert.deepEqual(summaries(prefs), { general: 'Concise · Outcome only', speech: 'GPT Live · Realtime · marin' })
})

test('standby choices keep a saved value that is not a preset', () => {
  assert.deepEqual(standbyOptions(30).map(item => item.label), ['Off', '15 seconds', '30 seconds', '60 seconds', '120 seconds'])
  assert.deepEqual(standbyOptions(45).map(item => item.value), ['0', '15', '30', '45', '60', '120'])
})

test('both sections start closed and show only their titles and summaries', () => {
  const tree = settingsPane(el, view({}), act)
  assert.deepEqual(words(tree), ['▸ General', 'Concise · Outcome only', '▸ Speech & Voice', 'GPT Live · Realtime · marin'])
})

test('a section header toggles that section', () => {
  calls.length = 0
  find(settingsPane(el, view({}), act), 'section-speech').onPress()
  assert.deepEqual(calls, [['toggle', 'speech']])
})

test('Speech & Voice offers provider, key, model, voice, preview and tests', () => {
  const tree = settingsPane(el, view({ speech: true }), act)
  for (const key of ['provider', 'api-key', 'model', 'voice', 'preview', 'test-connection', 'test-audio-tools']) assert.ok(find(tree, key), key)
  assert.ok(words(tree).includes('OpenAI API key: Configured ✓'))
  calls.length = 0
  find(tree, 'voice').onSelect('cedar')
  find(tree, 'preview').onPress()
  assert.deepEqual(calls, [['saveSelection', 'gpt-realtime', 'cedar'], ['preview', 'marin']])
})

test('without a key, Speech & Voice asks for one and hides model and voice', () => {
  const tree = settingsPane(el, { ...view({ speech: true }), prefs: { ...prefs, configured: false } }, act)
  assert.equal(find(tree, 'model'), null)
  assert.equal(find(tree, 'voice'), null)
  assert.ok(words(tree).includes('Save a key to choose a model and voice.'))
})

test('General hides End voice by speaking for GPT Live and nests Standby', () => {
  const live = settingsPane(el, view({ general: true }), act)
  assert.equal(find(live, 'end-conversation'), null)
  assert.ok(find(live, 'section-standby'))
  assert.equal(find(live, 'standby'), null)
  const grok = settingsPane(el, { ...view({ general: true, standby: true }), prefs: { ...prefs, provider: 'xai' } }, act)
  assert.ok(find(grok, 'end-conversation'))
  calls.length = 0
  find(grok, 'standby').onSelect('60')
  find(grok, 'backchannel').onSelect('on')
  assert.deepEqual(calls, [['saveStandby', 60], ['saveOptions', { backchannelEnabled: true }]])
})

test('before settings load, the pane shows the notice or a loading line', () => {
  assert.deepEqual(words(settingsPane(el, { ...view({}), prefs: null }, act)), ['Loading voice settings…'])
  assert.deepEqual(words(settingsPane(el, { ...view({}), prefs: null, notice: 'Voice host not connected' }, act)), ['Voice host not connected'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/settings-pane.test.mjs`
Expected: FAIL with `Cannot find module '.../hooks/settings-pane.js'`

- [ ] **Step 3: Write the implementation**

```js
// hooks/settings-pane.js
// Draws the Voice settings pane from Claude's own controls: two collapsible sections, General and
// Speech & Voice, laid out like DeepSeek's settings. The host owns every value; this file only draws.

export const SETTINGS_PANE = 'voice-settings'
export const PROVIDERS = [
  { value: 'openai-live', label: 'GPT Live' },
  { value: 'openai', label: 'OpenAI Realtime' },
  { value: 'xai', label: 'xAI Grok' },
  { value: 'gemini', label: 'Gemini Live' },
]
const ON_OFF = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]
const STANDBY = [0, 15, 30, 60, 120]

const providerName = id => PROVIDERS.find(item => item.value === id)?.label ?? id
const keyLabel = id => id === 'xai' ? 'xAI API key' : id === 'gemini' ? 'Gemini API key' : 'OpenAI API key'
const seconds = value => value === 0 ? 'Off' : `${value} seconds`

/** The short line beside each section title. */
export function summaries(prefs) {
  return {
    general: `${prefs.responseDetail === 'detailed' ? 'Detailed' : 'Concise'} · ${prefs.progressMode === 'milestones' ? 'Milestones' : 'Outcome only'}`,
    speech: [providerName(prefs.provider), 'Realtime', prefs.voice].filter(Boolean).join(' · '),
  }
}

/** Standby choices, keeping a saved value that is not a preset. */
export function standbyOptions(current) {
  const values = STANDBY.includes(current) ? STANDBY : [...STANDBY, current].sort((a, b) => a - b)
  return values.map(value => ({ value: String(value), label: seconds(value) }))
}

// Select options from catalog entries, keeping the saved value when the catalog lacks it.
function choices(items, current) {
  const list = items.map(item => typeof item === 'string' ? { value: item, label: item } : { value: item.id, label: item.name || item.id })
  return current && !list.some(item => item.value === current) ? [{ value: current, label: current }, ...list] : list
}

/** The pane's tree for the surface's elements, the current view and the action handlers. */
export function settingsPane(el, view, act) {
  const { Box, Text, Button, Select, Input } = el
  if (!view.prefs) return Box({ flexDirection: 'column', children: [Text({ dimColor: true, children: [view.notice || 'Loading voice settings…'] })] })
  const { prefs, open } = view
  const summary = summaries(prefs)
  const column = children => Box({ flexDirection: 'column', children })
  const indent = children => Box({ flexDirection: 'column', paddingLeft: 2, children })
  const header = (id, title, line) => Box({ flexDirection: 'row', columnGap: 2, children: [
    Button({ key: `section-${id}`, label: `${open[id] ? '▾' : '▸'} ${title}`, plain: true, onPress: () => act.toggle(id) }),
    Text({ dimColor: true, wrap: 'truncate-end', children: [line] }),
  ] })
  const onOff = (key, label, field) => Select({ key, label, options: ON_OFF, value: prefs[field] ? 'on' : 'off',
    onSelect: value => act.saveOptions({ [field]: value === 'on' }) })

  const general = indent([
    Select({ key: 'response-detail', label: 'Speech verbosity', value: prefs.responseDetail,
      options: [{ value: 'concise', label: 'Concise' }, { value: 'detailed', label: 'Detailed' }],
      onSelect: value => act.saveOptions({ responseDetail: value }) }),
    Select({ key: 'progress-mode', label: 'Coding progress', value: prefs.progressMode,
      options: [{ value: 'outcome', label: 'Outcome only' }, { value: 'milestones', label: 'Milestones and outcome' }],
      onSelect: value => act.saveOptions({ progressMode: value }) }),
    onOff('backchannel', 'Backchannel while speaking', 'backchannelEnabled'),
    ...(prefs.provider === 'openai-live' ? [] : [onOff('end-conversation', 'End voice by speaking', 'endConversationEnabled')]),
    onOff('status-sounds', 'Connection sounds', 'statusSounds'),
    header('standby', 'Standby', seconds(prefs.voiceStandbySec)),
    ...(open.standby ? [indent([Select({ key: 'standby', label: 'After inactivity', value: String(prefs.voiceStandbySec),
      options: standbyOptions(prefs.voiceStandbySec), onSelect: value => act.saveStandby(Number(value)) })])] : []),
  ])

  const models = choices(view.models, prefs.model)
  const voices = choices(view.voices, prefs.voice)
  const voice = prefs.voice || voices[0]?.value
  const speech = indent([
    Select({ key: 'provider', label: 'Provider', value: prefs.provider, options: PROVIDERS, onSelect: id => act.selectProvider(id) }),
    Text({ children: [`${keyLabel(prefs.provider)}: ${prefs.configured ? 'Configured ✓' : 'Not configured'}`] }),
    Input({ key: 'api-key', placeholder: prefs.configured ? 'Paste a new key to replace it' : 'Paste your key',
      value: '', submitLabel: 'save', onSubmit: key => act.saveKey(key) }),
    ...(!prefs.configured ? [Text({ dimColor: true, children: ['Save a key to choose a model and voice.'] })] : [
      models.length
        ? Select({ key: 'model', label: 'Model', value: prefs.model || models[0].value, options: models,
          onSelect: model => act.saveSelection(model, prefs.voice) })
        : Text({ dimColor: true, children: [view.catalogLoading ? 'Loading models…' : 'No models available for this key.'] }),
      ...(voices.length ? [Box({ flexDirection: 'row', columnGap: 2, children: [
        Select({ key: 'voice', label: 'Voice', value: voice, options: voices, onSelect: next => act.saveSelection(prefs.model, next) }),
        Button({ key: 'preview', label: 'Preview', onPress: () => act.preview(voice) }),
      ] })] : []),
      Box({ flexDirection: 'row', columnGap: 2, children: [
        Button({ key: 'test-connection', label: 'Test connection', onPress: () => act.testConnection() }),
        Button({ key: 'test-audio-tools', label: 'Test audio and tools', onPress: () => act.testAudioTools() }),
      ] }),
    ]),
  ])

  return column([
    header('general', 'General', summary.general),
    ...(open.general ? [general] : []),
    header('speech', 'Speech & Voice', summary.speech),
    ...(open.speech ? [speech] : []),
    ...(view.notice ? [Text({ dimColor: true, wrap: 'wrap', children: [view.notice] })] : []),
  ])
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/settings-pane.test.mjs`
Expected: PASS (8 tests)

---

### Task 4: Open the pane from the settings icon

**Files:**
- Modify: `hooks/register.js` (imports at the top; `openSettings` at about line 331; one new `ui.render` hook inside `register`)
- Modify: `tests/mod-icons.test.mjs`
- Test: `tests/settings-mod.test.mjs`

**Interfaces:**
- Consumes: `settingsApi`, `preferences` (Task 2); `SETTINGS_PANE`, `settingsPane` (Task 3); the existing `connection`, `refresh($)` in `register.js`.
- Produces: pressing the settings icon (or the toggle while `voiceConfigured === false`) opens the `voice-settings` pane. `/api/setup-dialog` is no longer called.

- [ ] **Step 1: Write the failing Mod test**

```js
// tests/settings-mod.test.mjs
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

test('the settings icon opens the Voice settings pane, and a voice choice is saved through the host', async () => {
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
      open: async pane => { opened.push(pane.id); return { isPlaced: true } } },
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
  assert.ok(words(await pane()).includes('GPT Live · Realtime · marin'))
  find(await pane(), 'section-speech').onPress()
  find(await pane(), 'voice').onSelect('cedar')
  await settle()
  assert.deepEqual(posted.at(-1), ['/api/settings', { id: 'openai-live', model: 'gpt-realtime', voice: 'cedar' }])
  assert.ok(words(await pane()).includes('GPT Live · Realtime · cedar'))
  assert.ok(words(await pane()).includes('Saved for the next Voice session.'))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/settings-mod.test.mjs`
Expected: FAIL. `opened` is `[]`, because the icon still posts `/api/setup-dialog`.

- [ ] **Step 3: Update the existing icons test**

In `tests/mod-icons.test.mjs`, change the `ui` line to:

```js
    ui: { invalidate() {}, log() {}, toast() {}, open: async () => ({ isPlaced: true }) },
```

and the final assertion to:

```js
  assert.deepEqual(posted.filter(([path]) => path !== '/api/claude/session'),
    [['/api/control', 'mute'], ['/api/control', 'speaker-mute']])
```

- [ ] **Step 4: Implement in `hooks/register.js`**

Add at the top, after the `VoiceHistory` import:

```js
import { settingsApi } from './settings-api.js'
import { SETTINGS_PANE, settingsPane } from './settings-pane.js'
```

Replace the whole `openSettings` function (around line 331) with:

```js
// The Voice settings pane: what it shows, and one host change at a time whose outcome is its notice.
let settings = { prefs: null, models: [], voices: [], catalogLoading: false,
  open: { general: false, speech: false, standby: false }, notice: '', busy: false }
function redrawSettings($, changes) {
  settings = { ...settings, ...changes }
  $.ui.invalidate('ui.render')
}

async function settingsHost($) {
  if (connection === null) await refresh($)
  if (connection === null) throw new Error('Voice host not connected')
  return settingsApi((url, init) => $.http.fetch(url, init), connection)
}

async function loadCatalog($, api, prefs) {
  if (!prefs.configured) return redrawSettings($, { models: [], voices: [], catalogLoading: false })
  redrawSettings($, { catalogLoading: true })
  try { redrawSettings($, { ...(await api.catalog(prefs.provider, prefs.model)), catalogLoading: false }) }
  catch (error) { redrawSettings($, { models: [], voices: [], catalogLoading: false, notice: error.message }) }
}

async function settingsAction($, working, done, action) {
  if (settings.busy) return
  redrawSettings($, { busy: true, notice: working })
  try { redrawSettings($, { notice: (await action(await settingsHost($))) ?? done }) }
  catch (error) { redrawSettings($, { notice: error.message }) }
  finally { redrawSettings($, { busy: false }) }
}

function settingsActions($) {
  const saved = 'Saved for the next Voice session.'
  // Saves, then refetches the catalog when the provider, key or model changed what it lists.
  const apply = (working, done, change) => settingsAction($, working, done, async api => {
    const before = settings.prefs
    const prefs = await change(api)
    redrawSettings($, { prefs })
    if (prefs.provider !== before?.provider || prefs.configured !== before?.configured || prefs.model !== before?.model) void loadCatalog($, api, prefs)
  })
  const provider = () => settings.prefs.provider
  return {
    toggle: id => redrawSettings($, { open: { ...settings.open, [id]: !settings.open[id] } }),
    selectProvider: id => apply('Saving provider…', 'Provider saved for the next Voice session.', api => api.selectProvider(id)),
    saveKey: key => key.trim() ? apply('Saving key…', 'Key saved on this computer.', api => api.save(provider(), { key: key.trim() })) : undefined,
    saveOptions: fields => apply('Saving…', saved, api => api.save(provider(), fields)),
    saveStandby: seconds => apply('Saving…', 'Standby duration saved.', api => api.save(provider(), { voiceStandbySec: seconds })),
    saveSelection: (model, voice) => apply('Saving…', saved, api => api.save(provider(), { model, voice })),
    preview: voice => settingsAction($, 'Loading preview…', '', async api => {
      const clip = await api.preview(voice)
      await $.audio.play({ base64: clip.base64, mime: clip.mime })
    }),
    testConnection: () => settingsAction($, 'Checking the provider connection…', '', async api =>
      (await api.probeConnection()) ? 'Provider connection ready.' : 'Provider connection failed.'),
    testAudioTools: () => settingsAction($, 'Checking synthetic audio and coding-tool exchange…', '', async api =>
      (await api.probeAudioTools()) ? 'Audio and coding tools ready.' : 'Audio or coding-tool exchange failed.'),
  }
}

async function openSettings($) {
  const opened = await $.ui.open({ id: SETTINGS_PANE, title: 'Voice settings' })
  if (!opened.isPlaced) return $.ui.toast('Voice settings could not open')
  await settingsAction($, '', '', async api => {
    const prefs = await api.load()
    redrawSettings($, { prefs })
    void loadCatalog($, api, prefs)
    return ''
  })
}
```

Inside `register(on)`, next to the existing `AbovePrompt` render hook, add:

```js
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) =>
    settingsPane($.ui.resolve(e), settings, settingsActions($)))
```

- [ ] **Step 5: Run the Mod tests to verify they pass**

Run: `node --test tests/settings-mod.test.mjs tests/mod-icons.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the whole suite**

Run: `node --test tests/`
Expected: 74 tests, all pass.

- [ ] **Step 7: Validate the Mod the way Claude Code loads it**

Bump `"version"` in `.claude-plugin/plugin.json` from `0.1.68` to `0.1.69`, then run:

```bash
npm run plugin:stage && claude plugin validate .plugin-build/plugins/voicemesh-controls
```

Expected: no errors. Its `calls:` line now includes `ui.open` and `audio.play`. If it reports a `Box` prop it doesn't accept (for example `paddingLeft`), change that `indent` box in `hooks/settings-pane.js` to `paddingX: 1`, rerun Task 3's tests, and validate again.

---

### Task 5: Install and check it in Claude Desktop

This is a manual check. The person runs Desktop, and Claude reads the results back.

- [ ] **Step 1: Restart the host, then install the new Mod version**

```bash
npm run host:install:macos -- --dev-connections /Users/hgp/DeepSeek/voicemesh-composer/playground/.data/connections.json
```

On this development Mac the host reads its GPT Live key from that Playground file. Without the flag, the host comes up with no provider configured. If `launchctl bootstrap` fails with a Node error, run the same command again: the old service was still stopping.

```bash
claude plugin update voicemesh-controls@voicemesh-local
```

Then run `/reload-plugins` in the Desktop Code session.

- [ ] **Step 2: Walk through the pane**

Each of these must hold:
1. Pressing the gear icon in the voice bar opens **Voice settings** docked on the right, showing `▸ General` and `▸ Speech & Voice`, each with its summary.
2. Opening **Speech & Voice** shows the provider, the key status, model, voice, Preview and both test buttons.
3. **Preview** plays the selected voice through the Mac speakers.
4. Changing the voice updates the summary and shows "Saved for the next Voice session."
5. Changing **Speech verbosity** in General is saved and survives closing and reopening the pane.
6. Starting Voice afterwards uses the new voice.
7. Changing the provider while Voice is running shows "Stop Voice before changing providers".

- [ ] **Step 3: Record the outcome**

Add a dated line to `IMPLEMENTATION_PLAN.md` under its progress list stating which of the seven checks passed. Record any failure as written, not fixed in the note.

---

### Task 6: Remove the old settings window

Only after Task 5 passes.

**Files:**
- Delete: `setup/`, `.settings-window/`, `dist-setup/`, `scripts/build-settings-window.js`
- Modify: `host/server.js`: remove `setupRoot` (line 25), `settingsWindow` (line 49), the `/setup/` static route (about line 221) and the `/api/setup-dialog` route (about line 254). **Keep `/api/bootstrap`**, which `media/main.js` uses.
- Modify: `package.json`: remove the `setup:build` script and the `react` and `react-dom` dependencies, since `media/` doesn't import React.
- Modify: `README.md:73`: replace "and `npm run setup:build`" and the sentence about the settings file with: "Press the gear in the voice bar to open **Voice settings**, a pane on the right of the Code tab, to choose the provider, key, model, voice, standby duration and connection sounds."

- [ ] **Step 1: Confirm nothing else uses what is being removed**

Run: `grep -rnE "setup-dialog|dist-setup|settings-window|setupRoot|settingsWindow|from 'react" --include=*.js --include=*.mjs --include=*.json hooks host media scripts tests package.json`
Expected: hits only in `host/server.js`, at the lines listed above, and in `package.json`.

- [ ] **Step 2: Remove the files and routes listed above**

- [ ] **Step 3: Verify**

Run: `node --check host/server.js && npm install && npm run media:build && node --test tests/`
Expected: the build succeeds; the test results are unchanged from Task 4 Step 6.

- [ ] **Step 4: Restart the host and confirm the pane still works**

Restart the host with the same command as Task 5 Step 1 (including `--dev-connections`), then repeat Task 5 Step 2, checks 1–3.

---

## Roadmap after this plan

These need their own plans, written once this one is in, because each is a separate subsystem with its own tests.

**Plan 2: Pipeline mode (cloud speech plus Claude as the LLM)**
- Add a **Mode** `Select` (Realtime / Pipeline) at the top of Speech & Voice. Pipeline shows three collapsible groups, following DeepSeek: **Speech recognition (STT)**, **Conversation (LLM)** and **Speech synthesis (TTS)**, plus **Speech detection** (pause before a turn ends).
- STT and TTS cloud providers already ship in Composer (`@voicemesh/composer`: Deepgram, Grok, OpenAI, Gemini, Fish). Port the host wiring from DeepSeek's `packages/host/voice-host/src/pipeline-recognizer.ts`, `pipeline-tts.ts`, `pipeline-transcript.ts` and `pipeline-tools.ts`.
- **The LLM defaults to Claude, using the same model as the Claude Code session.** The Mod reads it with `$.session.model()` and runs each reply with `$.model.complete({ model, system, prompt })`, which goes through the session's own Claude account, so no extra key is needed. The host sends LLM turns to the Mod over the existing bridge (like `/api/claude/request`), and the Mod posts the reply back. Risk to measure first: `$.model.complete` returns the whole reply rather than streaming, so speech starts only once the reply is complete.
- Other LLM providers and a custom endpoint stay as options, as in DeepSeek's `conversational-model.ts`.

**Plan 3: Local speech (free, on-device)**
- Port DeepSeek's local engines (`local-voice.ts`: Vosk and Parakeet STT, Kokoro TTS, run in a worker thread) and the model installer (`local-install.ts`) into this host.
- In the pane: when a local engine is chosen, show a model `Select` for installed packs and an **Install model** button with download progress.
- With Plans 2 and 3, a person can run voice fully locally plus their Claude plan, with no paid voice provider.

## Open decision

- **API key entry:** Claude's `Input` has no hidden-text option, so a pasted key shows in the field until Enter, after which the field clears and only "Configured ✓" remains. The alternative is a plugin `userConfig` field marked sensitive, which Claude keeps in secure storage and edits through `/config`, with the Mod forwarding it to the host. This plan uses `Input`. Switching later only changes `saveKey`.
