import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createSettings } from './provider-settings.js'
import { createTaskLedger } from './task-ledger.js'
import { unstartedClaimExpired } from './claim-recovery.js'
import { createClaudeTaskRecovery } from './claude-task-recovery.js'
import { createResultLedger } from './result-ledger.js'
import { createTranscriptLedger } from './transcript-ledger.js'
import { createVoiceSessions } from './voice-sessions.js'
import { sessionTitle } from './session-title.js'
import { attachVoice, configuredConnections } from './voice-server.js'
import { attachRealtimeVoice } from './realtime-voice.js'
import { previewRealtime } from './realtime-preview.js'
import { probeRealtimeConnection } from './realtime-diagnostics.js'
import { probeRealtimeAudioTools } from './sts-audio-diagnostic.js'
import { startBackgroundMedia } from './background-media.js'
import { openSettingsWindow } from './settings-window.js'
import { claudeDesktopLocale, claudeDesktopTheme } from './claude-theme.js'
import { classifyForVoice } from './classifier.js'
import { addSteer, steerFollowUp, steerNote } from './voice-steer.js'
import { scopedVoiceId } from './voice-identity.js'
import { pcm16ToWav } from './wav.js'
import { attachPipelineSttSession, connectPipelineProvider, synthesizePipeline,
  streamPcmPreview,
  LocalVoice, LocalInstaller, createPipelineRecognizer, listPipelineEngines,
  conversationProviders, resolveConversationBase, conversationCredentialSlot, listConversationModels, requestPipelineConversation,
  discoverVoices, listLiveBackendModels, listStsModels, previewLive, openLivePreviewSession,
  listGeminiSpeechModels, listOpenaiSpeechModels, listDeepgramFluxCatalog } from '@voicemesh/composer/server'
import { withXaiVoiceModels } from './xai-voice-models.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const setupRoot = join(root, 'dist-setup')
const connectionFile = process.env.VOICEMESH_CONNECTION_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'connection.json')
const displayFile = process.env.VOICEMESH_DISPLAY_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'display.json')
const token = randomBytes(32).toString('hex')
const providerStore = await createSettings(process.env.COMPOSER_SETTINGS_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'providers.json'))
const localRoot = process.env.VOICEMESH_LOCAL_ROOT ?? join(homedir(), '.claude', 'voicemesh-controls', 'voice-local')
const localRuntimePath = join(localRoot, 'runtime')
const localModelsPath = join(localRoot, 'models')
const localVoice = new LocalVoice({ runtimePath: localRuntimePath, modelsPath: localModelsPath, threads: 2, idleMs: 30000, timeoutMs: 30000 })
const localInstaller = new LocalInstaller({ runtimePath: localRuntimePath, modelsPath: localModelsPath,
  python: process.env.VOICEMESH_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), timeoutMs: 30 * 60 * 1000 })
const taskLedger = await createTaskLedger(process.env.VOICEMESH_TASK_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'task.json'))
const resultLedger = await createResultLedger(process.env.VOICEMESH_RESULT_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'results.json'))
const transcriptLedger = await createTranscriptLedger(process.env.VOICEMESH_TRANSCRIPT_FILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'transcripts.json'))
let mediaState = { phase: 'offline', muted: false, speakerMuted: false, activeSeconds: 0, level: 0, error: null, transcript: '', lastReply: '', transcriptId: '', lastReplyId: '', inputLevels: [], outputLevels: [], assistantOrbEnabled: true }
let mediaSeenAt = 0
let sequence = 0
const commands = []
const sessions = createVoiceSessions()
// A settings window owns its Live sample connection; the browser closes it with the window.
const livePreviewSessions = new Map()
const closeLivePreview = sessionId => {
  const entry = livePreviewSessions.get(sessionId)
  if (!entry) return
  livePreviewSessions.delete(sessionId)
  clearTimeout(entry.cleanup)
  void entry.session.then(session => session.close(), () => {})
}
const keepLivePreview = sessionId => {
  const entry = livePreviewSessions.get(sessionId)
  if (!entry) return
  clearTimeout(entry.cleanup)
  // A still-open editor refreshes this; it only expires after a crash or missed close event.
  entry.cleanup = setTimeout(() => closeLivePreview(sessionId), 3 * 60 * 1000)
}
const useLivePreview = async (sessionId, settings, voice, text, signal, onAudio) => {
  const identity = `${settings.key}\u0000${settings.model}\u0000${voice}`
  let entry = livePreviewSessions.get(sessionId)
  if (entry && entry.identity !== identity) { closeLivePreview(sessionId); entry = undefined }
  if (!entry) {
    entry = { identity, session: openLivePreviewSession(settings.key, settings.model, voice), cleanup: null }
    livePreviewSessions.set(sessionId, entry)
  }
  keepLivePreview(sessionId)
  try {
    const session = await entry.session
    if (session.closed) throw new Error('Live preview session closed')
    return await session.speak(text, signal, onAudio)
  } catch (error) { closeLivePreview(sessionId); throw error }
}
const pipelineKeyProvider = engine => engine === 'deepgram-flux' || engine === 'deepgram' ? 'deepgram'
  : engine === 'grok' ? 'xai' : engine
