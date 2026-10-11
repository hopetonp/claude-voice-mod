import { createOpenaiWebRtcAdapter, createPcmSink, createStsController, createVoiceLifecycle, subscribeVoiceAudio } from '@voicemesh/composer/browser'
import { createStatusSounds } from './status-sounds.js'
import { createClaudePipeline } from './pipeline.js'

const $ = id => document.getElementById(id)
let token = ''
let lastCommand = 0
let mediaReady = false
let connection = null
let pipelineController = null
let transcript = ''
let lastReply = ''
let transcriptId = ''
let lastReplyId = ''
let inputLevels = Array(9).fill(0)
let outputLevels = Array(9).fill(0)
let lastLevelsPublished = 0
let lastStandbyCheck = 0
let standbyTransition = false
let pendingTestSource = null
let testAudioQueued = false
let state = { phase: 'idle', muted: false, speakerMuted: false, activeSeconds: 0, level: 0, error: null }
const player = createPcmSink()
const settings = {
  muted: false, speakerMuted: false, stsSchedulingLeadSeconds: .08, stsMaxQueuedSeconds: 12,
  stsMaxResponseSeconds: 180, stsFadeInSeconds: .015,
  stsCaptionCharactersPerSecond: 20, stsMaxQueuedBytes: 4 * 1024 * 1024,
  stsCloseTimeoutMs: 5000, stsConnectTimeoutMs: 15000, stsCaptureFrames: 1024,
}

function draw() {
  $('status').textContent = state.phase === 'needs-activation'
    ? 'Press Enable audio here once to grant access'
    : `Voice: ${state.phase}${state.muted ? ' · muted' : ''}`
  $('error').textContent = state.error ?? ''
  $('level').value = Math.round(state.level * 100)
  $('mute').textContent = state.muted ? 'Unmute' : 'Mute'
}
async function publish() {
  draw()
  if (!token) return
  const response = await fetch('/api/media-state', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...state, transcript, lastReply, transcriptId, lastReplyId, inputLevels, outputLevels,
      assistantOrbEnabled: connection?.assistantOrbEnabled ?? true }),
  })
  // Chrome keeps a request open until its reply is read. Unread, these piled up at four a second until,
  // after about an hour, the page could send no request at all.
  await response.arrayBuffer()
}
function caption(role, text, id = '') {
  if (!['user', 'assistant'].includes(role) || typeof text !== 'string') return
  const next = text.slice(0, 4000)
  if (role === 'user') {
    const stableId = id || transcriptId
    if (transcript === next && transcriptId === stableId) return
    transcript = next
    transcriptId = stableId
  } else {
    const stableId = id || lastReplyId
    if (lastReply === next && lastReplyId === stableId) return
    lastReply = next
    lastReplyId = stableId
  }
  void publish()
}
function showError(error) {
  state.error = error instanceof Error ? error.message : String(error)
  state.phase = 'error'
  void publish()
}
function startPendingTestAudio() {
  if (!pendingTestSource || testAudioQueued || state.phase !== 'listening') return
  testAudioQueued = true
  setTimeout(() => {
    testAudioQueued = false
    if (state.phase !== 'listening' || !pendingTestSource) return
    const source = pendingTestSource
    pendingTestSource = null
    try { source.start() }
    catch (error) { showError(error) }
  }, 600)
}
const sink = {
  getSnapshot: () => ({ phase: state.phase, transcript, lastReply }),
  setPhase: phase => {
    state.phase = phase
    if (phase !== 'error') state.error = null
    if (phase === 'listening') startPendingTestAudio()
    void publish()
  },
  setError: error => { state.error = error; void publish() },
  setLevel: level => { state.level = level; void publish() },
  setActiveSeconds: seconds => {
    if (!Number.isFinite(seconds)) return
    const next = Math.max(0, Math.floor(seconds))
    if (state.activeSeconds !== next) { state.activeSeconds = next; void publish() }
  },
  setTranscript: text => caption('user', text),
  setLastReply: text => caption('assistant', text),
}
// A quiet start or stop (a session switch) only resumes or pauses that session's voice: no connection chime.
const QUIET_MS = 8000
let quietUntil = 0
const lifecycle = createVoiceLifecycle(sink, () => ({ voiceStandbySec: connection?.voiceStandbySec ?? 30,
  statusSounds: Date.now() >= quietUntil && (connection?.statusSounds ?? true) }), createStatusSounds())
const chimes = createStatusSounds()
subscribeVoiceAudio(levels => {
  inputLevels = levels.input.slice(0, 9)
  outputLevels = levels.output.slice(0, 9)
  if (Date.now() - lastLevelsPublished >= 250) {
    lastLevelsPublished = Date.now()
    void publish()
  }
})
const signaling = {
  commandFailureText: 'The provider did not confirm the update.',
  resolve() {
    if (!connection) throw new Error('Voice provider is not configured')
    return {
      provider: connection.id, transport: connection.transport,
      inputSampleRate: connection.inputSampleRate, outputSampleRate: connection.outputSampleRate,
      nativePlayback: connection.id === 'openai-live',
      ...(connection.transport === 'webrtc' ? { rtcAdapter: () => connection.id === 'openai-live'
        ? { channelLabel: 'oai-events', activity: { pollMs: 100, threshold: .01, idleMs: 350 }, decode: () => [] }
        : createOpenaiWebRtcAdapter() } : {}),
    }
  },
  socket() {
    const socket = new WebSocket(`ws://${location.host}/voice`)
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.type === 'voice.live-caption') {
        caption(message.role, message.text, message.id)
      }
      if (message.type === 'voice.conversation-ended') void stop()
    })
    return socket
  },
  start(id, config, provider, offer) { return { type: 'start', provider: provider.provider, ...(offer ? { offer } : {}) } },
  refresh: () => ({ type: 'settings' }), canEnd: () => false,
}
const controller = createStsController(
  () => settings, sink, 'Voice connection failed. Check provider settings.',
  () => () => {}, 'Input transcription failed.', lifecycle, signaling,
)

