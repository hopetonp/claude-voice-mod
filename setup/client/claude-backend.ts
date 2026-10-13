import type { VoiceCatalog, VoiceSelection, VoiceSample, VoicePreferences, VoiceSettingsBackend } from '@voicemesh/settings-editor'
import { readPcmPreview } from '@voicemesh/composer/browser'

let token = ''
const previewSessionId = crypto.randomUUID()
let previewHeartbeat: ReturnType<typeof setInterval> | undefined
function startPreviewHeartbeat(): void {
  if (previewHeartbeat) return
  previewHeartbeat = setInterval(() => {
    if (!token) return
    void fetch('/api/preview/keepalive', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewSessionId }) }).catch(() => {})
  }, 60000)
}
export async function closePreviewSession(): Promise<void> {
  clearInterval(previewHeartbeat)
  previewHeartbeat = undefined
  if (!token) return
  await fetch('/api/preview/close', { method: 'POST', keepalive: true,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewSessionId }) })
}
async function fetchBackend(path: string, init: RequestInit = {}): Promise<Response> {
  async function bootstrap() {
    const value = await fetch('/api/bootstrap').then(response => response.json())
    token = value.token
  }
  if (!token) await bootstrap()
  let response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })
  if (response.status === 401) {
    await bootstrap()
    response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })
  }
  return response
}
async function request(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetchBackend(path, init)
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'VoiceMesh host request failed')
  return value
}

export interface CodingDiagnostics {
  sessionId: string | null
  clientSynced: boolean | null
  stuck: boolean
  task: { id: string; turnId: string | null; status: string; request: string;
    recoveryEvidence: string | null; canRelease: boolean } | null
}

export const codingDiagnostics = {
  check: (): Promise<CodingDiagnostics> => request('/api/claude/diagnostics'),
  release: (diagnostics: CodingDiagnostics) => request('/api/claude/release', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: diagnostics.sessionId, id: diagnostics.task?.id,
      turnId: diagnostics.task?.turnId, confirmRelease: true }),
  }),
}
const current = ({ providers, selectedProvider, voiceMode, pipeline, classifier }: { providers: any[], selectedProvider: string,
  voiceMode?: 'pipeline' | 'sts', pipeline?: VoicePreferences['pipeline'], classifier?: VoicePreferences['classifier'] }): VoicePreferences => {
  const provider = selectedProvider || 'openai-live'
  const value = providers.find(item => item.id === provider)
  return { voiceMode: voiceMode === 'pipeline' ? 'pipeline' : 'sts', pipeline: pipeline ?? { sttEngine: 'openai', sttModel: '',
    ttsEngine: 'openai', ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'alloy',
    conversationalProvider: 'openai', conversationalModel: 'gpt-4o-mini', conversationalBaseUrl: '', vadSilenceSec: 1.1 },
    classifier: classifier ?? { enabled: false, provider: 'jev', model: 'jev-latest' },
    provider, model: value?.model ?? '', voice: value?.voice ?? '', voiceStandbySec: value?.voiceStandbySec ?? 30,
    statusSounds: value?.statusSounds ?? true, assistantOrbEnabled: value?.assistantOrbEnabled ?? true,
    responseDetail: value?.responseDetail ?? 'concise', progressMode: value?.progressMode ?? 'outcome', backchannelEnabled: value?.backchannelEnabled ?? false,
    endConversationEnabled: value?.endConversationEnabled ?? false,
    configured: !!value?.configured }
}
async function catalog(model: string, signal: AbortSignal): Promise<any> {
  const { provider } = await claudeBackend.load()
  return request(`/api/catalog?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`, { signal })
}
async function save(fields: Record<string, unknown>): Promise<VoicePreferences> {
  const { provider } = await claudeBackend.load()
  return current(await request('/api/settings', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: provider, ...fields }) }))
}