const pipelineKey = engine => providerStore.pipelineCredential(pipelineKeyProvider(engine))
const conversationSlot = selected => conversationCredentialSlot(selected.conversationalProvider, selected.conversationalBaseUrl)
const conversationKey = selected => providerStore.pipelineCredential(conversationSlot(selected))
const conversationReady = selected => {
  try {
    resolveConversationBase(selected.conversationalProvider, selected.conversationalBaseUrl)
    return selected.conversationalProvider === 'custom' || !!conversationKey(selected)
  } catch { return false }
}
const localEngine = engine => ['vosk', 'parakeet', 'kokoro'].includes(engine)
const pipelineReady = () => {
  const selected = providerStore.pipeline()
  return !!selected.sttEngine && (!['openai', 'gemini'].includes(selected.sttEngine) || !!selected.sttModel)
    && !!selected.ttsEngine && (!['openai', 'gemini'].includes(selected.ttsEngine) || !!selected.ttsModel) && !!selected.ttsVoice
    && !!selected.conversationalModel && (localEngine(selected.sttEngine) ? !!selected.sttModel && localVoice.nativeAvailable('stt', selected.sttEngine) : !!pipelineKey(selected.sttEngine))
    && (localEngine(selected.ttsEngine) ? localVoice.nativeAvailable('tts') : !!pipelineKey(selected.ttsEngine)) && conversationReady(selected)
}
const availableConnections = () => {
  if (providerStore.voiceMode() !== 'pipeline') return configuredConnections(providerStore)
  if (!pipelineReady()) return []
  const selected = providerStore.pipeline()
  const recognizer = createPipelineRecognizer(selected.sttEngine, selected.sttModel, connectPipelineProvider,
    () => pipelineKey(selected.sttEngine), localVoice)
  if (!recognizer || !('turnStream' in recognizer)) return []
  const shared = providerStore.get('openai')
  const connection = { id: 'pipeline', name: 'Voice pipeline', mode: 'pipeline', pipeline: selected,
    classifierEnabled: providerStore.classifier().enabled,
    inputSampleRate: recognizer.inputSampleRate, voiceStandbySec: shared.voiceStandbySec,
    statusSounds: shared.statusSounds, assistantOrbEnabled: shared.assistantOrbEnabled }
  recognizer.dispose()
  return [connection]
}
// Each session's own voice request; a background session's job keeps its slot while another is selected.
const taskOf = sessionId => sessionId ? taskLedger.get(sessionId) : null
const settlingTasks = new Set()
const active = task => !!task && (settlingTasks.has(task.sessionId) || !['complete', 'aborted', 'failed', 'reviewed'].includes(task.status))
const persistTask = task => taskLedger.save(task)
// An uncertain submit is never replayed. Once the claim has failed to produce a
// turn, fail that request so it cannot steer or block every later request.
async function releaseExpiredClaim(sessionId) {
  const task = taskOf(sessionId)
  if (!unstartedClaimExpired(task)) return false
  await persistTask({ ...task, status: 'failed', result: 'Voice handoff did not start. Please try the request.' })
  pendingSteers.delete(sessionId)
  return true
}
// Older saved claims have no timestamp. Start their recovery window on this host start.
for (const task of taskLedger.all()) {
  if (['claimed', 'submitting'].includes(task.status) && !task.turnId && !task.claimedAt) {
    await persistTask({ ...task, claimedAt: Date.now() })
  }
}
for (const task of taskLedger.all()) {
  if (task.playbackId && ['complete', 'aborted', 'failed'].includes(task.status)) await resultLedger.record(task)
}
let activeLive = null
// When a voice job last finished in a session the user was not viewing, and that session's name, so a
// plugin announces it once.
const finishedAway = new Map()
// Spoken interruptions per session: a stop waiting for its turn to be cancelled, or notes waiting for
// the turn's next tool call (voice-steer.js).
const pendingSteers = new Map()
let milestoneTaskId = ''
const milestoneSteps = new Set()
const inspectTaskCompletion = createClaudeTaskRecovery({ projects: process.env.VOICEMESH_CLAUDE_PROJECTS })
const recoveryInFlight = new Map()
const recoveredClients = new Set()

async function finishClaudeTask(task, status, text, recoveryEvidence) {
  const current = taskOf(task.sessionId)
  if (settlingTasks.has(task.sessionId) || current?.id !== task.id || current.turnId !== task.turnId || current.status !== 'running') return false
  settlingTasks.add(task.sessionId)
  try {
    const sessionId = task.sessionId
    const steered = pendingSteers.get(sessionId)?.parentId === task.id ? pendingSteers.get(sessionId) : null
    const finished = { ...task, status, result: text.slice(0, 16000),
      ...(recoveryEvidence ? { recoveryEvidence, recoveredAt: Date.now() } : {}) }
    await persistTask(finished)
    if (finished.playbackId && steered?.kind !== 'stop') {
      await resultLedger.record(finished)
      if (recoveryEvidence === 'manual-release') await resultLedger.markPlayed(finished.playbackId, sessionId)
    }
    const followUp = steerFollowUp(steered)
    if (followUp) {
      const playbackId = await resultLedger.allocate()
      await persistTask({ id: followUp.id, text: followUp.text, mode: 'submit', status: 'queued',
        sessionId, turnId: null, result: null, playbackId })
    }
    if (steered) pendingSteers.delete(sessionId)
    if (sessionId !== sessions.selected()) {
      if (sessions.selected() && finished.playbackId && steered?.kind !== 'stop') {
        const away = { at: Date.now(), title: '' }
        finishedAway.set(sessionId, away)
        away.title = await sessionTitle(sessionId, sessions.cwd(sessionId)).catch(() => '')
        const folder = sessions.folder(sessionId)
        void activeLive?.notice?.(`By the way, the work in the ${folder ? `${folder} ` : 'other '}session is finished.`)?.catch(() => {})
      }
    } else {
      const connected = activeLive
      void connected?.completed().then(() => connected.replayOwed()).catch(() => {})
    }
    return true
  } finally { settlingTasks.delete(task.sessionId) }
}

async function recoverCompletedTask(sessionId) {
  if (recoveryInFlight.has(sessionId)) return recoveryInFlight.get(sessionId)
  const operation = (async () => {
    const task = taskOf(sessionId)
    if (task?.status !== 'running') return false
    const completion = await inspectTaskCompletion(task, sessions.cwd(sessionId))
    if (!completion) return false
    const recovered = await finishClaudeTask(task, completion.status, completion.text, completion.evidence)
    if (recovered) console.info('Recovered completed Claude voice request from its session transcript')
    return recovered
  })()
  recoveryInFlight.set(sessionId, operation)
  try { return await operation } finally { recoveryInFlight.delete(sessionId) }
}

// Missing callbacks must heal even when the voice is idle or the Mod has reloaded.
setInterval(() => {
  for (const task of taskLedger.all()) void recoverCompletedTask(task.sessionId).catch(error => {
    console.error(`Claude task recovery failed: ${error.message}`)
  })
}, 5000).unref()

// The voice's coding tools, bound to the session that owns one voice conversation.
const liveTasksFor = owner => ({
  states() {
    const task = taskOf(owner)
    return task ? [{
      requestId: task.id,
      // Composer steers while a handoff is pending; neither claim nor submit-start is a Claude turn.
      status: unstartedClaimExpired(task) ? 'failed'
        : task.status === 'complete' ? 'completed' : task.status === 'aborted' ? 'stopped'
        : ['claimed', 'submitting'].includes(task.status) ? 'running' : task.status,
      text: task.result ?? '', revision: 0,
      turn: task.playbackId,
      resultRevision: task.status === 'complete' ? 0 : null,
    }] : []
  },
  async dispatch(id, { instruction }) {
    if (!owner) throw new Error('No Claude session connected')
    await releaseExpiredClaim(owner)
    await recoverCompletedTask(owner)
    if (resultLedger.owed(owner).length) throw new Error('A previous Claude result is waiting to be spoken')
    if (active(taskOf(owner))) throw new Error('Claude is busy')
    const playbackId = await resultLedger.allocate()
    await persistTask({ id, text: instruction, mode: 'submit', status: 'queued', sessionId: owner, turnId: null, result: null, playbackId })
    await transcriptLedger.markDelegated(owner, instruction).catch(() => {})
    return { requestId: id }
  },
  // Composer steers instead of dispatching while a task is active (a spoken stop or correction).
  async steer(id, { instruction }) {
    if (!owner) throw new Error('No Claude session connected')
    if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('Invalid steering instruction')
    await releaseExpiredClaim(owner)
    await recoverCompletedTask(owner)
    const task = taskOf(owner)
    if (!task || !['queued', 'claimed', 'submitting', 'running'].includes(task.status)) return this.dispatch(id, { instruction })
    if (task.status === 'queued') {
      // Not yet submitted to Claude: the correction joins the request itself.
      await persistTask({ ...task, text: `${task.text}\n${instruction.trim()}` })
      return this.states()
    }
    pendingSteers.set(owner, addSteer(pendingSteers.get(owner) ?? null, { id, parentId: task.id, previous: task.text, said: instruction.trim() }))
    return this.states()
  },
})

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body)
}

