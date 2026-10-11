import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettings } from '../host/provider-settings.js'
import { configuredConnections } from '../host/voice-server.js'
import { liveInstructions } from '../host/voice-policy.js'
import { openaiLiveProvider } from '@voicemesh/composer/server'

test('DeepSeek-style voice choices persist and shape GPT Live guidance without exposing the key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-options-'))
  const path = join(directory, 'providers.json')
  try {
    const store = await createSettings(path, {})
    await store.save({ id: 'openai-live', key: 'test-key', model: 'test-model', voice: 'test-voice',
      statusSounds: false, assistantOrbEnabled: false, responseDetail: 'detailed', progressMode: 'milestones', backchannelEnabled: true })
    assert.equal(store.publicSettings().find(row => row.id === 'openai-live').key, undefined)
    assert.deepEqual(configuredConnections(store).map(({ statusSounds, assistantOrbEnabled }) => ({ statusSounds, assistantOrbEnabled })),
      [{ statusSounds: false, assistantOrbEnabled: false }])
    const restored = await createSettings(path, {})
    assert.equal(restored.get('openai-live').statusSounds, false)
    assert.equal(restored.get('openai-live').assistantOrbEnabled, false)
    assert.equal(restored.get('openai-live').responseDetail, 'detailed')
    assert.equal(restored.get('openai-live').progressMode, 'milestones')
    assert.equal(restored.get('openai-live').backchannelEnabled, true)
    assert.match(liveInstructions(restored.get('openai-live')), /fuller conversational explanation/)
    assert.match(liveInstructions(restored.get('openai-live')), /listening acknowledgment/)
    assert.doesNotMatch(liveInstructions({}), /listening acknowledgment/)
    const live = openaiLiveProvider.create({ ...restored.get('openai-live'),
      instructions: liveInstructions(restored.get('openai-live')) })
    assert.match(live.setup.session.instructions, /fuller conversational explanation/)
    assert.match(live.setup.session.instructions, /listening acknowledgment/)
    const contents = await readFile(path, 'utf8')
    assert.equal(JSON.parse(contents)['openai-live'].statusSounds, false)
    await assert.rejects(restored.save({ id: 'openai-live', statusSounds: 'off' }), /Invalid statusSounds/)
    await assert.rejects(restored.save({ id: 'openai-live', responseDetail: 'verbose' }), /Invalid speech verbosity/)
    await assert.rejects(restored.save({ id: 'openai-live', progressMode: 'filler' }), /Invalid coding progress mode/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('provider selection is separate from each provider credential and connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-provider-selection-'))
  const path = join(directory, 'providers.json')
  try {
    const store = await createSettings(path, {})
    assert.equal(store.selectedProvider(), 'openai-live')
    await store.save({ id: 'openai-live', key: 'live-key', model: 'live-model', voice: 'live-voice' })
    await store.save({ id: 'openai', key: 'realtime-key', model: 'realtime-model', voice: 'realtime-voice',
      endConversationEnabled: true })
    assert.equal(await store.select('openai'), 'openai')
    assert.deepEqual(configuredConnections(store).map(({ id, transport, inputSampleRate }) => ({ id, transport, inputSampleRate })),
      [{ id: 'openai', transport: 'webrtc', inputSampleRate: 24000 }])
    const restored = await createSettings(path, {})
    assert.equal(restored.selectedProvider(), 'openai')
    assert.equal(restored.get('openai-live').model, 'live-model')
    assert.equal(restored.get('openai').model, 'realtime-model')
    assert.equal(restored.get('openai').endConversationEnabled, true)
    await assert.rejects(restored.save({ id: 'openai', endConversationEnabled: 'yes' }), /Invalid endConversationEnabled/)
    await assert.rejects(restored.select('unknown'), /supported provider/)
    assert.equal(restored.selectedProvider(), 'openai')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('GPT Live and OpenAI Realtime share the saved OpenAI credential', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-openai-key-'))
  const path = join(directory, 'providers.json')
  try {
    const store = await createSettings(path, {})
    await store.save({ id: 'openai-live', key: 'shared-key' })
    assert.equal(store.get('openai').key, 'shared-key')
    assert.equal(store.get('openai-live').key, 'shared-key')
    assert.equal(JSON.parse(await readFile(path, 'utf8'))['openai-live'].key, undefined)
    const restored = await createSettings(path, {})
    assert.equal(restored.get('openai').key, 'shared-key')
    await restored.save({ id: 'openai', key: '' })
    assert.equal(restored.get('openai').key, '')
    assert.equal(restored.get('openai-live').key, '')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
