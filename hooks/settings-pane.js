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
  const header = (id, title, line) => Box({ flexDirection: 'column', rowGap: 0.25, children: [
    Button({ key: `section-${id}`, label: `${open[id] ? '▾' : '▸'} ${title}`, plain: true, onPress: () => act.toggle(id) }),
    ...(!open[id] ? [Text({ dimColor: true, wrap: 'wrap', children: [line] })] : []),
  ] })
  const row = (label, ...controls) => Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    columnGap: 2, paddingY: 0.25, children: [
      Text({ wrap: 'truncate-end', children: [label] }),
      Box({ flexDirection: 'row', flexShrink: 0, columnGap: 1, alignItems: 'center', children: controls }),
    ] })
  const groupLabel = title => Text({ bold: true, children: [title] })
  const section = (id, title, line, body) => Box({ flexDirection: 'column', borderStyle: 'round', borderDimColor: true,
    paddingX: 2, paddingY: 1, rowGap: 1, children: [header(id, title, line), ...(open[id] ? body : [])] })
  const onOff = (key, field) => Select({ key, options: ON_OFF, value: prefs[field] ? 'on' : 'off',
    onSelect: value => act.saveOptions({ [field]: value === 'on' }) })

  const general = [
    row('Speech verbosity', Select({ key: 'response-detail', value: prefs.responseDetail,
      options: [{ value: 'concise', label: 'Concise' }, { value: 'detailed', label: 'Detailed' }],
      onSelect: value => act.saveOptions({ responseDetail: value }) })),
    row('Coding progress', Select({ key: 'progress-mode', value: prefs.progressMode,
      options: [{ value: 'outcome', label: 'Outcome only' }, { value: 'milestones', label: 'Milestones and outcome' }],
      onSelect: value => act.saveOptions({ progressMode: value }) })),
    row('Plain-language summaries', onOff('plain-language-summaries', 'plainLanguageSummaries')),
    row('Backchannel while speaking', onOff('backchannel', 'backchannelEnabled')),
    ...(prefs.provider === 'openai-live' ? [] : [row('End voice by speaking', onOff('end-conversation', 'endConversationEnabled'))]),
    row('Connection sounds', onOff('status-sounds', 'statusSounds')),
    // How finished turns show in the conversation; kept on this computer, not per provider.
    row('Chat bubbles', Select({ key: 'chat-bubbles', options: ON_OFF, value: view.chatBubbles === true ? 'on' : 'off',
      onSelect: value => act.saveChatBubbles(value === 'on') })),
    row('Standby after inactivity', Select({ key: 'standby', value: String(prefs.voiceStandbySec),
      options: standbyOptions(prefs.voiceStandbySec), onSelect: value => act.saveStandby(Number(value)) })),
  ]

  const models = choices(view.models, prefs.model)
  const voices = choices(view.voices, prefs.voice)
  // Effective values: a default the host never stored is shown, so it is also what a pick saves.
  const model = prefs.model || models[0]?.value
  const voice = prefs.voice || voices[0]?.value
  const speech = [
    groupLabel('Connection'),
    row('Provider', Select({ key: 'provider', value: prefs.provider, options: PROVIDERS, onSelect: id => act.selectProvider(id) })),
    // The key's status is the empty field's placeholder, so status and field share one row.
    row(keyLabel(prefs.provider), Input({ key: 'api-key', placeholder: prefs.configured ? 'Configured ✓' : 'Paste your key',
      value: view.keyDraft, onInput: value => act.typeKey(value), submitLabel: 'save', onSubmit: key => act.saveKey(key) })),
    ...(!prefs.configured ? [Text({ dimColor: true, children: ['Save a key to choose a model and voice.'] })] : [
      groupLabel('Speech'),
      models.length
        ? row('Model', Select({ key: 'model', value: model, options: models, onSelect: next => act.saveSelection(next, voice) }))
        : Text({ dimColor: true, children: [view.catalogLoading ? 'Loading models…' : 'No models available for this key.'] }),
      ...(voices.length ? [row('Voice',
        Select({ key: 'voice', value: voice, options: voices, onSelect: next => act.saveSelection(model, next) }),
        Button({ key: 'preview', label: 'Preview', onPress: () => act.preview(voice) }))] : []),
      Box({ flexDirection: 'column', rowGap: 0.5, marginTop: 1, children: [
        groupLabel('Checks'),
        Box({ flexDirection: 'row', columnGap: 1, children: [
          Button({ key: 'test-connection', label: 'Test connection', onPress: () => act.testConnection() }),
          Button({ key: 'test-audio-tools', label: 'Test audio and tools', onPress: () => act.testAudioTools() }),
        ] }),
      ] }),
    ]),
  ]

  // No heading: Claude already titles the pane "Voice settings".
  return Box({ flexDirection: 'column', rowGap: 1.5, paddingX: 1, paddingY: 0.5, children: [
    section('general', 'General', summary.general, general),
    section('speech', 'Speech & Voice', summary.speech, speech),
    ...(view.notice ? [Text({ dimColor: true, wrap: 'wrap', children: [view.notice] })] : []),
  ] })
}
