import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function mediaPage() {
  const text = await readFile(new URL('../media/main.js', import.meta.url), 'utf8')
  const { createHostPoll } = await import('../media/host-poll.js')
  let interval, fail = false, hold, now = 0, polls = 0, starts = 0
  const element = () => ({ addEventListener() {} })
  const context = { createHostPoll: (poll, options) => createHostPoll(poll, { ...options, now: () => now }),
    createPcmSink: () => ({ stop() {}, reset() {} }),
    createVoiceLifecycle: () => ({}), createStatusSounds: () => ({}), subscribeVoiceAudio() {},
    createStsController: (_settings, sink) => ({ start: async () => { starts++; sink.setPhase('listening') }, stop: async () => {} }),
    createOpenaiWebRtcAdapter() {}, createClaudePipeline() {},
    document: { getElementById: element }, window: { addEventListener() {} },
    console: { warn() {} }, setTimeout, clearTimeout, Date,
    setInterval(fn) { interval = fn },
    fetch: async path => {
      if (path.startsWith('/api/commands')) {
        polls++
        if (hold) await hold
        if (fail) throw new TypeError('Failed to fetch')
      }
      return { ok: true, json: async () => path === '/api/bootstrap' ? { token: 't', cursor: 0 }
        : path === '/api/connections' ? { connections: [{ id: 'openai', transport: 'webrtc' }] } : { commands: [] },
        arrayBuffer: async () => new ArrayBuffer(0) }
    },
  }
  const source = text.replace(/^import .*$/gm, '')
  const page = await vm.runInNewContext(`(async () => { ${source}; return { start, stop, state: () => ({ ...state }), providerError: () => showError(new Error('Provider rejected connection')) } })()`, context)
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }
  return { page, settle, tick: async () => { interval(); await settle() },
    setFail(value) { fail = value }, advance(ms) { now += ms }, hold(promise) { hold = promise },
    polls: () => polls, starts: () => starts }
}

test('a failed host fetch leaves live voice listening and recovers without reconnecting', async () => {
  const h = await mediaPage()
  await h.page.start()
  h.setFail(true); await h.tick()
  assert.equal(h.page.state().phase, 'listening')
  assert.equal(h.page.state().error, null)
  h.setFail(false); h.advance(400); await h.tick()
  assert.equal(h.page.state().phase, 'listening')
  assert.equal(h.page.state().error, null)
  assert.equal(h.starts(), 1, 'host recovery does not reconnect the provider')
})

test('repeated host failures back off, clear their own warning, and never restart stopped voice', async () => {
  const h = await mediaPage()
  await h.page.start(); h.setFail(true)
  await h.tick(); await h.tick(); assert.equal(h.polls(), 1)
  h.advance(400); await h.tick()
  h.advance(800); await h.tick()
  assert.match(h.page.state().error, /Retrying/)
  assert.equal(h.page.state().phase, 'listening')
  await h.page.stop()
  h.setFail(false); h.advance(1600); await h.tick()
  assert.equal(h.page.state().phase, 'idle')
  assert.equal(h.page.state().error, null)
  assert.equal(h.starts(), 1)
})

test('host recovery does not erase a provider error and polls cannot overlap', async () => {
  const h = await mediaPage()
  let release
  h.hold(new Promise(resolve => { release = resolve }))
  await h.tick(); await h.tick(); assert.equal(h.polls(), 1)
  release(); h.hold(null); await h.settle()
  h.setFail(true); await h.tick(); h.advance(400); await h.tick(); h.advance(800); await h.tick()
  h.page.providerError()
  h.setFail(false); h.advance(1600); await h.tick()
  assert.equal(h.page.state().phase, 'error')
  assert.equal(h.page.state().error, 'Provider rejected connection')
})
