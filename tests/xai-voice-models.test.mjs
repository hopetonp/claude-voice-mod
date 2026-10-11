import assert from 'node:assert/strict'
import test from 'node:test'
import { withXaiVoiceModels } from '../host/xai-voice-models.js'

test('xAI gets its documented voice models when its model list has none', () => {
  assert.deepEqual(withXaiVoiceModels('xai', []).map(model => model.id), ['grok-voice-think-fast-2.0', 'grok-voice-latest'])
})

test('discovered models are kept as they are', () => {
  const found = [{ id: 'grok-voice-think-fast-3.0', thinking: [] }]
  assert.equal(withXaiVoiceModels('xai', found), found)
  const openai = []
  assert.equal(withXaiVoiceModels('openai', openai), openai)
})
