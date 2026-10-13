/** Local signaling adapter around Composer's GPT Live provider and delegation. */
import { WebSocket } from 'ws'
import { LiveDelegation } from '@voicemesh/composer'
import { openaiLiveProvider, openaiStsProvider, xaiStsProvider, geminiStsProvider, openStsChannel } from '@voicemesh/composer/server'
import { latestLiveUserRequest } from './live-task-instruction.js'
import { liveInstructions } from './voice-policy.js'
import { claudeUserName } from './claude-user.js'
import { classifyForVoice } from './classifier.js'

export function liveClassification(store, classify = classifyForVoice) {
  if (store.classifier?.().enabled !== true) return undefined
  return {
    classify: (utterance, context, signal) => classify(store, utterance, context, signal),
    voice: 'The enabled request classifier succeeded for this turn and routed it to voice. It is working. No coding task was started. Answer the latest user request yourself. Do not delegate this same utterance again; continue listening afterward.',
    clarify: 'The enabled request classifier succeeded for this turn and requested clarification. It is working. No coding task was started. Ask the user one concise clarifying question. Do not delegate this same utterance again; continue listening afterward.',
    unavailable: 'The request classifier is unavailable, so I have not sent this request to Claude. Turn classification off in Voice Settings to use the usual routing.',
  }
}

export function configuredConnections(store) {
  const id = store.selectedProvider?.() ?? 'openai-live'
  const provider = { 'openai-live': openaiLiveProvider, openai: openaiStsProvider, xai: xaiStsProvider, gemini: geminiStsProvider }[id]
  if (!provider) return []
  const { key, model, voice, voiceStandbySec, statusSounds, assistantOrbEnabled } = store.get(id)
  return key && model && voice ? [{
    id, name: { 'openai-live': 'GPT Live', openai: 'OpenAI Realtime', xai: 'xAI Grok', gemini: 'Gemini Live' }[id],
    model, voice, voiceStandbySec, statusSounds, assistantOrbEnabled,
    transport: provider.webrtc ? 'webrtc' : 'websocket',
    inputSampleRate: provider.inputSampleRate,
    outputSampleRate: provider.outputSampleRate,
  }] : []
}

/**
 * When each caption was spoken. GPT Live stamps every piece of speech, the user's and the voice's, on one
 * session clock (`start_ms`); history is ordered by it, not by when a transcript happened to arrive. A
 * caption is as early as its earliest piece.
 */
export function speechClock(now = Date.now) {
  let base = 0
  const spokenAt = new Map()
  return {
    start() { base = now() },
    /** A moment on the session clock (a delegation's `offset`), on the same scale as `stamp`. */
    at(ms) { return Number.isFinite(ms) ? base + ms : undefined },
    stamp(id, startMs) {
      if (Number.isFinite(startMs)) spokenAt.set(id, Math.min(spokenAt.get(id) ?? Infinity, base + startMs))
      return spokenAt.get(id)
    },
  }
}

/**
 * Whether the voice is audibly speaking, as the page measures it from the playing audio, with a wait
 * for it to fall silent. `release` frees every waiter when the connection closes.
 */
export function quietGate() {
  let speaking = false
  const waiters = []
  return {
    set(value) { speaking = value; if (!speaking) for (const wake of waiters.splice(0)) wake() },
    release() { for (const wake of waiters.splice(0)) wake() },
    wait() { return speaking ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve() },
  }
}

/**
 * A note sent to GPT Live while it speaks makes it drop the rest of its line: the hand-off notice
 * ("the coding request was admitted") arriving mid-"Checking" cut it to "Check—". Notes wait until the
 * voice falls silent; its own speech and everything else go straight through.
 */
export function quietNotes(send, quiet) {
  return async (message, eligible) => {
    if (message.type === 'session.thinking.append') {
      await quiet.wait()
      if (!eligible()) return false
    }
    return send(message, eligible)
  }
}

/**
 * Settles a spoken turn from what the voice library actually sends for it: each outcome other than an
 * admitted coding request ends with a note to GPT Live carrying the turn's `delegation_id`, worded by the
 * policy. Observed as the note is handed over, before any wait for silence.
 */
export function turnOutcomes(send, policy, turns) {
  const outcomes = new Map([
    [policy.missingTranscript, 'missing-transcript'],
    [policy.rejected, 'rejected'],
    ...(policy.classification ? [[policy.classification.voice, 'voice'], [policy.classification.clarify, 'clarify'],
      [policy.classification.unavailable, 'unavailable']] : []),
  ])
  return async (message, eligible) => {
    const state = message.type === 'session.commentary.append' && typeof message.delegation_id === 'string'
      ? outcomes.get(message.content) : undefined
    if (state) await Promise.resolve(turns.settle(message.delegation_id, { state })).catch(() => {})
    return send(message, eligible)
  }
}

/**
 * A spoken turn is a coding hand-off only once Claude's request is filed: dispatch (a new request) or
 * steer (added to the one in progress) resolving. `requestId` is the task the Mod will claim.
 */
