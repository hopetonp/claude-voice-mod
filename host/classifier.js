/** Resolve the optional Composer classifier with harness-owned credentials. */
import { classifySpokenRequest } from '@voicemesh/composer/server'

export async function classifyForVoice(store, utterance, context, signal, fetcher) {
  const selected = store.classifier()
  if (!selected.enabled) throw new Error('Spoken request classifier is off')
  return classifySpokenRequest({ provider: selected.provider,
    model: selected.model, key: store.classifierCredential(selected.provider), utterance, context, signal, fetcher })
}
