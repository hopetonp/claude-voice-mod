import { VoiceHistory, extraWords } from './voice-history.js'
import { settingsApi } from './settings-api.js'
import { liveLine, tail } from './live-line.js'
import { SETTINGS_PANE, settingsPane } from './settings-pane.js'
import { voiceBubble } from './voice-bubble.js'
import { english as voiceEnglish, voiceText } from './voice-status-i18n.js'
import { voiceDuration } from './voice-duration.js'

let connection = null
let status = 'Voice host not connected'
let media = { phase: 'offline', muted: false, mediaConnected: false }
const vt = (key, values) => voiceText(media.locale, key, values)
let polling = false
// When the user's live transcript and the voice's reply last changed, for the live line.
let userChangedAt = 0
let replyChangedAt = 0
// Whether the live line was drawn at the last poll, so its disappearance gets a redraw.
let lineShown = false
let sessionId = null
let voiceTask = null
// The main agent's turn in progress, if any: with voice live and nobody talking, the strip names it.
let claudeTurn = null
// Results finished in other sessions: each announced once (toast and chime), only when it finishes while
// this plugin runs. Results already waiting when it loads (an app restart) were announced before.
let announced = new Set()
const loadedAt = Date.now()
// The selected session owns the voice. Before any session has selected (an older host), every session does.
function owning() {
  return !media.selectedSession || media.selectedSession === sessionId
}
let ticking = false
let history = new VoiceHistory()
let routedTurns = new Map()
// Voice prompts sent to Claude after their turn's bubble was already written: prompt text → bubble text.
// Those prompts draw as a marker under the bubble, so the words show once.
const handedOff = new Map()
// The voice's reply to each request it handed to Claude, drawn under the request: prompt text → words.
let notes = new Map()
// Notes still being spoken, so each poll brings their words up to date.
const openNotes = new Set()
let historyInitialized = false
let savedHistory = []
let routingPending = false
let historyRevision = -1
// When the person pressed start: until the page reports progress the band keeps showing
// "connecting", instead of flicking back to the old phase while the page picks up the command.
let startRequestedAt = 0
const START_HOLD_MS = 8000
// Set when a Claude session starts: until a turn starts, any voice turn the host reports running is an orphan.
let sessionFresh = false

// DeepSeek's five-bar, stop, and muted glyphs inside the established Claude button surface.
function voiceButtonIcon(phase, muted, theme = 'light') {
  const colors = voiceColors(theme)
  // The symbols sit on the blue button, so in light mode they are white rather than the theme's dark ink.
  const ink = theme === 'dark' ? colors.ink : '#ffffff'
  const connecting = phase === 'connecting'
  const active = !['offline', 'idle', 'error', 'needs-activation', 'connecting'].includes(phase)
  const bars = [[0.15, 5.6], [3.65, 16], [7.15, 9.6], [10.65, 13], [14.15, 5.6]]
  const delays = [0, -720, -540, -360, -180]
  const wave = bars.map(([x, height], index) => {
    const y = (16 - height) / 2
    if (!connecting) return `<rect x="${x}" y="${y}" width="1.7" height="${height}" rx="0.85" fill="${ink}"/>`
    const shortHeight = height * .35
    const shortY = (16 - shortHeight) / 2
    return `<rect x="${x}" y="${y}" width="1.7" height="${height}" rx="0.85" fill="${ink}"><animate attributeName="height" values="${shortHeight};${height};${shortHeight}" dur="900ms" begin="${delays[index]}ms" repeatCount="indefinite"/><animate attributeName="y" values="${shortY};${y};${shortY}" dur="900ms" begin="${delays[index]}ms" repeatCount="indefinite"/><animate attributeName="opacity" values=".55;1;.55" dur="900ms" begin="${delays[index]}ms" repeatCount="indefinite"/></rect>`
  }).join('')
  const stop = `<path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>`
  const micOff = `<path d="M8 1a2.6 2.6 0 0 0-2.6 2.6v1.1l5.2 5.2V3.6A2.6 2.6 0 0 0 8 1ZM4.2 8.2c0 .4.05.7.14 1.05l3.66 3.66h-1.6l-4-4 1.1-1.1c.1.15.3.25.7.39ZM7.4 11.7v2.2h1.2v-2.2H7.4ZM2.3 1.4l12.3 12.3-.85.85L1.45 2.25 2.3 1.4Z" fill="${ink}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BUTTON_SIZE}" height="${BUTTON_SIZE}" viewBox="0 0 34 34"><circle cx="17" cy="17" r="16" fill="${BUTTON_FILL}" stroke="${darken(BUTTON_FILL, .25)}" stroke-width="1"/><g transform="translate(9 9)">${muted ? micOff : active ? stop : wave}</g></svg>`
}
// The start button's size in pixels: the SVG is drawn at exactly this size. Its seat, which sets the voice
// row's height, is BUTTON_ROWS tall, with the button centred in it.
const BUTTON_SIZE = 28
const BUTTON_ROWS = 1.4
// The voice's orb in pixels, drawn at exactly this size; at most BUTTON_SIZE so the row keeps its height.
const ORB_SIZE = 28
// The start button's colour; its ring is the same colour, a little darker.
const BUTTON_FILL = '#1d4ed8'
function darken(hex, amount) {
  const channels = [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)))
  return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

// DeepSeek's quick-control glyphs (voice-client glyphs.tsx), drawn at 15px in a 26px round seat.
const voiceColors = theme => theme === 'dark'
  ? { control: '#383836', border: '#5e5e5a', bars: '#e8e8e4', ink: '#e8e8e4', muted: '#b4b4ae', off: '#e16d66' }
  : { control: '#ffffff', border: '#d1d0cc', bars: '#3b82f6', ink: '#343432', muted: '#676761', off: '#b43c35' }