export function turnTasks(tasks, turns) {
  return {
    ...tasks,
    async dispatch(id, input, signal) {
      const accepted = await tasks.dispatch(id, input, signal)
      await Promise.resolve(turns.settle(id, { state: 'coding', requestId: accepted.requestId, mode: 'dispatch' })).catch(() => {})
      return accepted
    },
    async steer(id, input, signal) {
      const steered = await tasks.steer(id, input, signal)
      const requestId = tasks.states().find(task => task.status === 'running' || task.status === 'queued')?.requestId
        ?? tasks.states()[0]?.requestId
      await Promise.resolve(turns.settle(id, { state: 'coding', requestId, mode: 'steer' })).catch(() => {})
      return steered
    },
  }
}

const noTurns = { open() {}, settle() {}, close() {} }

export function attachVoice(socket, store, tasks, onLive, onCaption = async () => {}, history = () => [], turns = noTurns) {
  const lifetime = new AbortController()
  let channel
  let rtc
  let live
  let started = false
  let browserReady = false
  let playbackBusy = false
  const quiet = quietGate()
  let replaying = false
  let pendingMilestone = null
  // Heads-ups that another session's voice job finished; spoken ahead of a milestone, never with its result.
  const pendingNotices = []
  let announcingMilestone = false
  const replayed = new Set()
  const pendingResults = new Map()
  let tail = Promise.resolve()
  let queuedBytes = 0
  const clock = speechClock()
  const stamp = clock.stamp
  const send = value => {
    if (socket.bufferedAmount > 4 * 1024 * 1024) return socket.close(1009)
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }
  const close = async () => {
    if (lifetime.signal.aborted) return
    lifetime.abort()
    quiet.release()
    onLive(null)
    await Promise.resolve(turns.close()).catch(() => {})
    await Promise.allSettled([live?.close(), channel?.close(), rtc?.close()])
  }
  const resultDelivery = (state, phase) => {
    const turn = state.turn
    if (!Number.isSafeInteger(turn) || turn < 1) return
    pendingResults.set(turn, { id: state.requestId, accepted: phase === 'accepted' })
    send({ type: 'voice.result-delivery', turn, phase })
  }
  const announceMilestone = async () => {
    if ((!pendingMilestone && !pendingNotices.length) || announcingMilestone || !browserReady || playbackBusy || pendingResults.size
      || !channel || !live || lifetime.signal.aborted || tasks.owed().length) return
    const notice = pendingNotices.shift()
    const milestone = notice ? { text: notice, current: () => true } : pendingMilestone
    if (!notice) pendingMilestone = null
    if (!milestone.current()) return
    announcingMilestone = true
    try {
      await live.completed()
      if (milestone.current() && !playbackBusy && !tasks.owed().length) {
        await live.append('session.commentary.append', null, notice ?? `Coding progress: ${milestone.text}`,
          () => milestone.current() && !playbackBusy && !lifetime.signal.aborted)
      }
    } finally { announcingMilestone = false }
    if (pendingNotices.length) void announceMilestone().catch(() => {})
  }
  const milestone = async (text, current) => {
    if (lifetime.signal.aborted || !live || typeof text !== 'string' || typeof current !== 'function') return false
    pendingMilestone = { text: text.slice(0, 1000), current }
    // A provider-side speech turn must not hold up Claude's turn.step hook.
    void announceMilestone().catch(() => {})
    return true
  }
  const notice = async text => {
    if (lifetime.signal.aborted || !live || typeof text !== 'string' || !text.trim()) return false
    if (pendingNotices.length < 8) pendingNotices.push(text.slice(0, 300))
    void announceMilestone().catch(() => {})
    return true
  }
  const replayOwed = async () => {
    if (!browserReady || playbackBusy || !channel || !live || replaying || pendingResults.size > 0 || lifetime.signal.aborted) return
    replaying = true
    try {
      const row = tasks.owed().find(item => !replayed.has(item.playbackId))
      if (!row || lifetime.signal.aborted) { await announceMilestone(); return }
      replayed.add(row.playbackId)
      resultDelivery({ turn: row.playbackId, requestId: row.id }, 'pending')
      const context = `Claude request ${row.status}.`
      const speech = row.text || 'Claude could not complete that request.'
      try {
        if (!await live.append('session.thinking.append', null, context)
          || !await live.append('session.commentary.append', null, speech)) throw new Error('Result delivery was not accepted')
        resultDelivery({ turn: row.playbackId, requestId: row.id }, 'accepted')
      } catch {
        pendingResults.delete(row.playbackId)
        void close().finally(() => socket.close(1011, 'Result delivery failed'))
      }
    } finally { replaying = false }
  }
  socket.on('close', () => { void close() })
  socket.on('error', () => { void close() })
  socket.on('message', data => {
    let event
    try { event = JSON.parse(data.toString()) } catch { socket.close(1007); return }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      socket.close(1007)
      return
    }
    if (event.type === 'voice.stop') { void close().finally(() => socket.close()); return }
    queuedBytes += data.length
    if (queuedBytes > 4 * 1024 * 1024) { socket.close(1009); void close(); return }
    tail = tail.then(async () => {
      if (lifetime.signal.aborted) return
      if (event.type === 'start') {
        if (started || event.provider !== 'openai-live' || typeof event.offer !== 'string') throw new Error('Invalid start')
        started = true
        const connection = configuredConnections(store)[0]
        if (!connection) throw new Error('GPT Live is not configured')
        const settings = {
          key: store.get('openai-live').key, model: connection.model, voice: connection.voice,
          startupHistory: history(),
          instructions: `${liveInstructions({ ...store.get('openai-live'), userName: await claudeUserName() })}${store.classifier?.().enabled === true
            ? ' For each completed new user request, delegate to the client for classification before deciding whether to answer, clarify, or request coding work. Wait for the client routing result. Do not treat the classification itself as a coding task. Past transcript messages saying the classifier was unavailable describe earlier requests; do not treat them as its current status. If asked whether it works now, delegate the question and use the current result.' : ''}`,
          commands: { timeoutMs: 10000, maxPending: 32 }, tools: [],
          connectTimeoutMs: 15000, maxQueuedBytes: 4 * 1024 * 1024, closeTimeoutMs: 5000,
        }
        clock.start()
        rtc = await openaiLiveProvider.webrtc.connect(settings, event.offer, lifetime.signal)
        const policy = {
          request: latestLiveUserRequest,
          missingTranscript: 'Please repeat your question.',
          accepted: 'The coding request was admitted. This is an internal notice, not a spoken response. Do not acknowledge it again; wait for the coding result.',
          rejected: 'Claude could not accept that request.',
          classification: liveClassification(store),
          result: state => ({
            context: `Claude request ${state.status}.`,
            speech: state.text || 'Claude could not complete that request.',
          }),
        }
        live = new LiveDelegation(
          // Interim rows arrive as live.transcript() captions below; Composer's final phase arrives only here.
          turnTasks(tasks, turns), { recordTranscript: async (role, text, _signal, id, phase) => {
            if (phase === 'final') await onCaption({ type: 'voice.live-caption', role, id, text, phase, at: stamp(id) }).catch(() => {})
          } },
          turnOutcomes(quietNotes((message, eligible) => channel.sendWhen(message, eligible), quiet), policy, turns),
          lifetime.signal, 32768, () => send({ type: 'voice.error' }),
          policy, { waitMs: 2500, quietMs: 350 }, resultDelivery,
        )
        channel = await openStsChannel(settings, {
          record: async (direction, message) => {
            if (process.env.VOICE_DEBUG_EVENTS === '1' && [
              'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped',
              'conversation.item.input_audio_transcription.completed', 'response.created',
              'response.done', 'voice.live-transcript', 'voice.live-delegation',
              'voice.provider-error',
            ].includes(message.type)) console.info('Voice event', direction, message.type)
          },
          receive: async message => {
            if (process.env.VOICE_DEBUG_EVENTS === '1') console.info('Voice receive', message.type)
            if (message.type === 'voice.live-transcript') {
              const caption = await live.transcript(message)
              if (caption) {
                const stamped = { ...caption, at: stamp(caption.id, message.start_ms) }
                await onCaption(stamped).catch(() => {})
                send(stamped)
              }
            } else if (message.type === 'voice.live-delegation') {
              // The voice handed this turn over: its routing is pending until classification or admission resolves.
              if (typeof message.id === 'string' && message.id) await Promise.resolve(turns.open(message.id, clock.at(message.offset))).catch(() => {})
              live.delegate(message)
            }
            else if (message.type === 'voice.provider-error') send(message)
          },
        }, lifetime.signal, openaiLiveProvider, rtc.connection)
        if (lifetime.signal.aborted) return
        onLive({ completed: () => live.completed(), replayOwed, milestone, notice })
        send({ type: 'ready', answer: rtc.answer })
        void channel.closed.then(reason => {
          if (!lifetime.signal.aborted) { send({ type: 'voice.session-closed', reason }); socket.close() }
        })
        return
      }
      if (event.type === 'voice.live-playback') {
        if (typeof event.speaking !== 'boolean') throw new Error('Invalid playback state')
        browserReady = true
        playbackBusy = event.speaking
        quiet.set(event.speaking)
        if (!playbackBusy) await replayOwed()
        return
      }
      if (event.type === 'voice.read-back') {
        if (event.turn !== undefined && (!Number.isSafeInteger(event.turn) || event.turn < 1)) throw new Error('Invalid read-back turn')
        browserReady = true
        await replayOwed()
        return
      }
      if (event.type === 'voice.result-played') {
        if (!Number.isSafeInteger(event.turn) || event.turn < 1) throw new Error('Invalid played result')
        const pending = pendingResults.get(event.turn)
        if (pending?.accepted) {
          await tasks.played(event.turn)
          pendingResults.delete(event.turn)
          await replayOwed()
        }
        return
      }
      if (['response.cancel', 'conversation.item.truncate'].includes(event.type) && channel) await channel.send(event)
    }).finally(() => { queuedBytes -= data.length }).catch(() => {
      send({ type: 'voice.error' })
      void close().finally(() => socket.close())
    })
  })
}