async function installTestAudio() {
  const response = await fetch('/api/test-audio')
  if (!response.ok) throw new Error('Test audio unavailable')
  const context = new AudioContext()
  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (!constraints?.audio) return original(constraints)
    await context.resume()
    const destination = context.createMediaStreamDestination()
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(destination)
    pendingTestSource = source
    startPendingTestAudio()
    return destination.stream
  }
}

async function enableAudio() {
  try {
    await refreshConnection()
    if (!connection) throw new Error('Voice provider is not configured')
    transcript = ''
    lastReply = ''
    transcriptId = ''
    lastReplyId = ''
    await publish()
    if (connection.mode === 'pipeline') {
      pipelineController ??= createClaudePipeline({ connection, token, sink, caption, settings, lifecycle })
      await pipelineController.start()
    } else await controller.start('claude')
    mediaReady = true
    state.error = null
    await publish()
  } catch (error) { showError(error) }
}
async function start() {
  await refreshConnection()
  if (!mediaReady) { await enableAudio(); return }
  if (!connection) throw new Error('Voice provider is not configured')
  transcript = ''
  lastReply = ''
  transcriptId = ''
  lastReplyId = ''
  await publish()
  if (connection.mode === 'pipeline') {
    pipelineController ??= createClaudePipeline({ connection, token, sink, caption, settings, lifecycle })
    await pipelineController.start()
  } else await controller.start('claude')
}
async function refreshConnection() {
  const response = await fetch('/api/connections')
  if (!response.ok) throw new Error('Could not load voice connection')
  const { connections } = await response.json()
  connection = connections[0] ?? null
}
async function stop() {
  if (pipelineController) { await pipelineController.stop(); pipelineController = null }
  else await controller.stop()
  player.stop()
  player.reset()
  state = { phase: 'idle', muted: false, speakerMuted: false, activeSeconds: 0, level: 0, error: null }
  settings.muted = false
  settings.speakerMuted = false
  await publish()
}
async function toggleMute() {
  state.muted = !state.muted
  settings.muted = state.muted
  ;(pipelineController ?? controller).settingsChanged()
  await publish()
}
async function toggleSpeakerMute() {
  state.speakerMuted = !state.speakerMuted
  settings.speakerMuted = state.speakerMuted
  ;(pipelineController ?? controller).settingsChanged()
  await publish()
}
function tonePcm() {
  const sampleRate = 16000, frames = Math.round(sampleRate * .25), pcm = new Uint8Array(frames * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / 160, (frames - i) / 160)
    view.setInt16(i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 8000 * fade), true)
  }
  return pcm
}
async function testSpeaker() {
  await player.unlock()
  player.reset()
  player.setSampleRate(16000)
  await player.sink(tonePcm(), 'audio/L16')
}
async function pollCommands() {
  if (!token) return
  const response = await fetch(`/api/commands?after=${lastCommand}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Host command poll failed: ${response.status}`)
  const { commands } = await response.json()
  for (const command of commands) {
    lastCommand = command.id
    if (command.quiet) quietUntil = Date.now() + QUIET_MS
    try {
      if (command.action === 'start') await start()
      if (command.action === 'stop') await stop()
      if (command.action === 'mute') await toggleMute()
      if (command.action === 'speaker-mute') await toggleSpeakerMute()
      if (command.action === 'speaker-test') await testSpeaker()
      if (command.action === 'chime') { if (connection?.statusSounds !== false) chimes.play('result') }
    } catch (error) { showError(error) }
  }
  if (state.phase === 'standby' && !standbyTransition && Date.now() - lastStandbyCheck >= 1000) {
    lastStandbyCheck = Date.now()
    const status = await fetch('/api/voice/standby', { headers: { Authorization: `Bearer ${token}` } })
    if (!status.ok) throw new Error('Could not check standby work')
    const { owedTurn } = await status.json()
    if (state.phase !== 'standby') return
    standbyTransition = true
    try {
      if (!pipelineController && Number.isSafeInteger(owedTurn) && owedTurn > 0) await controller.readBackOutput('claude', owedTurn)
    } finally { standbyTransition = false }
  }
}

$('enable').addEventListener('click', () => void enableAudio())
$('stop').addEventListener('click', () => void stop())
$('mute').addEventListener('click', () => void toggleMute())
$('tone').addEventListener('click', () => void testSpeaker().catch(showError))
window.addEventListener('pagehide', () => { void (pipelineController?.stop() ?? controller.stop()) })
try {
  const response = await fetch('/api/bootstrap')
  if (!response.ok) throw new Error('VoiceMesh host unavailable')
  const bootstrap = await response.json()
  token = bootstrap.token
  lastCommand = bootstrap.cursor
  if (bootstrap.testAudio) await installTestAudio()
  const { connections } = await fetch('/api/connections').then(value => value.json())
  connection = connections[0] ?? null
  if (!connection) state.error = 'Voice provider is not configured'
  await publish()
  setInterval(() => void pollCommands().catch(showError), 400)
} catch (error) { showError(error) }