const GLYPHS = {
  mic: c => `<path d="M8 1a2.6 2.6 0 0 0-2.6 2.6v4.8a2.6 2.6 0 0 0 5.2 0V3.6A2.6 2.6 0 0 0 8 1Z" fill="${c}"/><path d="M4.2 8.2c0 2.1 1.7 3.8 3.8 3.8s3.8-1.7 3.8-3.8H13c0 2.9-2.2 5.2-5 5.2s-5-2.3-5-5.2h1.2Z" fill="${c}"/><path d="M7.4 11.7v2.2h1.2v-2.2H7.4Z" fill="${c}"/>`,
  micOff: c => `<path d="M8 1a2.6 2.6 0 0 0-2.6 2.6v1.1l5.2 5.2V3.6A2.6 2.6 0 0 0 8 1Z" fill="${c}"/><path d="M4.2 8.2c0 .4.05.7.14 1.05l3.66 3.66h-1.6l-4-4 1.1-1.1c.1.15.3.25.7.39Z" fill="${c}"/><path d="M7.4 11.7v2.2h1.2v-2.2H7.4Z" fill="${c}"/><path d="M2.3 1.4l12.3 12.3-.85.85L1.45 2.25 2.3 1.4Z" fill="${c}"/>`,
  volume: c => `<path d="M2 6v4h2.6l3.4 2.8V3.2L4.6 6H2Z" fill="${c}"/><path d="M10.2 5.2a3.4 3.4 0 0 1 0 5.6l.7.9a4.4 4.4 0 0 0 0-7.4l-.7.9Z" fill="${c}"/><path d="M11.9 3.4a6 6 0 0 1 0 9.2l.7.9a7 7 0 0 0 0-11l-.7.9Z" fill="${c}"/>`,
  volumeOff: c => `<path d="M2.4 6.1h2.3L8 3.3v9.4L4.7 9.9H2.4a.6.6 0 0 1-.6-.6V6.7a.6.6 0 0 1 .6-.6Z" fill="${c}"/><path d="M10.6 6.2 14 9.6m0-3.4-3.4 3.4" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  resume: c => `<path d="M5 3.2a.9.9 0 0 1 1.38-.75l6 4.8a.9.9 0 0 1 0 1.5l-6 4.8A.9.9 0 0 1 5 12.6V3.2Z" fill="${c}"/>`,
  // A single cog silhouette keeps its teeth connected at the small control size.
  settings: c => `<path d="M6.65.7h2.7l.32 1.64c.52.16 1.01.36 1.47.61l1.39-.95 1.91 1.91-.95 1.39c.25.46.45.95.61 1.47l1.64.32v2.7l-1.64.32c-.16.52-.36 1.01-.61 1.47l.95 1.39-1.91 1.91-1.39-.95c-.46.25-.95.45-1.47.61l-.32 1.64h-2.7l-.32-1.64c-.52-.16-1.01-.36-1.47-.61l-1.39.95-1.91-1.91.95-1.39c-.25-.46-.45-.95-.61-1.47L.7 9.35v-2.7l1.64-.32c.16-.52.36-1.01.61-1.47L2 3.47l1.91-1.91 1.39.95c.46-.25.95-.45 1.47-.61L6.65.7ZM8 5.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z" fill="${c}" fill-rule="evenodd"/>`,
}
function voiceIcon(glyph, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><g transform="translate(5.5 5.5) scale(.9375)">${GLYPHS[glyph](color)}</g></svg>`
}

// DeepSeek's nine-band microphone meter, adapted to a Mod SVG leaf, in a clear green: the user's mic is live.
const xmlText = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
function voiceWave(levels = [], label = 'Microphone levels') {
  const bars = Array.from({ length: 9 }, (_, i) => {
    const amplitude = Math.max(0, Math.min(1, Number(levels[i]) || 0))
    const height = 3 + Math.min(1, Math.sqrt(amplitude) * 2) * 19
    return `<rect x="${5 + i * 6}" y="${(24 - height) / 2}" width="3" height="${height}" rx="1.5" fill="url(#spectrum)" opacity="${amplitude > .01 ? 1 : .4}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24" viewBox="0 0 64 24" role="img" aria-label="${xmlText(label)}"><defs><linearGradient id="spectrum" x2="1" y2="0"><stop stop-color="#22c55e"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>${bars}</svg>`
}

// The voice's mark on the live line: a calm blue-violet orb, soft at the edges, that swells and glows with
// the voice's output level. No red: it would read as a warning.
function voiceOrb(levels = [], label = 'Voice speaking') {
  const level = Math.min(1, Math.sqrt(Math.max(0, ...levels.map(value => Number(value) || 0))) * 1.4)
  const core = (6 + level * 2).toFixed(2)
  const glow = (9.5 + level * 1.5).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ORB_SIZE}" height="${ORB_SIZE}" viewBox="0 0 22 22" role="img" aria-label="${xmlText(label)}"><defs>`
    + `<radialGradient id="orb-glow"><stop stop-color="#7c6cf7" stop-opacity="${(.6 + level * .3).toFixed(2)}"/><stop offset=".6" stop-color="#7c6cf7" stop-opacity="${(.3 + level * .2).toFixed(2)}"/><stop offset="1" stop-color="#7c6cf7" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="orb-core" cx=".4" cy=".4" r=".6"><stop stop-color="#c6ecff"/><stop offset=".45" stop-color="#4fc3f7"/><stop offset=".8" stop-color="#7c6cf7" stop-opacity=".85"/><stop offset="1" stop-color="#7c6cf7" stop-opacity="0"/></radialGradient>`
    + `</defs><circle cx="11" cy="11" r="${glow}" fill="url(#orb-glow)"/><circle cx="11" cy="11" r="${core}" fill="url(#orb-core)"/></svg>`
}

// The orb while voice listens and nobody talks: dimmer than the speaking orb, breathing slowly.
// The breath is drawn from the time on each redraw (an animated SVG draws in a framed box on desktop).
const BREATH_MS = 3200
// Parked (standby, nothing running), the orb holds still in gray: the voice will not respond until resumed.
function restingOrb(now, parked = false, label = parked ? 'Voice on standby' : 'Voice listening') {
  const [light, mid, edge] = parked ? ['#d4d8de', '#aab1bb', '#8a929c'] : ['#c6ecff', '#4fc3f7', '#7c6cf7']
  const breath = (1 - Math.cos(2 * Math.PI * (now % BREATH_MS) / BREATH_MS)) / 2
  // As large as the speaking orb at rest, so it reads at the row's size; the breath only swells it a little.
  const core = (6 + breath * 1.2).toFixed(2)
  const glow = (8.5 + breath * 2).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ORB_SIZE}" height="${ORB_SIZE}" viewBox="0 0 22 22" role="img" aria-label="${xmlText(label)}"><defs>`
    + `<radialGradient id="rest-glow"><stop stop-color="${edge}" stop-opacity=".4"/><stop offset=".6" stop-color="${edge}" stop-opacity=".15"/><stop offset="1" stop-color="${edge}" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="rest-core" cx=".4" cy=".4" r=".6"><stop stop-color="${light}" stop-opacity=".8"/><stop offset=".45" stop-color="${mid}" stop-opacity=".7"/><stop offset=".8" stop-color="${edge}" stop-opacity=".55"/><stop offset="1" stop-color="${edge}" stop-opacity="0"/></radialGradient>`
    + `</defs><circle cx="11" cy="11" r="${glow}" fill="url(#rest-glow)"/><circle cx="11" cy="11" r="${core}" fill="url(#rest-core)"/></svg>`
}

// The live line, holding back the user's words already written as a bubble (a caption the voice did not
// answer keeps growing, and only its new words are being spoken).
function currentLine(now) {
  if (!owning()) return null
  return liveLine({ ...media, transcript: history.unwritten(media.transcript ?? ''), userChangedAt, replyChangedAt }, now)
}

function show($, next) {
  if (status === next) return
  status = next
  $.ui.invalidate('ui.render')
}
const duration = voiceDuration

