/** Isolated provider connection check; no microphone, coding task, or user history. */
import { WebSocket } from 'ws'
import { openaiLiveProvider, openaiStsProvider, xaiStsProvider, geminiStsProvider } from '@voicemesh/composer/server'

const providers = { 'openai-live': openaiLiveProvider, openai: openaiStsProvider,
  xai: xaiStsProvider, gemini: geminiStsProvider }

export function probeRealtimeConnection(id, settings, options = {}) {
  const provider = (options.providers ?? providers)[id]
  if (!provider || !settings?.key || !settings.model || !settings.voice) {
    throw new Error('Configure a realtime provider first')
  }
  const timeoutMs = options.timeoutMs ?? 12000
  const adapter = provider.create({ ...settings, instructions: 'Isolated connection diagnostic. Do not speak or call tools.',
    tools: [], connectTimeoutMs: timeoutMs, maxQueuedBytes: 1024 * 1024 })
  const makeSocket = options.makeSocket ?? ((url, socketOptions) => new WebSocket(url, socketOptions))
  return new Promise(resolve => {
    let settled = false
    const socket = makeSocket(adapter.url, { headers: adapter.headers,
      handshakeTimeout: timeoutMs, maxPayload: 1024 * 1024 })
    const timeout = setTimeout(() => finish(false), timeoutMs)
    const finish = ready => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (ready && id === 'openai-live' && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'session.close' })) }
        catch { socket.terminate() }
        setTimeout(() => socket.terminate(), 1000).unref?.()
      } else socket.terminate()
      resolve(ready)
    }
    socket.once('open', () => {
      try { socket.send(JSON.stringify(adapter.setup)) }
      catch { finish(false) }
    })
    socket.on('message', (data, binary) => {
      if (settled || (binary && !provider.binaryJsonFrames)) return
      try {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        const value = JSON.parse(bytes.toString('utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string'
          || value.type === 'error' || 'error' in value) return finish(false)
        for (const event of adapter.decode(value)) {
          if (event.type === 'voice.provider-error') return finish(false)
          if (event.type === 'session.updated') return finish(true)
        }
      } catch { finish(false) }
    })
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}
