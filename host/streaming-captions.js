import { WebSocket } from 'ws'

/** Optional display-only transcription. Conversation transcripts remain authoritative. */
export function createStreamingCaptions({ key, model, signal, preview, failed,
  connect = (url, options) => new WebSocket(url, options) }) {
  if (!key || !/^gemini-[\w.-]+-transcribe-live(?:-[\w.-]+)?$/.test(model)) {
    failed(); return { push() {}, suppress() {}, close() {} }
  }
  const socket = connect('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
    { headers: { 'x-goog-api-key': key } })
  let ready = false, closed = false, suppressed = false, text = '', queuedBytes = 0
  const queue = []
  const timer = setTimeout(() => fail(), 15000)
  timer.unref?.()
  const close = () => {
    if (closed) return
    closed = true; clearTimeout(timer); queue.length = 0; queuedBytes = 0
    signal.removeEventListener('abort', close)
    socket.on('error', () => {})
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else socket.close()
  }
  const fail = () => { if (!closed) { close(); failed() } }
  const send = value => {
    if (closed) return
    try {
      if (socket.bufferedAmount > 256 * 1024) return fail()
      socket.send(JSON.stringify(value))
    } catch { fail() }
  }
  signal.addEventListener('abort', close, { once: true })
  socket.on('open', () => send({ setup: {
    model: `models/${model}`, generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { mode: 'VERBATIM', languageCodes: [] },
  } }))
  socket.on('message', raw => {
    if (closed) return
    try {
      const event = JSON.parse(raw.toString())
      if (event.error || event.goAway) return fail()
      if (event.setupComplete !== undefined) {
        ready = true; clearTimeout(timer)
        for (const audio of queue.splice(0)) send({ realtimeInput: { audio: { data: audio, mimeType: 'audio/pcm;rate=16000' } } })
        queuedBytes = 0
      }
      const content = event.serverContent
      const activity = event.voiceActivity ?? content?.voiceActivity
      if (activity?.voiceActivityType === 'ACTIVITY_START') { text = ''; suppressed = false }
      if (!content) return
      const final = content.inputTranscription?.text
      const interim = content.interimInputTranscription?.text
      if (typeof final === 'string') text = (text + final).slice(-4000)
      if (!suppressed && (typeof final === 'string' || typeof interim === 'string')) {
        const caption = (text + (typeof interim === 'string' ? interim : '')).slice(-4000)
        if (caption.trim()) preview(caption)
      }
      if (content.turnComplete || content.generationComplete) { text = ''; suppressed = false }
    } catch { fail() }
  })
  socket.on('error', fail)
  socket.on('close', fail)
  if (signal.aborted) close()
  return {
    push(audio) {
      if (closed || typeof audio !== 'string') return
      if (ready) send({ realtimeInput: { audio: { data: audio, mimeType: 'audio/pcm;rate=16000' } } })
      else {
        queuedBytes += audio.length
        if (queuedBytes > 256 * 1024) return fail()
        queue.push(audio)
      }
    },
    suppress() { suppressed = true },
    close,
  }
}