async function refresh($) {
  if (polling) return
  polling = true
  try {
    if (connection === null) {
      // Windows sets USERPROFILE, not HOME, unless something set HOME for the session.
      const home = await $.env.get('HOME') ?? await $.env.get('USERPROFILE')
      if (!home) throw new Error('HOME is unavailable')
      const saved = await $.fs.read(`${home}/.claude/voicemesh-controls/connection.json`)
      connection = JSON.parse(saved)
    }
    const response = await $.http.fetch(`${connection.url}/api/state`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    })
    if (!response.ok) throw new Error(`Host returned ${response.status}`)
    const next = JSON.parse(response.text)
    // The host's voice belongs to the selected session. Any other session shows its voice off: never
    // another session's phase, clock or levels, so switching into it starts clean.
    if (next.selectedSession && next.selectedSession !== sessionId) {
      Object.assign(next, { phase: 'idle', muted: false, speakerMuted: false, inputLevels: [], outputLevels: [], activeSeconds: 0, error: undefined })
    }
    history.classifierEnabled = next.classifierEnabled === true
    const themeChanged = next.theme !== media.theme
    const localeChanged = next.locale !== media.locale
    const levelsChanged = JSON.stringify(media.inputLevels) !== JSON.stringify(next.inputLevels)
      || JSON.stringify(media.outputLevels) !== JSON.stringify(next.outputLevels)
    const owns = !next.selectedSession || next.selectedSession === sessionId
    if (owns && sessionId && !Number.isSafeInteger(next.captionRevision) && next.phase !== 'idle') {
      history.observe('user', next.transcriptId, next.transcript)
      history.observe('assistant', next.lastReplyId, next.lastReply)
      if (!historyInitialized) for (const row of history.rows) history.delivered(row)
      if (next.phase !== 'speaking') history.finish('assistant')
    }
    historyInitialized = true
    const waiting = ['idle', 'offline', 'standby'].includes(next.phase) && next.mediaConnected
    if (startRequestedAt && waiting && Date.now() - startRequestedAt < START_HOLD_MS) next.phase = 'connecting'
    else startRequestedAt = 0
    const changedAt = Date.now()
    const textChanged = next.transcript !== media.transcript || next.lastReply !== media.lastReply
    // The first poll after a load only learns the current text; it is not a change.
    if (media.transcript !== undefined && next.transcript !== media.transcript) userChangedAt = changedAt
    if (media.lastReply !== undefined && next.lastReply !== media.lastReply) replyChangedAt = changedAt
    media = next
    const elsewhere = Array.isArray(next.waitingResults) ? next.waitingResults : []
    const finish = result => `${result.sessionId}:${result.finishedAt}`
    if (owning()) {
      for (const result of elsewhere) {
        if (!(result.finishedAt > loadedAt) || announced.has(finish(result))) continue
        announced.add(finish(result))
        $.ui.toast(`${[result.folder, result.title].filter(Boolean).join(' · ') || 'Another session'}: work finished`)
        void control($, 'chime')
      }
    }
    announced = new Set([...announced].filter(key => elsewhere.some(result => finish(result) === key)))
    const showing = !!currentLine(changedAt)
    show($, !next.mediaConnected ? vt('status.pageNotResponding')
      : next.voiceConfigured === false ? vt('status.setupNeeded')
        : next.phase === 'error' && next.error ? vt('status.error', { detail: next.error })
      : next.phase === 'needs-activation' ? vt('status.audioActivation')
        : vt('status.voicePhase', {
          phase: voiceEnglish[`phase.${next.phase}`] ? vt(`phase.${next.phase}`) : next.phase,
          muted: next.muted ? vt('status.micMuted') : '',
          speakerMuted: next.speakerMuted ? vt('status.speakerMuted') : '',
          duration: ['listening', 'speaking', 'thinking'].includes(next.phase)
            ? vt('status.duration', { duration: duration(next.activeSeconds, next.locale) }) : '',
        }))
    if (levelsChanged || themeChanged || localeChanged) $.ui.invalidate('ui.render')
    // Redraw for new words, while a line shows so it clears on time, and once when it goes away; and
    // while the resting orb shows, so it breathes.
    const resting = !showing && !['offline', 'idle', 'error', 'needs-activation', 'connecting', 'standby'].includes(next.phase)
    if (textChanged || showing || showing !== lineShown || resting) $.ui.invalidate('ui.render')
    lineShown = showing
  } catch {
    connection = null
    media = { phase: 'offline', muted: false, mediaConnected: false, locale: media.locale }
    show($, vt('status.hostNotConnected'))
  } finally {
    polling = false
  }
}

async function selectThisSession($) {
  if (!connection) await refresh($)
  if (!connection) return
  sessionId ??= await $.session.id()
  await postBridge($, '/api/claude/select', { sessionId, cwd: await $.session.cwd() })
}

async function postBridge($, path, body) {
  const response = await $.http.fetch(`${connection.url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Voice bridge returned ${response.status}`)
  return JSON.parse(response.text)
}

// A voice turn whose completion can no longer arrive (Claude restarted, or a later turn already
// started) is reported aborted, so the host accepts new requests and polling resumes.
async function abandonVoiceTask($) {
  const task = voiceTask
  voiceTask = null
  if (!task?.turnId || !connection) return
  await postBridge($, '/api/claude/result', { id: task.id, sessionId, turnId: task.turnId, status: 'aborted', text: '' })
    .catch(() => show($, vt('status.resultBridgeUnavailable')))
}

