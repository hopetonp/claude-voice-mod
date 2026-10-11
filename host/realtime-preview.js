/** Claude resolves its credential and transcription model; Composer owns preview synthesis. */
import { listRealtimeTranscriptionModels, previewStsVoice } from '@voicemesh/composer/server'
import { preferredTranscriptionModel } from './realtime-voice.js'

export async function previewRealtime(id, settings, voice, text, signal, onAudio) {
  if (!['openai', 'xai', 'gemini'].includes(id) || !settings.key || !settings.model || !voice) {
    throw new Error('Realtime voice is not configured')
  }
  const transcriptionModel = id === 'openai'
    ? settings.transcriptionModel || preferredTranscriptionModel(await listRealtimeTranscriptionModels(settings.key, signal))
    : undefined
  if (id === 'openai' && !transcriptionModel) throw new Error('No accessible OpenAI transcription model')
  return previewStsVoice(id, { key: settings.key, model: settings.model, voice, transcriptionModel },
    text, signal, onAudio)
}
