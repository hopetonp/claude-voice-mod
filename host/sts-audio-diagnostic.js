/** Composer-backed synthetic audio and coding-tool check; never opens a Claude task. */
import { WebSocket } from 'ws'
import { openaiLiveProvider, openaiStsProvider, xaiStsProvider, geminiStsProvider,
  listRealtimeTranscriptionModels } from '@voicemesh/composer/server'
import { preferredTranscriptionModel } from './realtime-voice.js'
import { stsProbeAudio } from './sts-probe-audio.js'
import { StsProtocolCheck, protocolCheckSession } from './sts-protocol-check.js'

const providers = { 'openai-live': openaiLiveProvider, openai: openaiStsProvider,
  xai: xaiStsProvider, gemini: geminiStsProvider }

export async function probeRealtimeAudioTools(id, settings, options = {}) {
  const provider = (options.providers ?? providers)[id]
  if (!provider || !settings?.key || !settings.model || !settings.voice) throw new Error('Configure a realtime provider first')
  const timeoutMs = options.timeoutMs ?? 45000
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs)
  const transcriptionModels = options.transcriptionModels ?? listRealtimeTranscriptionModels
  let transcriptionModel = settings.transcriptionModel
  if (id === 'openai' && !transcriptionModel) {
    transcriptionModel = preferredTranscriptionModel(await transcriptionModels(settings.key, signal))
    if (!transcriptionModel) return false
  }
  const live = id === 'openai-live'
  const adapter = provider.create({ ...settings, ...(transcriptionModel ? { transcriptionModel } : {}),
    instructions: live
      ? 'This is an isolated voice diagnostic. When the caller speaks, delegate to the backend immediately. After its result, say exactly: The voice test is ready.'
      : protocolCheckSession.instructions,
    tools: live ? [] : protocolCheckSession.tools,
    connectTimeoutMs: timeoutMs, maxQueuedBytes: 1024 * 1024 })
  const makeSocket = options.makeSocket ?? ((url, socketOptions) => new WebSocket(url, socketOptions))
  return new Promise(resolve => {
    const socket = makeSocket(adapter.url, { headers: adapter.headers,
      handshakeTimeout: timeoutMs, maxPayload: 1024 * 1024 })
    const protocol = live ? null : new StsProtocolCheck()
    let started = false, transcribed = false, answered = false, protocolStarted = false
    let delegated = false, audio = false, assistantText = ''
    let settled = false, outcome = false, finalized = false, silenceClock, closeTimer
    const cleanup = () => { clearTimeout(timer); clearInterval(silenceClock); clearTimeout(closeTimer)
      signal.removeEventListener('abort', abort) }
    const finish = ready => {
      if (settled) return
      settled = true
      outcome = ready
      clearTimeout(timer)
      clearInterval(silenceClock)
      if (ready && live && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'session.close' })) }
        catch { socket.terminate() }
        closeTimer = setTimeout(() => socket.terminate(), Math.min(timeoutMs, 5000))
      } else socket.terminate()
    }
    const abort = () => finish(false)
    const timer = setTimeout(abort, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    const sendCommands = commands => {
      let automatic = false
      for (const command of commands) {
        if (automatic && command.type === 'response.create') { automatic = false; continue }
        for (const encoded of adapter.encode(command)) socket.send(JSON.stringify(encoded))
        automatic = provider.toolResponseStartsResponse && command.item?.type === 'function_call_output'
      }
    }
    socket.on('open', () => { try { socket.send(JSON.stringify(adapter.setup)) } catch { finish(false) } })
    socket.on('error', () => finish(false))
    socket.once('close', () => { if (!settled) finish(false); cleanup(); resolve(outcome && (!live || finalized)) })
    socket.on('message', (data, binary) => {
      if (settled) {
        if (live) {
          try { if (JSON.parse(data.toString()).type === 'session.closed') { finalized = true; socket.terminate() } }
          catch { /* No provider payload leaves this diagnostic. */ }
        }
        return
      }
      if (binary && !provider.binaryJsonFrames) return
      try {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        const value = JSON.parse(bytes.toString('utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string'
          || value.type === 'error' || 'error' in value) return finish(false)
        if (live && value.type === 'session.output_audio.delta') audio = true
        for (const event of adapter.decode(value)) {
          if (event.type === 'voice.provider-error') return finish(false)
          if (live) {
            if (event.type === 'session.updated' && !started) {
              started = true
              socket.send(JSON.stringify({ type: 'session.input_audio.append', audio: stsProbeAudio }))
              silenceClock = setInterval(() => { if (!settled) socket.send(JSON.stringify({
                type: 'session.input_audio.append', audio: Buffer.alloc(4800).toString('base64'),
              })) }, 100)
            } else if (event.type === 'voice.live-delegation' && !delegated) {
              delegated = true
              socket.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: event.id,
                content: 'The voice test is ready.' }))
            } else if (event.type === 'voice.live-transcript' && event.role === 'assistant') assistantText += String(event.delta ?? '')
            if (delegated && audio && /voice.*test.*ready/i.test(assistantText)) return finish(true)
            continue
          }
          if (event.type === 'session.updated' && !started) {
            started = true
            if (id === 'openai') sendCommands([{ type: 'input_audio_buffer.append', audio: stsProbeAudio },
              { type: 'input_audio_buffer.append', audio: Buffer.alloc(96000).toString('base64') }])
            else sendCommands(protocol.start())
            continue
          }
          if (id === 'openai' && !protocolStarted) {
            if (event.type === 'conversation.item.input_audio_transcription.completed') {
              if (typeof event.transcript !== 'string' || !/voice.*test.*ready/i.test(event.transcript)) return finish(false)
              transcribed = true
            }
            if (event.type === 'response.done') {
              if (event.response?.status !== 'completed') return finish(false)
              answered = true
            }
            if (transcribed && answered) { protocolStarted = true; sendCommands(protocol.start()) }
            continue
          }
          const next = protocol.accept(event)
          if (typeof next === 'boolean') return finish(next)
          sendCommands(next)
        }
      } catch { finish(false) }
    })
  })
}
