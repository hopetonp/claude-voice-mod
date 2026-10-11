/** DeepSeek's connection cues, supplied to Composer's lifecycle sound hook. */
function beep(frequency, sampleRate, seconds, amplitude = .5) {
  const frames = Math.floor(sampleRate * seconds)
  const out = new Uint8Array(frames * 2)
  const attack = sampleRate * .015
  const release = sampleRate * .04
  for (let i = 0; i < frames; i++) {
    let envelope = 1
    if (i < attack) envelope = i / attack
    else if (i > frames - release) envelope = (frames - i) / release
    const value = Math.round(amplitude * envelope * Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0x7fff) & 0xffff
    out[i * 2] = value & 0xff
    out[i * 2 + 1] = value >> 8
  }
  return out
}

function connectedChime(sampleRate) {
  const out = new Uint8Array(Math.round(sampleRate * .62) * 2)
  const data = new DataView(out.buffer)
  const notes = [[0, 392, .25], [.12, 587.33, .30], [.22, 783.99, .34]]
  for (let i = 0; i < out.length / 2; i++) {
    const t = i / sampleRate
    let value = 0
    for (const [start, frequency, duration] of notes) {
      const x = t - start
      if (x < 0 || x >= duration) continue
      const attack = Math.sin(Math.min(1, x / .024) * Math.PI / 2) ** 2
      const release = Math.sin(Math.min(1, (duration - x) / .09) * Math.PI / 2) ** 2
      const envelope = attack * release * Math.exp(-x * 7)
      value += .105 * envelope * (Math.sin(2 * Math.PI * frequency * x)
        + .045 * Math.exp(-x * 10) * Math.sin(4 * Math.PI * frequency * x))
    }
    data.setInt16(i * 2, Math.round(value * 32767), true)
  }
  return out
}

function chime(tone) {
  if (tone === 'connected') return [connectedChime(16000)]
  if (tone === 'standby') return [beep(392, 16000, .16, .09)]
  // A finished result in another session: two soft rising notes, unlike the connection cues.
  if (tone === 'result') return [beep(523.25, 16000, .09, .08), beep(783.99, 16000, .16, .08)]
  return [659.25, 523.25].map(frequency => beep(frequency, 16000, .10, .12))
}

export function createStatusSounds() {
  let current
  let drainTimer
  const stop = () => {
    clearTimeout(drainTimer)
    drainTimer = undefined
    const context = current
    current = undefined
    if (context) void context.close().catch(() => {})
  }
  return {
    stop,
    play(tone) {
      stop()
      const context = new AudioContext({ sampleRate: 16000 })
      current = context
      const notes = chime(tone)
      const frames = notes.reduce((count, pcm) => count + pcm.length / 2, 0)
      const buffer = context.createBuffer(1, frames, 16000)
      const samples = buffer.getChannelData(0)
      let offset = 0
      for (const pcm of notes) {
        const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        for (let i = 0; i < pcm.length; i += 2) samples[offset++] = data.getInt16(i, true) / 32768
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      let endTime = 0
      const closeAfterOutput = () => {
        if (current !== context) return
        if (context.state !== 'running') { stop(); return }
        const outputTime = context.getOutputTimestamp?.().contextTime
          ?? context.currentTime - context.baseLatency - (context.outputLatency ?? 0)
        const remaining = endTime - outputTime
        if (remaining <= 0) { stop(); return }
        drainTimer = setTimeout(closeAfterOutput, Math.max(1, Math.ceil(remaining * 1000)))
      }
      source.onended = closeAfterOutput
      void context.resume().then(() => {
        if (current !== context) return
        const startTime = context.currentTime
        endTime = startTime + frames / 16000
        source.start(startTime)
      }).catch(() => { if (current === context) stop() })
    },
  }
}
