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

/** Host calls bound to one connection: a GET without a body, a JSON POST with one. Takes the Mod's fetch, because the Mod validator follows `$` only inside the file that calls it. */
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
    setupDialog: theme => request('/api/setup-dialog', { theme }),
    closed: () => request('/api/settings/closed', {}),
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
