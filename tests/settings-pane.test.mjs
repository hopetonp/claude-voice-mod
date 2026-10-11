import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsPane, standbyOptions, summaries } from '../hooks/settings-pane.js'

const element = type => props => ({ type, ...props })
const el = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Select: element('Select'), Input: element('Input'), Svg: element('Svg') }
// Every visible word: text children and control labels.
const words = tree => tree == null || typeof tree !== 'object' ? (typeof tree === 'string' ? [tree] : [])
  : Array.isArray(tree) ? tree.flatMap(words) : [...(tree.label ? [tree.label] : []), ...words(tree.children)]
const find = (tree, key) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, key)).find(Boolean) ?? null
    : tree.key === key ? tree : find(tree.children, key)

const prefs = { provider: 'openai-live', model: 'gpt-realtime', voice: 'marin', voiceStandbySec: 30, statusSounds: true,
  responseDetail: 'concise', progressMode: 'outcome', backchannelEnabled: false, endConversationEnabled: false, configured: true }
const view = open => ({ prefs, models: ['gpt-realtime'], voices: [{ id: 'marin', name: 'Marin' }], catalogLoading: false, keyDraft: '',
  open: { general: false, speech: false, ...open }, notice: '' })
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
  assert.ok(words(tree).includes('OpenAI API key'))
  assert.equal(find(tree, 'api-key').placeholder, 'Configured ✓', 'the key status is the empty field')
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

test('General hides End voice by speaking for GPT Live and lists Standby as an ordinary setting', () => {
  const live = settingsPane(el, view({ general: true }), act)
  assert.equal(find(live, 'end-conversation'), null)
  assert.ok(find(live, 'standby'))
  const grok = settingsPane(el, { ...view({ general: true }), prefs: { ...prefs, provider: 'xai' } }, act)
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

test('with no stored model, choosing a voice saves the shown default model too', () => {
  calls.length = 0
  const tree = settingsPane(el, { ...view({ speech: true }), prefs: { ...prefs, model: '' }, models: ['m1'] }, act)
  assert.equal(find(tree, 'model').value, 'm1')
  find(tree, 'voice').onSelect('cedar')
  assert.deepEqual(calls, [['saveSelection', 'm1', 'cedar']])
})

test('with no stored voice, choosing a model saves the shown default voice too', () => {
  calls.length = 0
  const tree = settingsPane(el, { ...view({ speech: true }), prefs: { ...prefs, voice: '' } }, act)
  find(tree, 'model').onSelect('gpt-realtime')
  assert.deepEqual(calls, [['saveSelection', 'gpt-realtime', 'marin']])
})

test('the key field shows the draft and reports typing', () => {
  calls.length = 0
  const tree = settingsPane(el, { ...view({ speech: true }), keyDraft: 'sk-par' }, act)
  assert.equal(find(tree, 'api-key').value, 'sk-par')
  find(tree, 'api-key').onInput('sk-part')
  assert.deepEqual(calls, [['typeKey', 'sk-part']])
})

test('General offers chat bubbles on or off, off unless switched on', () => {
  calls.length = 0
  const on = find(settingsPane(el, { ...view({ general: true }), chatBubbles: true }, act), 'chat-bubbles')
  assert.equal(on.value, 'on')
  const off = find(settingsPane(el, view({ general: true }), act), 'chat-bubbles')
  assert.equal(off.value, 'off')
  off.onSelect('on')
  assert.deepEqual(calls.at(-1), ['saveChatBubbles', true])
})