/** Claude's local-host adapter for the optional VoiceMesh settings editor. */
export const claudeBackend: VoiceSettingsBackend = {
  async load() { return current(await request('/api/settings')) },
  async loadDisplay() { return (await request('/api/display')).chatBubbles === true },
  async saveDisplay(chatBubbles) { return (await request('/api/display', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatBubbles }) })).chatBubbles === true },
  async selectProvider(id) { return current(await request('/api/provider-selection', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })) },
  async selectVoiceMode(mode) { return current(await request('/api/voice-mode', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })) },
  async savePipeline(changes) { return current(await request('/api/pipeline/settings', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })) },
  async saveClassifier(changes) { return current(await request('/api/classifier/settings', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })) },
  async saveClassifierCredential(provider, key) {
    await request(provider === 'jev' ? '/api/classifier/key' : '/api/pipeline/key', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key }) })
  },
  async classifierCredentialStatus(provider) {
    return (await request(`/api/classifier/key-status?provider=${encodeURIComponent(provider)}`)).configured === true
  },
  async listPipelineOptions(kind, selection, signal) {
    const engine = kind === 'stt-model' ? selection.sttEngine : kind === 'tts-model' ? selection.ttsEngine
      : kind === 'conversation-model' ? selection.conversationalProvider : ''
    return (await request(`/api/pipeline/options?kind=${encodeURIComponent(kind)}&engine=${encodeURIComponent(engine)}${kind === 'conversation-model' ? `&baseUrl=${encodeURIComponent(selection.conversationalBaseUrl)}` : ''}`, { signal })).options
  },
  async savePipelineCredential(provider, key, baseUrl) { return current(await request('/api/pipeline/key', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key, baseUrl }) })) },
  async pipelineCredentialStatus(provider, baseUrl) {
    return (await request(`/api/pipeline/key-status?provider=${encodeURIComponent(provider)}&baseUrl=${encodeURIComponent(baseUrl || '')}`)).configured === true
  },
  async probePipelineConversation() { return (await request('/api/pipeline/conversation-test', { method: 'POST' })).ready === true },
  async localInstallSize(selection) { return (await request('/api/pipeline/local-install-size', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) })).bytes },
  async installLocalModel(selection) { return request('/api/pipeline/local-install', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) }) },
  async localInstallStatus() { return request('/api/pipeline/local-install-status') },
  saveCredential(key) { return save({ key }) },
  saveSelection(model, voice) { return save({ model, voice }) },
  saveStandby(voiceStandbySec) { return save({ voiceStandbySec }) },
  saveOptions(options) { return save(options) },
  async listModels(signal) {
    const state = await claudeBackend.load()
    return (await catalog(state.model, signal)).models.map((item: any) => typeof item === 'string' ? item : item.id)
  },
  async listVoices(selection: VoiceSelection, signal): Promise<VoiceCatalog> {
    const value = selection.mode === 'tts' ? await request('/api/pipeline/voices', { signal }) : await catalog(selection.model, signal)
    return { voices: value.voices, source: value.source, sourceUrl: value.sourceUrl,
      fetchedAt: value.fetchedAt, ...(value.supplementalSourceUrl ? { supplementalSourceUrl: value.supplementalSourceUrl } : {}) }
  },
  async previewVoice(_selection: VoiceSelection, voice: string, signal: AbortSignal,
    onAudio: (sample: VoiceSample) => void, sampleText?: string): Promise<void> {
    if (_selection.mode !== 'tts') startPreviewHeartbeat()
    const response = await fetchBackend(_selection.mode === 'tts' ? '/api/pipeline/preview' : '/api/preview', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'audio/l16' },
      body: JSON.stringify({ voice, text: sampleText, previewSessionId }),
    })
    await readPcmPreview(response, onAudio, signal)
  },
  async probeConnection() {
    const result = await request('/api/diagnostics/connection', { method: 'POST' })
    return result.ready === true
  },
  async probeAudioTools() {
    const result = await request('/api/diagnostics/audio-tools', { method: 'POST' })
    return result.ready === true
  },
}