// A spoken stop or correction while a voice turn runs: Composer steers the host, and the host records
// it against the running task. A stop cancels the turn, and the host queues what was said as the next
// request. Anything else is a note handed to Claude after its next tool call, without stopping it.
async function pollSteer($) {
  if (!connection || !sessionId || !voiceTask?.turnId || voiceTask.steering) return
  const response = await $.http.fetch(`${connection.url}/api/claude/steer?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok) return
  const { steer } = JSON.parse(response.text)
  if (steer?.parentId !== voiceTask.id) return
  if (steer.kind !== 'stop') {
    // A poll that crossed a delivery still lists what Claude already read.
    const read = voiceTask.readNotes ?? []
    voiceTask.notes = Array.isArray(steer.notes) ? steer.notes.filter(note => typeof note?.id === 'string'
      && typeof note.text === 'string' && !read.includes(note.id)) : []
    return
  }
  voiceTask.steering = true
  // A turn that already ended cannot be cancelled; report it so the interruption still goes through.
  await $.turn.abort({ turnId: voiceTask.turnId }).catch(() => abandonVoiceTask($))
}

// Notes reach Claude as context after a tool result in the voice turn's main loop. A turn that ends
// first, or sits in one long command, leaves them with the host, which makes them the next request.
async function deliverNotes($, result) {
  const task = voiceTask
  const notes = task?.turnId && !task.steering ? task.notes ?? [] : []
  if (!notes.length || result.deny !== undefined) return result
  const ids = notes.map(note => note.id)
  task.notes = []
  // Unconfirmed notes stay with the host rather than reaching Claude twice.
  const confirmed = await postBridge($, '/api/claude/steer/delivered', { sessionId, parentId: task.id, ids }).then(() => true, () => false)
  if (!confirmed) return result
  task.readNotes = [...(task.readNotes ?? []), ...ids]
  return { ...result, context: [...(result.context ?? []), ...notes.map(note => note.text)] }
}

async function pollVoiceTask($) {
  if (!connection || !sessionId || voiceTask?.turnId) return
  const response = await $.http.fetch(`${connection.url}/api/claude/request?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok) throw new Error(`Voice bridge returned ${response.status}`)
  const task = JSON.parse(response.text).task
  if (voiceTask) {
    if (task?.id === voiceTask.id) return
    voiceTask = null
    const warning = vt('status.handoffNotStarted')
    show($, warning)
    $.ui.toast(warning)
  }
  if (!task) return
  if (task.status === 'running' && sessionFresh) {
    voiceTask = { ...task, admitted: true }
    await abandonVoiceTask($)
    return
  }
  if (task.status === 'claimed' && task.submissionState === 'not-started') {
    // This Mod instance did not make the claim. The previous instance could not
    // have submitted: it must durably mark submission first.
    await postBridge($, '/api/claude/claim-failed', { id: task.id, sessionId })
    const warning = vt('status.handoffInterrupted')
    show($, warning)
    $.ui.toast(warning)
    return
  }
  if (['claimed', 'submitting', 'running'].includes(task.status)) {
    // A Mod reload can resume observing an admitted turn, but must never resubmit it.
    history.handOff(task.text)
    if (task.mode === 'submit') voiceTask = { ...task, admitted: true }
    else show($, vt('status.draftReview'))
    return
  }
  if (task.status !== 'queued') return
  await postBridge($, '/api/claude/claim', { id: task.id, sessionId })
  voiceTask = { ...task, admitted: true, turnId: null }
  if (task.mode === 'review') {
    const filled = await $.prompt.fill({ text: task.text, mode: 'replace' })
    if (!filled.isFilled) throw new Error('Claude prompt box is unavailable')
    await postBridge($, '/api/claude/reviewed', { id: task.id, sessionId })
    voiceTask = null
    return
  }
  // Claude holds command output while its turn runs. Capture the completed spoken acknowledgement
  // before submitting so it can be drawn beneath the native request on that row's first render.
  voiceTask.handoff = { key: task.text.trim() }
}

async function finishHandoff($) {
  const handoff = voiceTask?.handoff
  if (!handoff) return
  const route = routedTurns.get(voiceTask.id)
  // The queued task is already the host's coding admission. GPT Live supplies a
  // matching turn record, but tool-based realtime providers do not; requiring
  // that record leaves their claimed requests permanently unsubmitted.
  if (route && route.state !== 'coding') return
  const captionIds = route?.userCaptionIds ?? null
  const state = history.handoffReply(handoff.key, captionIds)
  // Returning from speaking to listening ends the acknowledgement before Composer finalizes its
  // transcript on standby. That playback transition, or standby without an acknowledgement, releases it.
  if (!state?.ready && !['standby', 'idle'].includes(media.phase)) return
  // Claude's native request is the user bubble. Capture the voice's finished reply before that row
  // is first drawn; Desktop does not redraw an existing UserMessage when the note changes later.
  history.attach(handoff.key, Date.now(), captionIds)
  const written = history.handOff(handoff.key, captionIds)
  const userPosted = !!state && savedHistory.some(entry => entry.id === state.turn.id && entry.line)
  openNotes.add(handoff.key)
  await flushHistory($)
  await updateNotes($)
  if (written && userPosted) {
    handedOff.set(handoff.key, written)
    if (handedOff.size > 64) handedOff.delete(handedOff.keys().next().value)
  }
  // This durable transition is the duplicate-send boundary. A fresh Mod may
  // release a pre-submit claim, but must never replay an uncertain submission.
  await postBridge($, '/api/claude/submitting', { id: voiceTask.id, sessionId })
  voiceTask.handoff = null
  await $.prompt.submit({ text: voiceTask.text, asUser: true })
}

