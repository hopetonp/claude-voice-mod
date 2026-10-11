// xAI's voice models are not listed by GET https://api.x.ai/v1/models, so Composer's discovery finds
// none for an xAI key. These are the IDs xAI documents for wss://api.x.ai/v1/realtime
// (https://docs.x.ai/developers/model-capabilities/audio/voice-agent); the pinned version comes first
// because xAI advises pinning in production, and "latest" tracks its newest voice model.
const XAI_VOICE_MODELS = ['grok-voice-think-fast-2.0', 'grok-voice-latest']

/** The discovered models, or xAI's documented voice models when discovery found none. */
export function withXaiVoiceModels(provider, models) {
  if (provider !== 'xai' || models.length) return models
  return XAI_VOICE_MODELS.map(id => ({ id, thinking: [] }))
}
