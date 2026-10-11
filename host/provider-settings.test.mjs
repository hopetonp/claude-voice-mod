import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettings } from './provider-settings.js'
import { classifyForVoice } from './classifier.js'

test('custom conversation keys stay local and bound to one normalized endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-voice-settings-'))
  try {
    const path = join(root, 'providers.json')
    const store = await createSettings(path, {})
    await store.savePipeline({ conversationalProvider: 'custom', conversationalBaseUrl: 'http://127.0.0.1:8999/v1/' ,
      conversationalModel: 'local-model' })
    assert.equal(store.pipeline().conversationalBaseUrl, 'http://127.0.0.1:8999/v1')
    await store.savePipelineCredential('endpoint:http://127.0.0.1:8999/v1', 'test-key')
    assert.equal(store.pipelineCredential('endpoint:http://127.0.0.1:8999/v1'), 'test-key')
    assert.equal(store.pipelineCredential('endpoint:http://127.0.0.1:9000/v1'), '')
    const saved = await readFile(path, 'utf8')
    assert.equal(saved.includes('http://127.0.0.1:8999/v1'), true)
    assert.equal(saved.includes('endpoint:http://127.0.0.1:8999/v1'), false)
    assert.equal(store.publicSettings().some(entry => 'key' in entry), false)
    await assert.rejects(store.savePipeline({ conversationalBaseUrl: 'http://remote.example/v1' }), /HTTPS/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('classifier is opt-in and stores its Jev key locally without exposing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-classifier-settings-'))
  try {
    const path = join(root, 'providers.json')
    const store = await createSettings(path, {})
    assert.equal(store.classifier().enabled, false)
    assert.deepEqual(store.classifier(), { enabled: false, provider: 'jev', model: 'jev-latest' })
    await assert.rejects(store.saveClassifier({ enabled: true }), /key/)
    await store.saveClassifierCredential('test-jev-key')
    await store.saveClassifier({ enabled: true })
    assert.equal(store.classifier().enabled, true)
    assert.equal(store.classifier().model, 'jev-latest')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).classifier.key, undefined)
    const calls = []
    const route = await classifyForVoice(store, 'Read the README', '', new AbortController().signal,
      async (url, init) => {
        calls.push({ url: String(url), authorization: init.headers.Authorization })
        return Response.json({ answers: { route: { type: 'choice', choice: 'coding' } } })
      })
    assert.equal(route, 'coding')
    assert.deepEqual(calls, [{ url: 'https://api.typesafe.ai/v1/systemone', authorization: 'Bearer test-jev-key' }])
    await store.saveClassifier({ provider: 'openai' })
    assert.equal(store.classifier().enabled, false)
    assert.equal(store.classifier().model, 'gpt-6-luna')
    await assert.rejects(store.saveClassifier({ enabled: true }), /key/)
    await store.save({ id: 'openai', key: 'test-openai-key' })
    await store.saveClassifier({ enabled: true })
    await store.saveClassifier({ provider: 'jev', model: 'jev-latest', enabled: true })
    assert.equal(store.classifier().enabled, true)
    await store.saveClassifier({ provider: 'openai', model: 'gpt-6-luna', enabled: true })
    assert.equal(store.classifier().enabled, true)
    const openaiRoute = await classifyForVoice(store, 'Tell me a joke', '', new AbortController().signal,
      async (url, init) => {
        assert.equal(String(url), 'https://api.openai.com/v1/decisions')
        assert.equal(init.headers.Authorization, 'Bearer test-openai-key')
        return Response.json({ answers: [{ type: 'choice', name: 'route', choice: 'voice' }] })
      })
    assert.equal(openaiRoute, 'voice')
  } finally { await rm(root, { recursive: true, force: true }) }
})
