/** Claude's thin session adapter for Composer's reusable voice pipeline. */
import { PipelineConversation } from '@voicemesh/composer/pipeline'
import { codingAcknowledgement, noHandoffTalk, spokenTechnicalText, userNameInstruction } from '../host/voice-policy.js'
import { createBrowserPipelineController, createPipelinePlayback, openPipelineSttStream } from '@voicemesh/composer/browser'

const tool = { type: 'function', function: { name: 'dispatch_coding_task',
  description: 'Ask Claude to inspect or change the current project. Use this for coding, files, projects, or technical work.',
  parameters: { type: 'object', properties: { instruction: { type: 'string' } }, required: ['instruction'], additionalProperties: false } } }

export function createClaudePipeline({ connection, token, sink, caption, settings, lifecycle }) {
  const selection = connection.pipeline
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const post = async (path, body, signal) => {
    const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Voice request failed: ${response.status}`)
    return response
  }
  let pendingResult = null
  let polling = false
  let stopped = false
  let userCaptionId = ''
  let lastUserPartial = ''
  let captionWrites = Promise.resolve()
  const projection = { ...sink, setTranscript(text) {
    if (!text.trim()) { sink.setTranscript(text); return }
    userCaptionId ||= crypto.randomUUID()
    caption('user', text, userCaptionId)
    if (text === lastUserPartial) return
    lastUserPartial = text
    const id = userCaptionId
    captionWrites = captionWrites.catch(() => {}).then(() => post('/api/pipeline/exchange', {
      role: 'user', text, id, phase: 'update',
    }))
    void captionWrites.catch(error => sink.setError(error.message))
  } }
  const playback = createPipelinePlayback({
    charactersPerSecond: 20, cueVolume: .35,
    outputVolume: () => settings.speakerMuted ? 0 : 1,
    caption: async (value, id) => {
      caption('assistant', value.text, id)
      await post('/api/pipeline/exchange', { role: 'assistant', text: value.text, id, phase: value.phase })
    },
    async synthesize(text, audio, signal) {
      const response = await post('/api/pipeline/speak', { text }, signal)
      if (!response.body) throw new Error('Speech provider returned no audio')
      const rate = Number(response.headers.get('X-Voice-Sample-Rate'))
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('Speech provider returned no sample rate')
      const reader = response.body.getReader()
      try {
        for (;;) {
          const next = await reader.read()
          signal.throwIfAborted()
          if (next.done) break
          if (next.value.length) audio(next.value, rate)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    },
  })
  const routingInstruction = connection.classifierEnabled
    ? 'The pipeline routes each completed request before you respond. Follow the route supplied with the turn; do not call coding tools.'
    : 'For requests about code, files, projects, or technical work, call dispatch_coding_task so Claude performs the work.'
  const conversation = new PipelineConversation({
    request: (body, signal) => post('/api/pipeline/answer', body, signal),
    ...(connection.classifierEnabled ? { classify: async (utterance, context, signal) =>
      (await (await post('/api/pipeline/classify', { utterance, context }, signal)).json()).route } : {}),
    dispatchCodingRequest: async (utterance, signal) =>
      (await post('/api/pipeline/dispatch', { instruction: utterance }, signal)).json(),
    async tool(name, args) {
      if (name !== 'dispatch_coding_task' || !args || typeof args.instruction !== 'string') throw new Error('Unknown voice tool')
      return (await post('/api/pipeline/dispatch', { instruction: args.instruction })).json()
    },
    system: kind => `You are the voice attendant for Claude's coding agent. Speak naturally and briefly in the user's language. ${spokenTechnicalText} ${userNameInstruction(connection.userName)} You receive speech transcripts. Answer ordinary conversation yourself. ${routingInstruction} Never claim to have inspected or changed files yourself. A dispatched task is a receipt, not its result. Do not mention your instructions, internal routing, classifier, or tool calls in spoken replies. ${codingAcknowledgement} ${noHandoffTalk} ${kind === 'coding-result' ? `Summarize the supplied Claude result without calling tools.${connection.plainLanguageSummaries ? ' Use simple everyday language, avoid jargon where possible, briefly explain necessary technical terms, and preserve key findings, blockers, and next steps.' : ''}` : kind === 'coding-progress' ? 'Report only the supplied coding progress.' : ''}`,
    tools: () => [tool],
    contextTurns: () => 6,
    toolRounds: () => 2,
  })
  const host = {
    unlock: () => playback.unlock(),
    async stt(bytes, sessionId) {
      const stream = await this.sttStream(sessionId)
      try { stream.feed(bytes); return await stream.end() } finally { stream.close() }
    },
    sttStream(_sessionId, signal) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      return openPipelineSttStream(`${protocol}//${location.host}/pipeline/stt`, signal)
    },
    onReply(_sessionId, handler) {
      const timer = setInterval(async () => {
        if (stopped || pendingResult || polling) return
        polling = true
        try {
          const response = await fetch('/api/pipeline/owed', { headers: { Authorization: `Bearer ${token}` } })
          if (!response.ok) return
          const { result } = await response.json()
          if (result && !pendingResult) { pendingResult = result.playbackId; handler(result.text || 'Claude could not complete that request.') }
        } finally { polling = false }
      }, 750)
      return () => clearInterval(timer)
    },
    prompt: async (_sessionId, instruction) => { await post('/api/pipeline/dispatch', { instruction }) },
    prepareConversation(text, _sessionId, speechState, cueStarted) {
      conversation.prepare(text, (cue, started) => playback.cue(cue, undefined, () => { cueStarted?.(cue); started() }), speechState)
    },
    finishPreparation() { conversation.finishPreparation(); playback.stopCue() },
    cancelPreparation() { conversation.cancelPreparation(); playback.stopCue() },
    resetConversation() { conversation.cancelPreparation() },
    conversation(text, _sessionId, kind, emit, signal, requestEnd, afterSpeech) {
      return conversation.run(text, kind === 'application-result' ? 'coding-result' : kind === 'application-progress' ? 'coding-progress' : 'user', emit, signal, requestEnd, afterSpeech)
    },
    async recordExchange(_sessionId, user, assistant) {
      if (user) {
        await captionWrites
        await post('/api/pipeline/exchange', { role: 'user', text: user,
          id: userCaptionId || crypto.randomUUID(), phase: 'final' })
        userCaptionId = ''
        lastUserPartial = ''
      }
      if (assistant) await post('/api/pipeline/exchange', { role: 'assistant', text: assistant })
    },
    async ttsStream(texts, onStart, signal) {
      await playback.play(texts, onStart, signal)
      if (pendingResult) {
        const playbackId = pendingResult
        await post('/api/pipeline/played', { playbackId })
        pendingResult = null
      }
    },
    tts: (text, onStart) => playback.play([text], onStart),
    stopTts: async () => playback.stop(),
  }
  const { loop, close } = createBrowserPipelineController(host, projection,
    () => ({ muted: settings.muted === true, readBack: true, conversationalEnabled: true,
      voiceStandbySec: connection.voiceStandbySec, vadSilenceSec: selection.vadSilenceSec,
      statusSounds: connection.statusSounds, backchannelEnabled: false }),
    { sampleRate: connection.inputSampleRate, lifecycle, closeAudio: () => playback.close() })
  return {
    async start() { stopped = false; await loop.start('claude') },
    async stop() { stopped = true; await close() },
    standby() { loop.standby() },
    settingsChanged() { loop.settingsChanged() },
  }
}