async function readJson(request, maxBytes = 16384) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > maxBytes) throw new Error('Request body too large')
  }
  return JSON.parse(body || '{}')
}


const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/api/connections') {
      const port = server.address().port
      const origin = request.headers.origin
      if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return send(response, 403, { error: 'Origin not allowed' })
      send(response, 200, { connections: availableConnections() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const port = server.address().port
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) return send(response, 403, { error: 'Origin not allowed' })
      const body = await readJson(request)
      send(response, 200, { providers: await providerStore.save(body), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/provider-selection') {
      const port = server.address().port
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) return send(response, 403, { error: 'Origin not allowed' })
      const { id } = await readJson(request)
      settingsChanging()
      await providerStore.select(id)
      send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/voice-mode') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { mode } = await readJson(request)
      settingsChanging()
      await providerStore.selectVoiceMode(mode)
      send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/settings') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      await providerStore.savePipeline(await readJson(request))
      send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/key-status') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const provider = url.searchParams.get('provider')
      const slot = conversationProviders.some(item => item.id === provider)
        ? conversationCredentialSlot(provider, url.searchParams.get('baseUrl') || '') : provider
      send(response, 200, { configured: !!providerStore.pipelineCredential(slot) })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/key') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { provider, key, baseUrl } = await readJson(request)
      const slot = conversationProviders.some(item => item.id === provider)
        ? conversationCredentialSlot(provider, baseUrl || '') : provider
      await providerStore.savePipelineCredential(slot, key)
      send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/classifier/settings') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const changes = await readJson(request)
      settingsChanging()
      await providerStore.saveClassifier(changes)
      return send(response, 200, { providers: providerStore.publicSettings(), selectedProvider: providerStore.selectedProvider(),
        voiceMode: providerStore.voiceMode(), pipeline: providerStore.pipeline(), classifier: providerStore.classifier() })
    }
    if (request.method === 'GET' && url.pathname === '/api/classifier/key-status') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      return send(response, 200, { configured: !!providerStore.classifierCredential(url.searchParams.get('provider')) })
    }
    if (request.method === 'POST' && url.pathname === '/api/classifier/key') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { provider, key } = await readJson(request)
      if (provider !== 'jev') return send(response, 400, { error: 'Unsupported classifier key provider' })
      return send(response, 200, await providerStore.saveClassifierCredential(key))
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/options') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const options = {
        'conversation-provider': conversationProviders.map(({ id, label }) => ({ id, label })),
      }
      const kind = url.searchParams.get('kind')
      if (kind === 'stt-engine' || kind === 'tts-engine') return send(response, 200, { options: await listPipelineEngines(kind === 'stt-engine' ? 'stt' : 'tts', localVoice) })
      if (['stt-model', 'tts-model', 'conversation-model'].includes(kind)) {
        const engine = url.searchParams.get('engine') || (kind === 'stt-model' ? providerStore.pipeline().sttEngine
          : kind === 'tts-model' ? providerStore.pipeline().ttsEngine : 'openai')
        if (kind === 'conversation-model') {
          const selected = providerStore.pipeline()
          const baseUrl = url.searchParams.get('baseUrl') ?? selected.conversationalBaseUrl
          try {
            const slot = conversationCredentialSlot(engine, baseUrl)
            const options = await listConversationModels(engine, baseUrl,
              providerStore.pipelineCredential(slot), AbortSignal.timeout(20000))
            return send(response, 200, { options })
          } catch { return send(response, 200, { options: [] }) }
        }
        if (kind === 'stt-model' && ['vosk', 'parakeet'].includes(engine)) {
          const models = (await localVoice.models()).filter(model => model.kind === 'stt' && (model.engine ?? 'vosk') === engine)
          return send(response, 200, { options: models.map(model => ({ id: model.id, label: model.name })) })
        }
        if (kind === 'stt-model' && engine === 'deepgram-flux') {
          try { return send(response, 200, { options: (await listDeepgramFluxCatalog(AbortSignal.timeout(20000))).sttModels }) }
          catch { return send(response, 502, { error: 'Could not load Deepgram Flux models' }) }
        }
        if (kind === 'tts-model' && engine === 'deepgram') {
          try { return send(response, 200, { options: (await listDeepgramFluxCatalog(AbortSignal.timeout(20000))).ttsModels }) }
          catch { return send(response, 502, { error: 'Could not load Deepgram Flux TTS models' }) }
        }
        if (kind === 'tts-model' && engine === 'kokoro') {
          const models = (await localVoice.models()).filter(model => model.kind === 'tts')
          return send(response, 200, { options: models.map(model => ({ id: model.id, label: model.name })) })
        }
        if (kind !== 'conversation-model' && !['openai', 'gemini'].includes(engine)) {
          return send(response, 200, { options: [{ id: '', label: 'Provider default' }] })
        }
        const key = pipelineKey(engine)
        if (!key) return send(response, 200, { options: [] })
        try {
          const signal = AbortSignal.timeout(20000)
          const models = engine === 'gemini' ? await listGeminiSpeechModels(key, kind === 'stt-model' ? 'stt' : 'tts', signal)
              : await listOpenaiSpeechModels(key, kind === 'stt-model' ? 'stt' : 'tts', signal)
          return send(response, 200, { options: models.map(id => ({ id, label: id })) })
        } catch { return send(response, 502, { error: 'Could not load pipeline models' }) }
      }
      if (!Object.hasOwn(options, kind)) return send(response, 400, { error: 'Unknown pipeline option' })
      send(response, 200, { options: options[kind] })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/local-models') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      return send(response, 200, { models: (await localVoice.models()).map(({ id, kind, name, languages, engine, voices }) =>
        ({ id, kind, name, languages, engine, voices })) })
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/local-install-status') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      return send(response, 200, localInstaller.status())
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/local-install-size') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      return send(response, 200, { bytes: await localInstaller.size(await readJson(request)) })
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/local-install') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      localInstaller.start(await readJson(request))
      return send(response, 202, localInstaller.status())
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/voices') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const selected = providerStore.pipeline()
      if (selected.ttsEngine === 'kokoro') {
        const models = (await localVoice.models()).filter(model => model.kind === 'tts' && (!selected.ttsModel || model.id === selected.ttsModel))
        const voices = models.flatMap(model => model.voices.map(voice => ({ ...voice, id: `${model.id}:${voice.id}`,
          description: `${model.name} · ${voice.languages.join(', ')}` })))
        return send(response, 200, { voices, source: 'documentation', sourceUrl: models[0]?.sourceUrl || 'https://k2-fsa.github.io/sherpa/onnx/tts/',
          fetchedAt: new Date().toISOString() })
      }
      if (selected.ttsEngine === 'deepgram') {
        try { return send(response, 200, (await listDeepgramFluxCatalog(AbortSignal.timeout(20000))).voices) }
        catch { return send(response, 502, { error: 'Could not load Deepgram Flux voices' }) }
      }
      const key = pipelineKey(selected.ttsEngine)
      if (!key) return send(response, 409, { error: 'Configure the synthesis provider first' })
      try { send(response, 200, await discoverVoices({ provider: pipelineKeyProvider(selected.ttsEngine), key,
        mode: 'tts', model: selected.ttsModel }, AbortSignal.timeout(20000), 8 * 1024 * 1024)) }
      catch { send(response, 502, { error: 'Could not load pipeline voices' }) }
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const id = url.searchParams.get('provider')
      if (!['openai-live', 'openai', 'xai', 'gemini'].includes(id)) return send(response, 400, { error: 'Unsupported provider' })
      const { key, model } = providerStore.get(id)
      if (!key) return send(response, 409, { error: 'Apply a provider key first' })
      try {
        const signal = AbortSignal.timeout(20000)
        const [models, voices, backendModels] = await Promise.all([
          listStsModels({ provider: id, key }, signal).then(models => withXaiVoiceModels(id, models)),
          discoverVoices({ provider: id, key, mode: 'sts', model: url.searchParams.get('model') || model }, signal, 8 * 1024 * 1024),
          id === 'openai-live' ? listLiveBackendModels(key, signal) : Promise.resolve([]),
        ])
        send(response, 200, { models, ...voices, backendModels })
      } catch { send(response, 502, { error: 'Could not load Composer provider catalog' }) }
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/preview/keepalive') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { previewSessionId } = await readJson(request)
      if (typeof previewSessionId !== 'string' || !/^[\w-]{1,128}$/.test(previewSessionId))
        return send(response, 400, { error: 'Invalid preview session' })
      keepLivePreview(previewSessionId)
      send(response, 200, { alive: livePreviewSessions.has(previewSessionId) })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/preview/close') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { previewSessionId } = await readJson(request)
      if (typeof previewSessionId !== 'string' || !/^[\w-]{1,128}$/.test(previewSessionId))
        return send(response, 400, { error: 'Invalid preview session' })
      closeLivePreview(previewSessionId)
      send(response, 200, { closed: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/preview') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { voice, format, text, previewSessionId } = await readJson(request)
      if (typeof voice !== 'string' || !/^[\w.:-]{1,128}$/.test(voice)) return send(response, 400, { error: 'Invalid voice' })
      if (previewSessionId !== undefined && (typeof previewSessionId !== 'string' || !/^[\w-]{1,128}$/.test(previewSessionId)))
        return send(response, 400, { error: 'Invalid preview session' })
      if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 500)) return send(response, 400, { error: 'Invalid preview text' })
      const sampleText = text ?? 'Hello. This is a sample of my voice.'
      const id = providerStore.selectedProvider()
      const settings = providerStore.get(id)
      if (!settings.key || !settings.model) return send(response, 409, { error: 'Configure the voice provider first' })
      if (request.headers.accept?.includes('audio/l16')) {
        const abort = new AbortController()
        response.once('close', () => { if (!response.writableFinished) abort.abort() })
        await streamPcmPreview(response, async sink => {
          if (id === 'openai-live') {
            if (previewSessionId) await useLivePreview(previewSessionId, settings, voice, sampleText,
              abort.signal, pcm => sink(pcm, 24000))
            else await previewLive(settings.key, settings.model, voice, sampleText,
              abort.signal, 20000, 4 * 1024 * 1024, pcm => sink(pcm, 24000))
          } else await previewRealtime(id, settings, voice, sampleText, abort.signal, sink)
        }, abort.signal)
        return
      }
      try {
        const signal = AbortSignal.timeout(20000)
        const sample = id === 'openai-live'
          ? await previewLive(settings.key, settings.model, voice, sampleText, signal, 20000, 4 * 1024 * 1024)
          : await previewRealtime(id, settings, voice, sampleText, signal)
        send(response, 200, format === 'wav'
          ? { base64: pcm16ToWav(Buffer.from(sample.audio, 'base64'), sample.sampleRate).toString('base64'), mime: 'audio/wav' }
          : sample)
      } catch { send(response, 502, { error: 'Voice preview failed' }) }
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/preview') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      const { voice, text } = await readJson(request), selected = providerStore.pipeline()
      if (typeof voice !== 'string' || !/^[\w.:-]{1,128}$/.test(voice)) return send(response, 400, { error: 'Invalid voice' })
      if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 500)) return send(response, 400, { error: 'Invalid preview text' })
      const sampleText = text ?? 'Hello. This is a sample of my voice.'
      if (request.headers.accept?.includes('audio/l16')) {
        const abort = new AbortController()
        response.once('close', () => { if (!response.writableFinished) abort.abort() })
        await streamPcmPreview(response, sink => synthesizePipeline({
          engine: selected.ttsEngine, model: selected.ttsModel, voice,
          text: sampleText, key: () => pipelineKey(selected.ttsEngine),
          connect: connectPipelineProvider, local: localVoice,
        }, sink, abort.signal), abort.signal)
        return
      }
      const chunks = []
      let sampleRate = 0
      try {
        await synthesizePipeline({ engine: selected.ttsEngine, model: selected.ttsModel, voice,
          text: sampleText, key: () => pipelineKey(selected.ttsEngine),
          connect: connectPipelineProvider, local: localVoice }, (pcm, rate) => { chunks.push(Buffer.from(pcm)); sampleRate = rate }, AbortSignal.timeout(20000))
        send(response, 200, { audio: Buffer.concat(chunks).toString('base64'), sampleRate })
      } catch { send(response, 502, { error: 'Voice preview failed' }) }
      return
    }
    if (url.pathname.startsWith('/api/pipeline/') && request.headers.authorization !== `Bearer ${token}`) {
      return send(response, 401, { error: 'Unauthorized' })
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/speak') {
      if (providerStore.voiceMode() !== 'pipeline') return send(response, 409, { error: 'Pipeline mode is not selected' })
      const { text } = await readJson(request), selected = providerStore.pipeline()
      if (typeof text !== 'string' || !text.trim() || text.length > 32000) return send(response, 400, { error: 'Invalid speech text' })
      const abort = new AbortController()
      response.once('close', () => { if (!response.writableFinished) abort.abort() })
      try {
        await synthesizePipeline({ engine: selected.ttsEngine, model: selected.ttsModel, voice: selected.ttsVoice,
          text, key: () => pipelineKey(selected.ttsEngine), connect: connectPipelineProvider, local: localVoice }, (pcm, rate) => {
          if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'audio/l16', 'X-Voice-Sample-Rate': String(rate), 'Cache-Control': 'no-store' })
          response.write(pcm)
        }, abort.signal)
        if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'audio/l16', 'X-Voice-Sample-Rate': '24000' })
        response.end()
      } catch (error) {
        if (response.headersSent) response.destroy(error)
        else send(response, 502, { error: 'Speech synthesis failed' })
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/answer') {
      if (providerStore.voiceMode() !== 'pipeline') return send(response, 409, { error: 'Pipeline mode is not selected' })
      const body = await readJson(request, 128 * 1024), selected = providerStore.pipeline()
      if (!conversationReady(selected)) return send(response, 409, { error: 'Configure the conversation provider first' })
      const abort = new AbortController()
      response.once('close', () => { if (!response.writableFinished) abort.abort() })
      try {
        const upstream = await requestPipelineConversation({ provider: selected.conversationalProvider,
          baseUrl: selected.conversationalBaseUrl, model: selected.conversationalModel, key: conversationKey(selected), body, signal: abort.signal })
        if (!upstream.ok || !upstream.body) return send(response, 502, { error: 'Conversation provider failed' })
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
        for await (const chunk of upstream.body) response.write(chunk)
        response.end()
      } catch (error) {
        if (response.headersSent) response.destroy(error)
        else send(response, 502, { error: 'Conversation provider failed' })
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/classify') {
      if (providerStore.voiceMode() !== 'pipeline' || !providerStore.classifier().enabled)
        return send(response, 409, { error: 'Classifier is not enabled' })
      const { utterance, context } = await readJson(request)
      try {
        const route = await classifyForVoice(providerStore, utterance, context, AbortSignal.timeout(15000))
        return send(response, 200, { route })
      } catch { return send(response, 502, { error: 'Classification failed' }) }
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/conversation-test') {
      const selected = providerStore.pipeline()
      if (!selected.conversationalModel || !conversationReady(selected)) return send(response, 409, { ready: false, error: 'Configure the conversation provider first' })
      try {
        const upstream = await requestPipelineConversation({ provider: selected.conversationalProvider,
          baseUrl: selected.conversationalBaseUrl, model: selected.conversationalModel, key: conversationKey(selected),
          body: { messages: [{ role: 'user', content: 'Reply with OK.' }] }, signal: AbortSignal.timeout(20000) })
        if (!upstream.ok || !upstream.body) return send(response, 502, { ready: false, error: `Conversation provider HTTP ${upstream.status}` })
        const reader = upstream.body.getReader()
        const first = await reader.read()
        await reader.cancel()
        return send(response, first.done || !first.value?.length ? 502 : 200,
          { ready: !first.done && !!first.value?.length, ...(first.done ? { error: 'No conversation response' } : {}) })
      } catch { return send(response, 502, { ready: false, error: 'Conversation provider test failed' }) }
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/dispatch') {
      if (providerStore.voiceMode() !== 'pipeline') return send(response, 409, { error: 'Pipeline mode is not selected' })
      const owner = sessions.selected(), { instruction } = await readJson(request)
      if (!owner || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000) return send(response, 400, { error: 'Invalid coding request' })
      const admitted = await liveTasksFor(owner).dispatch(randomUUID(), { instruction })
      await transcriptLedger.recordCodingRoute(owner, admitted.requestId, instruction, true)
      send(response, 200, admitted)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/pipeline/owed') {
      const owner = sessions.selected()
      send(response, 200, { result: owner ? resultLedger.owed(owner)[0] ?? null : null })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/played') {
      const owner = sessions.selected(), { playbackId } = await readJson(request)
      if (!owner || !Number.isSafeInteger(playbackId) || playbackId < 1) return send(response, 400, { error: 'Invalid playback' })
      send(response, 200, { played: await resultLedger.markPlayed(playbackId, owner) })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/pipeline/exchange') {
      const owner = sessions.selected(), { role, text, id, phase } = await readJson(request)
      if (!owner || !['user','assistant'].includes(role) || typeof text !== 'string' || !text.trim() || text.length > 4000) return send(response, 400, { error: 'Invalid voice exchange' })
      if (phase !== undefined && !['start', 'update', 'final'].includes(phase)) return send(response, 400, { error: 'Invalid voice exchange phase' })
      await transcriptLedger.record(owner, { id: typeof id === 'string' && id.length <= 128 ? id : randomUUID(), role, text, phase: phase ?? 'final' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/diagnostics/connection') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      if (!['idle', 'offline', 'standby', 'error', 'needs-activation'].includes(mediaState.phase)) return send(response, 409, { error: 'Stop Voice before checking the connection' })
      const id = providerStore.selectedProvider()
      const settings = providerStore.get(id)
      if (!settings.key || !settings.model || !settings.voice) return send(response, 409, { error: 'Configure the voice provider first' })
      send(response, 200, { ready: await probeRealtimeConnection(id, settings) })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/diagnostics/audio-tools') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      if (!['idle', 'offline', 'standby', 'error', 'needs-activation'].includes(mediaState.phase)) return send(response, 409, { error: 'Stop Voice before running the audio and tools test' })
      const id = providerStore.selectedProvider()
      const settings = providerStore.get(id)
      if (!settings.key || !settings.model || !settings.voice) return send(response, 409, { error: 'Configure the voice provider first' })
      try { send(response, 200, { ready: await probeRealtimeAudioTools(id, settings) }) }
      catch { send(response, 502, { error: 'Audio and tools test failed' }) }
      return
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { Location: '/media/' })
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      send(response, 200, { token, cursor: sequence, testAudio: !!process.env.VOICE_MEDIA_AUDIO_FILE })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/test-audio' && process.env.VOICE_MEDIA_AUDIO_FILE) {
      send(response, 200, await readFile(process.env.VOICE_MEDIA_AUDIO_FILE), 'audio/wav')
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
      const requested = url.pathname === '/media/' ? 'index.html' : decodeURIComponent(url.pathname.slice('/media/'.length))
      const file = resolve(dist, requested)
      if (file !== dist && !file.startsWith(dist + sep)) return send(response, 403, { error: 'Forbidden' })
      try {
        const content = await readFile(file)
        send(response, 200, content, types[extname(file)] ?? 'application/octet-stream')
      } catch {
        send(response, 404, { error: 'Media page not built; run npm run media:build' })
      }
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/setup/')) {
      const requested = url.pathname === '/setup/' ? 'index.html' : decodeURIComponent(url.pathname.slice('/setup/'.length))
      const file = resolve(setupRoot, requested)
      if (file !== setupRoot && !file.startsWith(setupRoot + sep)) return send(response, 403, { error: 'Forbidden' })
      try { send(response, 200, await readFile(file), types[extname(file)] ?? 'application/octet-stream') }
      catch { send(response, 404, { error: 'Setup page unavailable' }) }
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
    if (url.pathname === '/api/display' && request.method === 'GET') {
      try { return send(response, 200, { chatBubbles: JSON.parse(await readFile(displayFile, 'utf8')).chatBubbles === true }) }
      catch { return send(response, 200, { chatBubbles: false }) }
    }
    if (url.pathname === '/api/display' && request.method === 'POST') {
      const { chatBubbles } = await readJson(request)
      if (typeof chatBubbles !== 'boolean') return send(response, 400, { error: 'chatBubbles must be a boolean' })
      await mkdir(dirname(displayFile), { recursive: true })
      await writeFile(displayFile, JSON.stringify({ chatBubbles }), { mode: 0o600 })
      return send(response, 200, { chatBubbles })
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const selected = sessions.selected()
      send(response, 200, { ...mediaState, theme: await claudeDesktopTheme(), locale: await claudeDesktopLocale(), mediaConnected: Date.now() - mediaSeenAt < 2500,
        voiceConfigured: availableConnections().length > 0,
        classifierEnabled: providerStore.classifier?.().enabled === true,
        captionRevision: selected ? transcriptLedger.revision(selected) : 0, sequence,
        selectedSession: selected, waitingResults: sessions.waiting(resultLedger.owedSessions())
          .map(result => ({ ...result, finishedAt: finishedAway.get(result.sessionId)?.at ?? 0,
            title: finishedAway.get(result.sessionId)?.title ?? '' })) })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/captions') {
      const requestedSession = url.searchParams.get('sessionId')
      if (!requestedSession) return send(response, 400, { error: 'Missing session' })
      sessions.seen(requestedSession)
      send(response, 200, { revision: transcriptLedger.revision(requestedSession), rows: transcriptLedger.rows(requestedSession),
        turns: transcriptLedger.turns(requestedSession) })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/claude/status') {
      await releaseExpiredClaim(sessions.selected())
      await recoverCompletedTask(sessions.selected())
      send(response, 200, { sessionConnected: !!sessions.selected(), taskStatus: taskOf(sessions.selected())?.status ?? null })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/claude/diagnostics') {
      const selected = sessions.selected()
      await recoverCompletedTask(selected)
      const task = taskOf(selected)
      // A running task may be healthy. Offer recovery only after it has stayed
      // unresolved long enough to be plausibly stuck.
      const stuck = task?.status === 'running' && !!task.turnId
        && Number.isSafeInteger(task.claimedAt) && Date.now() - task.claimedAt >= 5 * 60_000
      return send(response, 200, { sessionId: selected, clientSynced: selected ? recoveredClients.has(selected) : null,
        stuck: !!stuck, task: task ? {
        id: task.id, turnId: task.turnId, status: task.status, request: task.text.slice(0, 300),
        recoveryEvidence: task.recoveryEvidence ?? null, canRelease: task.status === 'running' && !!task.turnId,
      } : null })
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/release') {
      const { sessionId, id, turnId, confirmRelease } = await readJson(request)
      const task = taskOf(sessionId)
      if (!task || confirmRelease !== true || sessionId !== sessions.selected() || task.id !== id
        || task.turnId !== turnId || task.status !== 'running') {
        return send(response, 409, { error: 'The selected voice task changed or release was not confirmed' })
      }
      if (!await finishClaudeTask(task, 'aborted', '', 'manual-release')) return send(response, 409, { error: 'Voice task changed during release' })
      return send(response, 200, { ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/api/voice/standby') {
      const selected = sessions.selected()
      await releaseExpiredClaim(selected)
      send(response, 200, { taskActive: ['queued', 'claimed', 'submitting', 'running'].includes(taskOf(selected)?.status),
        owedTurn: selected ? resultLedger.owed(selected)[0]?.playbackId ?? null : null })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/setup-dialog') {
      await readJson(request)
      const params = new URLSearchParams({ theme: await claudeDesktopTheme(), locale: await claudeDesktopLocale() })
      const page = `http://localhost:${server.address().port}/setup/?${params}`
      await openSettingsWindow(page, { onClosed: settingsClosed })
      send(response, 200, { ok: true })
      return
    }
    // The Mod's own settings pane closed (the desktop window reports its own close).
    if (request.method === 'POST' && url.pathname === '/api/settings/closed') {
      if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: 'Unauthorized' })
      settingsClosed()
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && ['/api/claude/select', '/api/claude/session'].includes(url.pathname)) {
      const { sessionId, cwd } = await readJson(request)
      if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256) return send(response, 400, { error: 'Invalid session' })
      const previous = sessions.selected()
      const changed = sessions.select(sessionId, typeof cwd === 'string' ? cwd.slice(0, 4096) : undefined)
      if (changed) switchVoice(previous)
      send(response, 200, { ok: true, changed })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/request') {
      const { id, text, mode, sessionId: bodySession } = await readJson(request)
      if (typeof id !== 'string' || id.length < 1 || id.length > 128 || typeof text !== 'string' || !text.trim() || text.length > 16000 || !['review', 'submit'].includes(mode)) {
        return send(response, 400, { error: 'Invalid voice request' })
      }
      const sessionId = typeof bodySession === 'string' && bodySession ? bodySession : sessions.selected()
      if (!sessionId) return send(response, 409, { error: 'No Claude session connected' })
      await releaseExpiredClaim(sessionId)
      const current = taskOf(sessionId)
      if (current?.id === id) return send(response, 200, { id, status: current.status })
      if (resultLedger.owed(sessionId).length) return send(response, 409, { error: 'A previous Claude result is waiting to be spoken' })
      if (active(current)) return send(response, 409, { error: 'A Claude request is already active' })
      const playbackId = await resultLedger.allocate()
      await persistTask({ id, text, mode, status: 'queued', sessionId, turnId: null, result: null, playbackId })
      await transcriptLedger.markDelegated(sessionId, text).catch(() => {})
      send(response, 202, { id, status: 'queued' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/claude/request') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) return send(response, 400, { error: 'Missing session' })
      if (url.searchParams.get('recoveryProtocol') === '2') recoveredClients.add(sessionId)
      sessions.seen(sessionId)
      await releaseExpiredClaim(sessionId)
      await recoverCompletedTask(sessionId)
      const claudeTask = taskOf(sessionId)
      if (providerStore.voiceMode() === 'pipeline' && claudeTask?.mode === 'submit'
        && ['queued', 'claimed'].includes(claudeTask.status)) {
        await transcriptLedger.recordCodingRoute(sessionId, claudeTask.id, claudeTask.text)
      }
      const recoverable = ['queued', 'claimed', 'submitting', 'running'].includes(claudeTask?.status)
      send(response, 200, { task: recoverable ? {
        id: claudeTask.id, text: claudeTask.text, mode: claudeTask.mode,
        status: claudeTask.status, turnId: claudeTask.turnId, submissionState: claudeTask.submissionState,
      } : null })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/claude/steer') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) return send(response, 400, { error: 'Missing session' })
      sessions.seen(sessionId)
      await recoverCompletedTask(sessionId)
      const steer = pendingSteers.get(sessionId)
      send(response, 200, { steer: steer ? { parentId: steer.parentId, kind: steer.kind,
        notes: steer.notes.map(note => ({ id: note.id, text: steerNote(note.text) })) } : null })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/steer/delivered') {
      const { sessionId, parentId, ids } = await readJson(request)
      const steer = typeof sessionId === 'string' ? pendingSteers.get(sessionId) : undefined
      if (steer?.parentId !== parentId || !Array.isArray(ids)) return send(response, 409, { error: 'No steer pending for that request' })
      // Claude read these after a tool result; only what it has not read becomes the next request.
      const notes = steer.notes.filter(note => !ids.includes(note.id))
      if (notes.length || steer.kind === 'stop') pendingSteers.set(sessionId, { ...steer, notes })
      else pendingSteers.delete(sessionId)
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/claim') {
      const { id, sessionId } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || claudeTask.sessionId !== sessionId || claudeTask.status !== 'queued') return send(response, 409, { error: 'Voice request is not queued' })
      // A claimed request is never replayed after an ambiguous submission.
      await persistTask({ ...claudeTask, status: 'claimed', claimedAt: Date.now(), submissionState: 'not-started' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/submitting') {
      const { id, sessionId } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || claudeTask.status !== 'claimed'
        || claudeTask.submissionState !== 'not-started') return send(response, 409, { error: 'Voice request is not awaiting submission' })
      await persistTask({ ...claudeTask, status: 'submitting', submissionState: 'started' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/claim-failed') {
      const { id, sessionId } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || !['claimed', 'submitting'].includes(claudeTask.status)) {
        return send(response, 409, { error: 'Voice request is not awaiting a turn' })
      }
      // After reload, only a claim explicitly marked not-started is safe to fail immediately.
      // A failed submit call may also be reported while the caller still owns that attempt.
      if (claudeTask.submissionState !== 'not-started' && !unstartedClaimExpired(claudeTask)) {
        return send(response, 409, { error: 'Submission outcome is not known' })
      }
      await persistTask({ ...claudeTask, status: 'failed', result: 'Voice handoff did not start. Please try the request.' })
      pendingSteers.delete(sessionId)
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/reviewed') {
      const { id, sessionId } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || claudeTask.sessionId !== sessionId || claudeTask.status !== 'claimed' || claudeTask.mode !== 'review') return send(response, 409, { error: 'Voice request is not awaiting review' })
      await persistTask({ ...claudeTask, status: 'reviewed' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/started') {
      const { id, sessionId, turnId } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || claudeTask.sessionId !== sessionId || !['claimed', 'submitting'].includes(claudeTask.status) || typeof turnId !== 'string' || !turnId) return send(response, 409, { error: 'Voice request was not claimed' })
      await persistTask({ ...claudeTask, turnId, status: 'running' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/milestone') {
      const { id, sessionId, turnId, step, text } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      if (!claudeTask || claudeTask.id !== id || claudeTask.sessionId !== sessionId
        || claudeTask.turnId !== turnId || claudeTask.status !== 'running'
        || !Number.isSafeInteger(step) || step < 0 || step > 10000
        || typeof text !== 'string' || !text.trim() || text.length > 1000) {
        return send(response, 409, { error: 'Coding milestone does not match the running turn' })
      }
      if (providerStore.get(providerStore.selectedProvider()).progressMode !== 'milestones') return send(response, 200, { accepted: false })
      if (milestoneTaskId !== id) { milestoneTaskId = id; milestoneSteps.clear() }
      if (milestoneSteps.has(step) || milestoneSteps.size >= 256) return send(response, 200, { accepted: false })
      milestoneSteps.add(step)
      const current = () => taskOf(sessionId)?.id === id && taskOf(sessionId).status === 'running' && sessions.selected() === sessionId
      const accepted = await activeLive?.milestone?.(text.trim(), current) === true
      if (!accepted) milestoneSteps.delete(step)
      send(response, 200, { accepted })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/claude/result') {
      const { id, sessionId, turnId, status, text } = await readJson(request)
      const claudeTask = typeof sessionId === 'string' ? taskOf(sessionId) : null
      const savedResult = resultLedger.find(id, sessionId)
      if (claudeTask && claudeTask.id === id && claudeTask.turnId === turnId && typeof text === 'string'
        && ((claudeTask.status === status && claudeTask.result === text.slice(0, 16000)) || claudeTask.recoveryEvidence === 'manual-release')
        && ['complete', 'aborted', 'failed'].includes(claudeTask.status)) {
        return send(response, 200, { ok: true, alreadyRecorded: true })
      }
      if (savedResult && typeof text === 'string' && savedResult.turnId === turnId
        && ((savedResult.status === status && (savedResult.text === text.slice(0, 16000) || savedResult.recoveryEvidence === 'claude-transcript-completion'))
          || savedResult.recoveryEvidence === 'manual-release')) {
        return send(response, 200, { ok: true, alreadyRecorded: true })
      }
      if (!claudeTask || claudeTask.id !== id || claudeTask.sessionId !== sessionId || claudeTask.turnId !== turnId || claudeTask.status !== 'running' || !['complete', 'aborted', 'failed'].includes(status) || typeof text !== 'string') {
        return send(response, 409, { error: 'Voice request result did not match the running turn' })
      }
      if (!await finishClaudeTask(claudeTask, status, text)) return send(response, 409, { error: 'Voice request changed while recording its result' })
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/claude/result') {
      const task = taskLedger.all().find(item => item.id === url.searchParams.get('id'))
      if (!task) return send(response, 404, { error: 'Voice request not found' })
      send(response, 200, { id: task.id, status: task.status, text: task.result })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/media-state') {
      const next = await readJson(request)
      if (typeof next.phase !== 'string' || typeof next.muted !== 'boolean' || typeof next.level !== 'number') {
        return send(response, 400, { error: 'Invalid media state' })
      }
      mediaState = {
        phase: next.phase, muted: next.muted, speakerMuted: next.speakerMuted === true,
        activeSeconds: Number.isFinite(next.activeSeconds) ? Math.max(0, Math.floor(next.activeSeconds)) : 0,
        level: Math.max(0, Math.min(1, next.level)),
        error: typeof next.error === 'string' ? next.error.slice(0, 500) : null,
        transcript: typeof next.transcript === 'string' ? next.transcript.slice(0, 4000) : '',
        lastReply: typeof next.lastReply === 'string' ? next.lastReply.slice(0, 4000) : '',
        transcriptId: typeof next.transcriptId === 'string' ? next.transcriptId.slice(0, 128) : '',
        lastReplyId: typeof next.lastReplyId === 'string' ? next.lastReplyId.slice(0, 128) : '',
        inputLevels: Array.isArray(next.inputLevels) ? next.inputLevels.slice(0, 9).map(value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0) : [],
        outputLevels: Array.isArray(next.outputLevels) ? next.outputLevels.slice(0, 9).map(value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0) : [],
        assistantOrbEnabled: next.assistantOrbEnabled !== false,
      }
      mediaSeenAt = Date.now()
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/control') {
      const { action } = await readJson(request)
      if (!['start', 'stop', 'mute', 'speaker-mute', 'speaker-test', 'chime'].includes(action)) return send(response, 400, { error: 'Unknown control' })
      if (Date.now() - mediaSeenAt >= 2500) {
        return send(response, 409, { error: 'Composer runtime is not connected' })
      }
      // Starting or stopping by hand sets the selected session's own voice state.
      if (['start', 'stop'].includes(action) && sessions.selected()) voiceOn.set(sessions.selected(), action === 'start')
      const command = { id: ++sequence, action }
      commands.push(command)
      if (commands.length > 64) commands.shift()
      send(response, 200, command)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/commands') {
      const after = Number(url.searchParams.get('after') ?? 0)
      if (!Number.isSafeInteger(after) || after < 0) return send(response, 400, { error: 'Invalid cursor' })
      mediaSeenAt = Date.now()
      send(response, 200, { commands: commands.filter(command => command.id > after) })
      return
    }
    send(response, 404, { error: 'Not found' })
  } catch (error) {
    send(response, error instanceof SyntaxError ? 400 : 500, { error: error instanceof Error ? error.message : 'Host error' })
  }
})

const voiceSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
const pipelineSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
// Each session keeps its own voice state. On a switch, the session left remembers whether its voice
// was on, its conversation ends, and the voice comes back on only if the selected session had it on;
// starting there loads that session's history and replays what it is owed (voice-server.js).
const VOICE_ON = ['connecting', 'listening', 'speaking', 'thinking', 'standby']
const voiceOn = new Map()
// Sockets of a session switched away from. The page closes them when it takes the quiet stop; until then they
// neither count as voice being on nor block the next session's socket.
const retiring = new WeakSet()
const liveSockets = server => [...server.clients].filter(socket => !retiring.has(socket)).length
function closeRetiring(server) {
  for (const socket of server.clients) if (retiring.has(socket)) socket.close()
}

// Hands the page's open sockets over to a quiet stop: the page closes them itself when it takes the stop;
// any it has not closed in two seconds are closed then.
function retireSockets() {
  for (const socket of [...voiceSockets.clients, ...pipelineSockets.clients]) {
    retiring.add(socket)
    setTimeout(() => { if (socket.readyState === socket.OPEN) socket.close() }, 2000).unref()
  }
}

// A provider, mode or classifier change made while voice runs takes effect on the next connection. Settings
// are saved as they change, and the voice reconnects once when settings close, not once per change, and only
// when those values differ from what they were before the first save: opening settings to look, re-saving a
// value, or changing one and changing it back reconnects nothing.
const VOICE_LIVE = ['connecting', 'listening', 'speaking', 'thinking']
const connectionSettings = () => JSON.stringify({ provider: providerStore.selectedProvider(), mode: providerStore.voiceMode(), classifier: providerStore.classifier() })
let settingsBefore = null
function settingsChanging() {
  if (settingsBefore === null && VOICE_LIVE.includes(mediaState.phase)) settingsBefore = connectionSettings()
}
function settingsClosed() {
  const before = settingsBefore
  settingsBefore = null
  if (before === null || before === connectionSettings() || !VOICE_LIVE.includes(mediaState.phase)) return
  retireSockets()
  for (const action of ['stop', 'start']) commands.push({ id: ++sequence, action, quiet: true })
  while (commands.length > 64) commands.shift()
}

function switchVoice(previous) {
  const wasOn = VOICE_ON.includes(mediaState.phase) || liveSockets(voiceSockets) > 0 || liveSockets(pipelineSockets) > 0
  if (previous) voiceOn.set(previous, wasOn)
  // Quiet: a switch only resumes or pauses a session's voice, so the page plays no connection chime.
  const queue = action => {
    commands.push({ id: ++sequence, action, quiet: true })
    while (commands.length > 64) commands.shift()
  }
  if (wasOn) {
    // Closing the page's sockets here made it report a failed connection before the stop reached it.
    retireSockets()
    queue('stop')
  }
  if (voiceOn.get(sessions.selected()) === true) queue('start')
}

server.on('upgrade', (request, socket, head) => {
  const port = server.address().port
  if (request.url === '/pipeline/stt') {
    if (providerStore.voiceMode() !== 'pipeline' || liveSockets(pipelineSockets) > 0 || !pipelineReady()
      || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) {
      socket.destroy(); return
    }
    const selected = providerStore.pipeline()
    const recognizer = createPipelineRecognizer(selected.sttEngine, selected.sttModel, connectPipelineProvider,
      () => pipelineKey(selected.sttEngine), localVoice)
    if (!recognizer || !('turnStream' in recognizer)) { socket.destroy(); return }
    closeRetiring(pipelineSockets)
    pipelineSockets.handleUpgrade(request, socket, head, ws => attachPipelineSttSession(ws, recognizer))
    return
  }
  if (request.url !== '/voice' || providerStore.voiceMode() !== 'sts' || liveSockets(voiceSockets) > 0 || !configuredConnections(providerStore).length || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) {
    socket.destroy()
    return
  }
  const owner = sessions.selected()
  const conversationId = randomUUID()
  const liveTasks = liveTasksFor(owner)
  const socketTasks = {
    ...liveTasks,
    dispatch(id, input, signal) {
      if (!owner || owner !== sessions.selected()) throw new Error('Claude voice session changed')
      return liveTasks.dispatch(scopedVoiceId('request', owner, conversationId, id), input, signal)
    },
    steer(id, input, signal) {
      if (!owner || owner !== sessions.selected()) throw new Error('Claude voice session changed')
      return liveTasks.steer(scopedVoiceId('request', owner, conversationId, id), input, signal)
    },
    states: () => owner && owner === sessions.selected() ? liveTasks.states() : [],
    owed: () => owner ? resultLedger.owed(owner) : [],
    lastOutput: () => owner ? resultLedger.latest(owner) : null,
    played: playbackId => owner ? resultLedger.markPlayed(playbackId, owner) : Promise.resolve(false),
  }
  const onCaption = async caption => {
    if (!owner) return
    const delegatedText = active(taskOf(owner)) ? taskOf(owner).text : ''
    await transcriptLedger.record(owner, { ...caption, conversationId,
      id: scopedVoiceId('caption', owner, conversationId, caption.id) }, delegatedText)
  }
  const history = () => owner ? transcriptLedger.history(owner) : []
  // GPT Live's spoken turns, each routed to voice or to Claude: recorded as the routing actually resolves,
  // so the Mod can hold a turn's captions until then and pair a coding turn with its exact request.
  const turnId = id => scopedVoiceId('turn', owner, conversationId, id)
  const turns = {
    open: (id, offsetAt) => owner ? transcriptLedger.openTurn(owner, turnId(id), offsetAt, conversationId) : undefined,
    async settle(id, outcome) {
      if (!owner) return
      const turn = await transcriptLedger.settleTurn(owner, turnId(id), outcome)
      if (turn) console.info(`Voice turn ${turn.state}${turn.mode ? ` (${turn.mode})` : ''} ${turn.id.slice(5, 17)}`
        + `${turn.requestId ? ` request ${turn.requestId.slice(8, 20)}` : ''} captions ${turn.userCaptionIds.length}`)
    },
    close: () => owner ? transcriptLedger.closeTurns(owner) : undefined,
  }
  closeRetiring(voiceSockets)
  voiceSockets.handleUpgrade(request, socket, head, ws => providerStore.selectedProvider() === 'openai-live'
    ? attachVoice(ws, providerStore, socketTasks, live => { activeLive = live }, onCaption, history, turns)
    : attachRealtimeVoice(ws, providerStore, socketTasks, live => { activeLive = live }, onCaption, history, { turns }))
})

const listenPort = Number(process.env.VOICE_HOST_PORT ?? 61445)
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error('VOICE_HOST_PORT must be a valid TCP port')
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(listenPort, '127.0.0.1', resolveListen)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Could not determine host address')
await mkdir(dirname(connectionFile), { recursive: true })
await writeFile(connectionFile, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token }), { mode: 0o600 })
console.log(`VoiceMesh media host: http://127.0.0.1:${address.port}/media/`)
const mediaWorker = await startBackgroundMedia(`http://127.0.0.1:${address.port}/media/`)

async function shutdown() {
  mediaWorker.stop()
  for (const socket of voiceSockets.clients) socket.close()
  for (const socket of pipelineSockets.clients) socket.close()
  server.close()
  await Promise.all([localInstaller.dispose(), localVoice.dispose()])
  await unlink(connectionFile).catch(() => {})
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
