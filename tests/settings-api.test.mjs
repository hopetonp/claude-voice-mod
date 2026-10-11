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
