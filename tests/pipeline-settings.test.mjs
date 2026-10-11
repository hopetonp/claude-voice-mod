import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettings } from '../host/provider-settings.js'

test('pipeline mode keeps provider-specific model and voice selections separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'claude-pipeline-'))
  const path = join(directory, 'providers.json')
  try {
    const settings = await createSettings(path, { OPENAI_API_KEY: 'temporary-key' })
    assert.equal(settings.voiceMode(), 'sts')
    await settings.selectVoiceMode('pipeline')
    await settings.savePipeline({ sttEngine: 'deepgram-flux', ttsEngine: 'deepgram' })
    assert.equal(settings.pipeline().sttModel, '')
    assert.equal(settings.pipeline().ttsModel, '')
    assert.equal(settings.pipeline().ttsVoice, '')
    await settings.savePipeline({ ttsVoice: 'aura-asteria-en' })
    assert.equal(settings.pipeline().ttsVoice, 'aura-asteria-en')
    const onDisk = await readFile(path, 'utf8')
    assert.equal(JSON.parse(onDisk).voiceMode, 'pipeline')
    assert.ok(!onDisk.includes('temporary-key'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
