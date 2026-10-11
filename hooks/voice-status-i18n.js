import catalogs from './voice-status-catalogs.js'

// Voice-row copy is saved with the Mod, so it renders immediately and works offline.
export const english = {
  'status.hostNotConnected': 'Voice host not connected',
  'status.pageNotResponding': 'Voice page not responding',
  'status.setupNeeded': 'Voice setup needed',
  'status.error': 'Voice error: {detail}',
  'status.audioActivation': 'Composer needs audio activation',
  'status.bridgeUnavailable': 'Voice bridge unavailable',
  'status.resultBridgeUnavailable': 'Voice result bridge unavailable',
  'status.handoffNotStarted': 'Voice handoff did not start. Please try the request.',
  'status.handoffInterrupted': 'Voice handoff was interrupted before submission. Please try the request.',
  'status.draftReview': 'Voice draft state needs review',
  'status.busyElsewhere': 'Voice is busy in another Claude chat',
  'status.connecting': 'Voice connecting',
  'status.actionRequested': '{action} requested',
  'status.voicePhase': 'Voice {phase}{muted}{speakerMuted}{duration}',
  'status.micMuted': ' · mic muted',
  'status.speakerMuted': ' · speaker muted',
  'status.duration': ' · {duration}',
  'status.startHost': 'Start the VoiceMesh host first',
  'status.standby': 'Standing by',
  'status.connectingShort': 'Connecting…',
  'status.working': 'Claude is working…',
  'phase.idle': 'idle',
  'phase.offline': 'offline',
  'phase.connecting': 'connecting',
  'phase.listening': 'listening',
  'phase.speaking': 'speaking',
  'phase.thinking': 'thinking',
  'phase.standby': 'standby',
  'phase.error': 'error',
  'phase.needs-activation': 'needs activation',
  'orb.off': 'Voice off',
  'orb.connecting': 'Voice connecting',
  'orb.standby': 'Voice on standby',
  'orb.listening': 'Voice listening',
  'orb.speaking': 'Voice speaking',
  'control.resume': 'Resume voice',
  'control.muteMic': 'Mute microphone',
  'control.unmuteMic': 'Unmute microphone',
  'control.muteSpeaker': 'Mute speaker',
  'control.unmuteSpeaker': 'Unmute speaker',
  'control.settings': 'Voice settings',
  'control.start': 'Start voice',
  'control.stop': 'Stop voice',
  'control.micLevels': 'Microphone levels',
}

export function catalogLocale(locale = 'en') {
  const value = String(locale).trim().replace(/_/g, '-').toLowerCase()
  if (!value || value === 'en' || value.startsWith('en-')) return 'en'
  if (['zh', 'zh-cn', 'zh-sg', 'zh-hans'].includes(value)) return 'zh-Hans'
  if (['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'].includes(value)) return 'zh-Hant'
  if (value === 'es' || value === 'es-419' || (value.startsWith('es-') && value !== 'es-es')) return 'es-419'
  if (value === 'es-es') return 'es-ES'
  if (value === 'pt' || value.startsWith('pt-')) return 'pt-BR'
  return Object.keys(catalogs).find(key => key.toLowerCase() === value)
    ?? Object.keys(catalogs).find(key => key.toLowerCase().split('-')[0] === value.split('-')[0])
    ?? 'en'
}

export function voiceText(locale, key, values) {
  const source = english[key]
  if (!source) throw new Error(`Unknown voice text: ${key}`)
  const entry = catalogs[catalogLocale(locale)]?.[key]
  const message = entry?.source === source && entry.text ? entry.text : source
  return message.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? `{${name}}`))
}