async function refreshCaptions($) {
  if (!connection || !sessionId || !Number.isSafeInteger(media.captionRevision)
    || media.captionRevision === historyRevision) return
  const response = await $.http.fetch(`${connection.url}/api/captions?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok) throw new Error(`Caption bridge returned ${response.status}`)
  const result = JSON.parse(response.text)
  if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.revision)) throw new Error('Invalid caption ledger')
  const turns = Array.isArray(result.turns) ? result.turns : []
  routedTurns = new Map(turns.filter(turn => turn.state === 'coding' && turn.requestId)
    .map(turn => [turn.requestId, turn]))
  routingPending = turns.some(turn => turn.state === 'pending')
  const routeByCaption = new Map(turns.flatMap(turn => (turn.userCaptionIds ?? []).map(id => [id, turn])))
  // Entries saved before pieces existed carry no `posted` and count as fully delivered.
  const known = new Map(savedHistory.map(row => [row.id, row]))
  // Captions post oldest first, so every caption before the newest saved one was already posted,
  // even when its own saved entry has since been evicted.
  // By when each caption was first recorded, since rows come in the order they were spoken.
  const lastKnown = Math.max(-1, ...result.rows.filter(caption => known.has(caption.id)).map(caption => caption.createdRevision ?? -1))
  result.rows.forEach((caption, index) => {
    const row = history.observe(caption.role, caption.id, caption.text, Date.now(), caption.spokenAt)
    if (!row) return
    // Words added after a written bubble have a row (and saved entry) of their own.
    const saved = known.get(row.id)
    // Words a caption gained after it was written (row.from > 0) are new even when a later caption was
    // written meanwhile; only whole captions before the newest saved one count as already posted.
    if (caption.role === 'user') {
      const route = routeByCaption.get(caption.id)
      if (caption.delegated || route?.state === 'coding') {
        row.delegated = true
        // With classification on, a coding decision may reach the ledger just before the Mod
        // claims its task. Keep the acknowledgement behind that native prompt. A later
        // completed exchange proves an older coding caption is no longer awaiting its task.
        const laterRows = result.rows.slice(index + 1)
        const laterTurn = laterRows.some((later, offset) => later.role === 'user'
          && ((route && routeByCaption.get(later.id) !== route)
            || laterRows.slice(0, offset).some(reply => reply.role === 'assistant' && reply.final)))
        row.pendingDelegation = history.classifierEnabled && !saved?.final && !laterTurn
      }
      else if (route && route.state !== 'pending') row.routingResolved = true
    }
    if (saved ? saved.final || !Number.isSafeInteger(saved.posted)
      : row.from === 0 && (caption.createdRevision ?? index) < lastKnown) history.delivered(row)
    else if (saved) row.posted = Math.max(row.posted, saved.posted)
    if (caption.final) history.complete(row)
  })
  historyRevision = result.revision
}

function resolveVoiceTurns() {
  // GPT Live can answer a conversation without opening a route. Playback ending is enough to
  // release its caption; Composer need not enter standby and finalize the transcript first.
  if (!history.classifierEnabled || routingPending) return
  for (const row of history.rows) {
    if (row.role === 'user' && !row.delivered && !row.pendingDelegation && !row.routingResolved
      && history.hasCompletedReplyAfter(row)) row.routingResolved = true
  }
}

// A finished conversation caption becomes one bubble: /voice-said, answered and drawn by the
// voicemesh-said companion (a plugin's own command runs skip its own hooks). Commands start no turn.
// Without the companion the run rejects and the caption falls back to a dim history line.
function showSaid($, role, text) {
  const said = text.trim()
  return Promise.resolve().then(() => $.command.run({ command: 'voice-said', args: `${role === 'user' ? 'you' : 'voice'} ${said}` }))
    .catch(() => $.ui.log(`${role === 'user' ? 'You' : 'Voice'}: ${said}`, { to: 'transcript' }))
}

// Resolve only once every bubble is posted, so a hand-off cannot overtake them.
async function flushHistory($) {
  if (!sessionId) return
  let piece
  while ((piece = history.next())) {
    const { row } = piece
    history.posted(piece)
    if (!piece.final) continue
    const said = (piece.text ?? row.text.slice(piece.from)).trim()
    const line = row.delegated || !said ? '' : `${row.role === 'user' ? 'You' : 'Voice'}: ${said}`
    // Claude may complete command rows out of order when runs overlap. Finish one
    // visible row before starting the next so the timeline never has to move it.
    if (line && !piece.quiet) await showSaid($, row.role, said)
    const written = (piece.rows ?? [row]).map((item, index) => ({ id: item.id, line: index ? '' : line, posted: item.posted, final: true }))
    savedHistory = [...savedHistory.filter(entry => !written.some(item => item.id === entry.id)), ...written].slice(-128)
    await $.store.set(`voice-history:${sessionId}`, savedHistory)
    if (piece.note) await updateNotes($)
  }
}

// Brings each note under its request up to date and keeps it once its words are all in.
async function updateNotes($) {
  if (!sessionId) return
  let changed = false
  for (const key of openNotes) {
    const text = history.note(key)
    if (text && notes.get(key) !== text) { notes.set(key, text); changed = true }
    if (!history.rows.some(row => row.note === key && !row.delivered) && !(history.waiting?.key === key)) openNotes.delete(key)
  }
  if (!changed) return
  notes = new Map([...notes].slice(-64))
  $.ui.invalidate('ui.render')
  await $.store.set(`voice-notes:${sessionId}`, [...notes])
}

async function tick($) {
  if (ticking) return
  ticking = true
  try {
    await refresh($)
    // A restarted host has no selected session: the one on screen takes it back, so its own results are
    // not taken for another session's.
    if (media.selectedSession === null && sessionId
      && (await $.session.surfaces().catch(() => [])).length) await selectThisSession($).catch(() => {})
    await pollSteer($)
    await pollVoiceTask($)
    // Only the session that owns the voice writes its conversation.
    if (owning()) {
      await refreshCaptions($)
      if (sessionId && Number.isSafeInteger(media.captionRevision)) {
        if (media.phase !== 'speaking') history.finish('assistant')
        if (media.phase === 'idle') history.finish('user')
      }
      resolveVoiceTurns()
      await finishHandoff($)
      await flushHistory($)
      if (openNotes.size) await updateNotes($)
    }
  } catch {
    // Claimed requests are deliberately not replayed after an uncertain result.
    show($, vt('status.bridgeUnavailable'))
  } finally {
    ticking = false
  }
}

async function loadHistory($) {
  const saved = await $.store.get(`voice-notes:${sessionId}`).catch(() => [])
  notes = new Map(Array.isArray(saved) ? saved.filter(entry => typeof entry?.[0] === 'string' && typeof entry?.[1] === 'string') : [])
  const stored = await $.store.get(`voice-history:${sessionId}`).catch(() => [])
  savedHistory = Array.isArray(stored) ? stored.filter(row => typeof row?.id === 'string' && typeof row?.line === 'string').slice(-128) : []
}

// Makes sure a host is up with its media page connected, starting the host when none answers. Resolves
// true once it takes controls, false if it did not come up in time. Call it from anything that needs voice
// now; never from the polling timer, which would keep restarting a host that shut itself down.
async function ensureConnected($, { timeoutMs = 8000 } = {}) {
  if (connection === null) await refresh($)
  if (connection !== null && media.mediaConnected) return true
  if (connection === null) await ensurePackagedHost($).catch(() => {})
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await $.clock.sleep(250)
    await refresh($)
    if (connection !== null && media.mediaConnected) return true
  }
  return false
}

async function control($, action) {
  // Starting voice brings a host up if none is running; stopping or muting has nothing to do without one.
  if (action === 'start') {
    if (connection === null) show($, vt('status.connecting'))
    if (!await ensureConnected($)) return $.ui.toast(vt('status.hostNotConnected'))
  } else if (connection === null) {
    await refresh($)
    if (connection === null) return $.ui.toast(vt('status.hostNotConnected'))
  }
  const previousMedia = media
  try {
    // Pressing start in a session also selects it, which covers a session the desktop attached to
    // before the host was up.
    if (action === 'start' && sessionId) await selectThisSession($)
    if (action === 'start') {
      startRequestedAt = Date.now()
      media = { ...media, phase: 'connecting' }
      show($, vt('status.connecting'))
    }
    const response = await $.http.fetch(`${connection.url}/api/control`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      if (action === 'start') { media = previousMedia; startRequestedAt = 0 }
      const detail = JSON.parse(response.text).error ?? `Host returned ${response.status}`
      show($, detail)
      return
    }
    if (action !== 'start' && action !== 'chime') {
      const actionKey = { stop: 'control.stop', resume: 'control.resume', mute: 'control.muteMic',
        'speaker-mute': 'control.muteSpeaker' }[action]
      show($, vt('status.actionRequested', { action: actionKey ? vt(actionKey) : action }))
    }
  } catch (error) {
    if (action === 'start') { media = previousMedia; startRequestedAt = 0 }
    if (error?.message === 'Voice bridge returned 409') {
      show($, vt('status.busyElsewhere'))
      return
    }
    connection = null
    show($, vt('status.hostNotConnected'))
  }
}

// The Voice settings pane: what it shows, and one host change at a time whose outcome is its notice.
let settings = { prefs: null, models: [], voices: [], catalogLoading: false,
  open: { general: false, speech: true }, notice: '', busy: false, keyDraft: '' }
let catalogRequest = 0
function redrawSettings($, changes) {
  settings = { ...settings, ...changes }
  $.ui.invalidate('ui.render')
}

async function settingsHost($) {
  if (connection === null) await refresh($)
  if (connection === null) throw new Error('Voice host not connected')
  return settingsApi((url, init) => $.http.fetch(url, init), connection)
}

// Only the newest catalog request may change the pane, so a slow old reply cannot overwrite it.
async function loadCatalog($, api, prefs) {
  const request = ++catalogRequest
  if (!prefs.configured) return redrawSettings($, { models: [], voices: [], catalogLoading: false })
  redrawSettings($, { catalogLoading: true })
  try {
    const catalog = await api.catalog(prefs.provider, prefs.model)
    if (request === catalogRequest) redrawSettings($, { ...catalog, catalogLoading: false })
  } catch (error) {
    if (request === catalogRequest) redrawSettings($, { models: [], voices: [], catalogLoading: false, notice: error.message })
  }
}

async function settingsAction($, working, done, action) {
  if (settings.busy) return redrawSettings($, { notice: 'Still working on the last change…' })
  redrawSettings($, { busy: true, notice: working })
  // A null outcome keeps a notice set during the action (a failed preview), unless it is still the working text.
  try {
    const notice = (await action(await settingsHost($))) ?? done
    redrawSettings($, { notice: notice ?? (settings.notice === working ? '' : settings.notice) })
  }
  catch (error) { redrawSettings($, { notice: error.message }) }
  finally { redrawSettings($, { busy: false }) }
}

function settingsActions($) {
  const saved = 'Saved for the next Voice session.'
  // Saves, then refetches the catalog when the provider, key or model changed what it lists.
  // The old lists are cleared first, so they cannot be picked for the new provider.
  const apply = (working, done, change, { refetch = false } = {}) => settingsAction($, working, done, async api => {
    const before = settings.prefs
    const prefs = await change(api)
    if (refetch || prefs.provider !== before?.provider || prefs.configured !== before?.configured || prefs.model !== before?.model) {
      redrawSettings($, { prefs, models: [], voices: [] })
      void loadCatalog($, api, prefs)
    } else redrawSettings($, { prefs })
  })
  const provider = () => settings.prefs.provider
  return {
    toggle: id => redrawSettings($, { open: { ...settings.open, [id]: !settings.open[id] } }),
    selectProvider: id => apply('Saving provider…', 'Provider saved for the next Voice session.', api => api.selectProvider(id)),
    typeKey: value => { settings = { ...settings, keyDraft: value } },
    saveKey: key => key.trim() ? apply('Saving key…', 'Key saved on this computer.', async api => {
      const prefs = await api.save(provider(), { key: key.trim() })
      settings = { ...settings, keyDraft: '' }
      return prefs
    }, { refetch: true }) : undefined,
    saveOptions: fields => apply('Saving…', saved, api => api.save(provider(), fields)),
    saveChatBubbles: async chatBubbles => {
      redrawSettings($, { chatBubbles, notice: 'Saving…' })
      try {
        await $.fs.write(await displayFile($), JSON.stringify({ chatBubbles }))
        display = { chat: chatBubbles, at: Date.now() }
        redrawSettings($, { notice: chatBubbles ? 'Turns show as chat bubbles.' : 'Turns show as plain text.' })
        $.ui.invalidate('ui.render')
      } catch { redrawSettings($, { chatBubbles: !chatBubbles, notice: 'Could not save the display choice.' }) }
    },
    saveStandby: seconds => apply('Saving…', 'Standby duration saved.', api => api.save(provider(), { voiceStandbySec: seconds })),
    saveSelection: (model, voice) => apply('Saving…', saved, api => api.save(provider(), { model, voice })),
    preview: voice => settingsAction($, 'Loading preview…', null, async api => {
      const clip = await api.preview(voice)
      // Playback is not awaited, so the other controls work while the clip plays.
      $.audio.play({ base64: clip.base64, mime: clip.mime }).catch(() => redrawSettings($, { notice: 'Preview could not play.' }))
    }),
    testConnection: () => settingsAction($, 'Checking the provider connection…', '', async api =>
      (await api.probeConnection()) ? 'Provider connection ready.' : 'Provider connection failed.'),
    testAudioTools: () => settingsAction($, 'Checking synthetic audio and coding-tool exchange…', '', async api =>
      (await api.probeAudioTools()) ? 'Audio and coding tools ready.' : 'Audio or coding-tool exchange failed.'),
  }
}

// The Chat bubbles setting, read at most once a second since every note draws with it.
let display = { chat: false, at: -Infinity }
async function chatStyle($) {
  if (Date.now() - display.at < 1000) return display.chat
  let chat = false
  try { chat = JSON.parse(await $.fs.read(await displayFile($))).chatBubbles === true } catch {}
  display = { chat, at: Date.now() }
  return chat
}

// Chat bubbles or plain text for finished turns: a file the voicemesh-said companion reads as it draws.
async function displayFile($) {
  return `${await $.env.get('HOME') ?? await $.env.get('USERPROFILE')}/.claude/voicemesh-controls/display.json`
}

async function openSettings($, surface) {
  if (surface === 'desktop') {
    try {
      await (await settingsHost($)).setupDialog()
    }
    catch (error) { $.ui.toast(`Voice settings could not open: ${error.message}`) }
    return
  }
  const opened = await $.ui.open({ id: SETTINGS_PANE, title: 'Voice settings' })
  if (!opened.isPlaced) return $.ui.toast('Voice settings could not open')
  try { redrawSettings($, { chatBubbles: JSON.parse(await $.fs.read(await displayFile($))).chatBubbles === true }) } catch {}
  await settingsAction($, '', '', async api => {
    const prefs = await api.load()
    redrawSettings($, { prefs })
    void loadCatalog($, api, prefs)
    return ''
  })
}

// The voice row above the prompt.
function voiceStrip($, e, original) {
  const { Box, Client, Svg, Text } = $.ui.resolve(e)
  const colors = voiceColors(media.theme)
  const parked = media.phase === 'standby'
  const connecting = media.phase === 'connecting'
  const active = !['offline', 'idle', 'error', 'needs-activation'].includes(media.phase)
  const live = active && !parked && !connecting
  // The bars follow the user's microphone alone; the voice's orb on the live line shows the voice.
  const waveLevels = Array.from({ length: 9 }, (_, i) => media.muted ? 0 : Number(media.inputLevels?.[i]) || 0)
  // DeepSeek's quick controls: the clock, or one word while parked or connecting, then the icons.
  // A problem the person must act on (host down, setup needed, an error) replaces the clock.
  const healthy = media.mediaConnected && media.voiceConfigured !== false && media.phase !== 'error' && media.phase !== 'needs-activation'
  const label = !healthy || !connection ? status
    : live ? duration(media.activeSeconds, media.locale) : parked ? vt('status.standby') : connecting ? vt('status.connectingShort') : ''
  const icon = (action, glyph, color, alt) => Box({
    position: 'relative', width: 3, height: 1.2,
    children: [
      Svg({ source: voiceIcon(glyph, color), width: 26, height: 26, alt }),
      Box({ position: 'absolute', top: 0, left: 0,
        children: [Client({ key: `voice-icon-${action}`, module: './voice-hit-client.js', props: { action }, width: 3, height: 1.2 })] }),
    ],
  })
  const line = currentLine(Date.now())
  // A claimed voice request may still be waiting for handoff. Only a started Claude turn
  // means Claude is actually working; its turn ID survives a Mod reload via the host.
  const working = !!claudeTurn || !!voiceTask?.turnId
  const orbLabel = connecting ? vt('orb.connecting') : !active ? vt('orb.off')
    : parked && !working ? vt('orb.standby') : vt('orb.listening')
  const orbGray = connecting || !active || (parked && !working)
  // The newest words must stay visible. Desktop ends a cut line with "…" whatever wrap says, so there the
  // whole line sits in a box that clips. The line grows to fill the box, so a short line reads from the left;
  // a line too long to fit is aligned to the right end, so what does not fit falls off the left.
  // The terminal counts cells exactly, so there the words that fit are chosen here instead: the strip's
  // width less the controls on the right (about 34 columns) and the gap.
  const room = (Number(e.props?.bodyColumns) || 80) - 34 - 2
  const words = line && (e.surface === 'desktop'
    ? Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row', justifyContent: 'flex-end',
      children: [Box({ flexShrink: 0, flexGrow: 1, children: [Text({ wrap: 'truncate-start', children: [tail(line.text, 1000)] })] })] })
    : Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Text({ wrap: 'truncate-start', children: [tail(line.text, room)] })] }))
  return Box({
    flexDirection: 'column',
    children: [
      original,
      Box({
        flexDirection: 'row',
        columnGap: 0.5,
        // Claude's band already frames the row, so the row adds no room of its own at either end: the orb's
        // glow and the start button's ring carry their own margin inside their pictures.
        paddingX: 0,
        paddingY: 0,
        alignItems: 'center',
        justifyContent: 'flex-end',
        children: [
          // The live line: the newest words of whoever is talking, unlabelled, filling the strip's empty left side
          // and stopping short of the controls.
          ...(line || live || parked || connecting || !active ? [Box({ flexDirection: 'row', width: 0, flexGrow: 1, flexShrink: 1, minWidth: 0, columnGap: 1, marginRight: 2,
            alignItems: 'center', children: active && !connecting && line ? [
              // The voice's words lead with its orb; the user's need no mark.
              ...(line.speaker === 'Voice' ? [Svg({ source: voiceOrb(media.speakerMuted ? [] : media.outputLevels, vt('orb.speaking')), width: ORB_SIZE, height: ORB_SIZE, alt: vt('orb.speaking') })] : []),
              words,
            ] : [
              // No words to show. Still speaking (a provider's words ran ahead of its audio): the orb keeps
              // pulsing. Nobody talking: it rests and breathes, and names Claude's work while a turn runs.
              media.phase === 'speaking'
                ? Svg({ source: voiceOrb(media.speakerMuted ? [] : media.outputLevels, vt('orb.speaking')), width: ORB_SIZE, height: ORB_SIZE, alt: vt('orb.speaking') })
                // In standby the voice is not listening, so the orb holds still: blue beside Claude's work,
                // gray when nothing is running.
                : Svg({ source: restingOrb(parked || connecting || !active ? 0 : Date.now(), orbGray, orbLabel), width: ORB_SIZE, height: ORB_SIZE,
                  alt: orbLabel }),
              ...(working ? [Text({ dimColor: true, wrap: 'truncate', children: [vt('status.working')] })] : []),
            ] })] : []),
          ...(parked ? [icon('resume', 'resume', colors.muted, vt('control.resume'))] : []),
          // The clock sits in a seat of its own, wide enough for any m:ss, so a changing digit moves
          // only inside the seat and never pushes the icons beside it.
          ...(label ? [live && healthy && connection
            ? Box({ width: 7, flexShrink: 0, justifyContent: 'flex-end', children: [Text({ color: colors.muted, children: [label] })] })
            : Text({ color: colors.muted, children: [label] })] : []),
          ...(active ? [
            icon('mute', media.muted ? 'micOff' : 'mic', media.muted ? colors.off : colors.muted, vt(media.muted ? 'control.unmuteMic' : 'control.muteMic')),
            icon('speaker-mute', media.speakerMuted ? 'volumeOff' : 'volume', media.speakerMuted ? colors.off : colors.muted, vt(media.speakerMuted ? 'control.unmuteSpeaker' : 'control.muteSpeaker')),
          ] : []),
          ...(live ? [Svg({ source: voiceWave(waveLevels, vt('control.micLevels')), width: 64, height: 24, alt: vt('control.micLevels') })] : []),
          ...(connection ? [icon('settings', 'settings', colors.muted, vt('control.settings'))] : []),
          Box({
            position: 'relative',
            width: 4,
            height: BUTTON_ROWS,
            justifyContent: 'center',
            children: [
              Svg({ source: voiceButtonIcon(media.phase, media.muted, media.theme), width: BUTTON_SIZE, height: BUTTON_SIZE, alt: vt(active ? 'control.stop' : 'control.start') }),
              Box({
                position: 'absolute', top: 0, left: 0,
                children: [Client({ key: 'voice-toggle', module: './voice-toggle-client.js', width: 4, height: BUTTON_ROWS })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

// Drawing errors, with the session's folder, in a file to read after a failure.
async function recordDrawError($, error) {
  try {
    const file = `${await $.env.get('HOME') ?? await $.env.get('USERPROFILE')}/.claude/voicemesh-controls/draw-errors.log`
    const previous = await $.fs.read(file).catch(() => '')
    const line = `${new Date().toISOString()} ${await $.session.cwd().catch(() => '?')} ${error?.stack ?? error}`
    await $.fs.write(file, (previous + line + '\n').slice(-20000))
  } catch {}
}

// A Windows marketplace package carries its own runtime. The Mac package does not,
// so its existing host lifecycle is unchanged.
let packagedHostStarting = false

async function packagedHostRunning($, home) {
  try {
    const saved = JSON.parse(await $.fs.read(`${home}/.claude/voicemesh-controls/connection.json`))
    if (!saved.url || !saved.token) return false
    const response = await $.http.fetch(`${saved.url}/api/state`, {
      headers: { Authorization: `Bearer ${saved.token}` },
    })
    return response.ok
  } catch { return false }
}

async function packagedChromePath($) {
  const override = await $.env.get('VOICE_MEDIA_BROWSER')
  if (override) return override
  const programFiles = await $.env.get('ProgramFiles')
  const programFilesX86 = await $.env.get('ProgramFiles(x86)')
  const localAppData = await $.env.get('LOCALAPPDATA')
  for (const base of [programFiles, programFilesX86, localAppData]) {
    if (!base) continue
    const path = `${base}/Google/Chrome/Application/chrome.exe`
    if (await $.fs.exists(path)) return path
  }
  return 'chrome.exe'
}

async function ensurePackagedHost($) {
  const root = $.plugin.root
  const node = `${root}/runtime/node.exe`
  if (!await $.fs.exists(node) || packagedHostStarting) return
  const home = await $.env.get('HOME') ?? await $.env.get('USERPROFILE')
  if (!home) return
  if (!await $.env.get('HOME')) await $.env.set('HOME', home)
  if (await packagedHostRunning($, home)) return

  packagedHostStarting = true
  const path = await $.env.get('PATH') ?? ''
  const browser = await packagedChromePath($)
  const stream = $.process.spawn({
    argv: [node, `${root}/app/scripts/launch-host.js`],
    cwd: `${root}/app`,
    env: { HOME: home, PATH: `${root}/runtime;${path}`, VOICE_MEDIA_BROWSER: browser },
  })
  void (async () => {
    try { for await (const _ of stream) {} }
    catch { /* The voice row reports a disconnected host. */ }
    finally { packagedHostStarting = false }
  })()
}

const VOICE_CONTINUITY = `# VoiceMesh voice

The user may be talking to you by voice through the VoiceMesh Mod. Its host runs locally; its address and token are in ~/.claude/voicemesh-controls/connection.json ({ "url", "token" }).

If voice is on and you deliberately do something that interrupts it (restarting or killing the VoiceMesh host or its browser, reinstalling or reloading the Mod), you are responsible for turning it back on: restore it yourself straight afterwards, as it comes back from standby; do not leave the user to press start. This covers only interruptions you cause; voice the user turned off stays off. Before the disruptive step, note whether GET <url>/api/state (header Authorization: Bearer <token>) reports a phase other than offline, idle, error or needs-activation. If it did, once the host answers again (its media page connects about 3 seconds after a host start; until then /api/control answers 409), POST <url>/api/control with JSON {"action":"start"} and the same header, then confirm /api/state shows the voice listening.`

export function register(on) {
  on('ui.message', async ($, e, next) => {
    if (e.element === 'voice-toggle' && e.data?.action === 'toggle') {
      await (media.voiceConfigured === false ? openSettings($, e.surface) : control($, ['offline', 'idle', 'error', 'needs-activation'].includes(media.phase) ? 'start' : 'stop'))
    }
    if (e.element?.startsWith('voice-icon-')) {
      const action = e.data?.action
      if (action === 'settings') await openSettings($, e.surface)
      else if (['mute', 'speaker-mute'].includes(action)) await control($, action)
      else if (action === 'resume') await control($, 'start')
    }
    return next(e)
  })

  // The desktop app attaches to the session the user selects (and detaches from the one they leave), so
  // the newest attach owns the voice. A detach changes nothing: the next attach takes over.
  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop') await ensurePackagedHost($).catch(() => {})
    if (e.surface === 'desktop') await selectThisSession($).catch(() => {})
    return next(e)
  })

  // Wherever the Mod runs, Claude knows that its own work can cut off a voice conversation, and restores it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, { id: 'voicemesh-voice-continuity', scope: 'session', text: VOICE_CONTINUITY }] }
  })

  on('session.start', async ($, e, next) => {
    await ensurePackagedHost($).catch(() => {})
    sessionId = await $.session.id()
    historyRevision = -1
    await loadHistory($)
    await tick($)
    $.clock.every(250, () => void tick($))
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    // No turn is running when a session starts, so a recovered voice turn is an orphan.
    sessionFresh = true
    if (voiceTask?.turnId) await abandonVoiceTask($)
    if (e.source !== 'startup') {
      const nextSessionId = await $.session.id()
      if (nextSessionId !== sessionId) {
        sessionId = nextSessionId
        voiceTask = null
        history = new VoiceHistory()
        routedTurns = new Map()
        historyInitialized = false
        historyRevision = -1
        savedHistory = []
        routingPending = false
        openNotes.clear()
        await loadHistory($)
      }
      await tick($)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      sessionFresh = false
      claudeTurn = e.turnId
      $.ui.invalidate('ui.render')
    }
    if (voiceTask?.turnId && voiceTask.turnId !== e.turnId && e.agentId === undefined) await abandonVoiceTask($)
    if (voiceTask?.admitted && !voiceTask.turnId && e.text === voiceTask.text) {
      voiceTask.turnId = e.turnId
      await postBridge($, '/api/claude/started', { id: voiceTask.id, sessionId, turnId: e.turnId }).catch(() => show($, vt('status.resultBridgeUnavailable')))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const owned = voiceTask?.admitted && voiceTask.turnId === e.turnId && e.agentId === undefined
    const taskId = owned ? voiceTask.id : null
    const taskSessionId = sessionId
    let visibleText = ''
    let calledTool = false
    const stream = next(e)[Symbol.asyncIterator]()
    while (true) {
      const item = await stream.next()
      if (item.done) {
        if (owned && calledTool && visibleText.trim() && Number.isSafeInteger(e.index)) {
          // The voice speaks this progress next; it is not its reply to the request.
          history.stopWaiting()
          await postBridge($, '/api/claude/milestone', { id: taskId, sessionId: taskSessionId,
            turnId: e.turnId, step: e.index, text: visibleText.trim().slice(0, 1000) }).catch(() => {})
        }
        return item.value
      }
      const chunk = item.value
      if (owned && chunk?.kind === 'text') visibleText = (visibleText + chunk.text).slice(0, 1000)
      if (owned && chunk?.kind === 'tool') calledTool = true
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    return e.agentId === undefined ? deliverNotes($, result) : result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && claudeTurn === e.turnId) {
      claudeTurn = null
      $.ui.invalidate('ui.render')
    }
    if (voiceTask?.turnId === e.turnId && e.agentId === undefined) {
      const status = e.reason === 'answer' ? 'complete' : e.isAborted ? 'aborted' : 'failed'
      await postBridge($, '/api/claude/result', { id: voiceTask.id, sessionId, turnId: e.turnId, status, text: e.answer }).catch(() => show($, vt('status.resultBridgeUnavailable')))
      voiceTask = null
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) =>
    settingsPane($.ui.resolve(e), settings, settingsActions($)))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const key = String(e.props?.text ?? '').trim()
    const written = handedOff.get(key)
    const note = notes.get(key)
    if ((written === undefined || e.props?.isExpanded) && !note) return next(e)
    const ui = $.ui.resolve(e)
    const extra = written === undefined ? '' : extraWords(written, e.props.text)
    const request = written === undefined || e.props?.isExpanded ? await next(e)
      : ui.Text({ dimColor: true, children: [extra ? `↳ Sent to Claude, with: ${extra}` : '↳ Sent to Claude'] })
    if (!note) return request
    // The voice's reply to this request sits under it, so it can never show before the words it answers.
    return ui.Box({ flexDirection: 'column', rowGap: 1, children: [request, voiceBubble(ui, note, await chatStyle($), media.theme)] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const original = await next(e)
    // A failure while drawing would leave the session with no voice row at all (the app falls back to
    // its own prompt area), so it is recorded and a minimal row with the start button is drawn instead.
    try { return voiceStrip($, e, original) } catch (error) {
      void recordDrawError($, error)
      const { Box, Client, Text } = $.ui.resolve(e)
      return Box({ flexDirection: 'column', children: [original, Box({ flexDirection: 'row', justifyContent: 'flex-end', columnGap: 1, alignItems: 'center', children: [
        Text({ dimColor: true, children: ['Voice row error (logged)'] }),
        Box({ position: 'relative', width: 4, height: BUTTON_ROWS, children: [Client({ key: 'voice-toggle', module: './voice-toggle-client.js', width: 4, height: BUTTON_ROWS })] }),
      ] })] })
    }
  })
}
