import { useState } from 'react'
import { createTranslator, VoiceSettingsEditor } from '@voicemesh/settings-editor'
import { claudeBackend } from './claude-backend.ts'
import { CodingDiagnostics } from './coding-diagnostics.tsx'
import { voiceText } from '../../hooks/voice-status-i18n.js'

const sections = ['display', 'provider', 'conversation', 'troubleshooting'] as const
const labels = { display: 'shell.general', provider: 'shell.provider', conversation: 'shell.conversation' }
const descriptions = { display: 'shell.generalSummary', provider: 'shell.providerSummary', conversation: 'shell.conversationSummary' }

/** Claude-specific recovery belongs in the harness, alongside the shared editor. */
export function SettingsShell({ locale, onClose }: { locale: string; onClose?: () => void }) {
  const [section, setSection] = useState<typeof sections[number]>('display')
  const t = createTranslator(locale)
  return <div className="vm-settings-shell">
    {onClose && <div className="window-chrome"><button className="window-close" type="button" aria-label={t('shell.close')} onClick={onClose}>✕</button></div>}
    <div className="settings-layout">
      <nav className="settings-sidebar" aria-label={t('shell.navigation')}>
        <div className="settings-sidebar-label">{t('shell.title')}</div>
        {sections.map(id => <button key={id} type="button" className={`settings-nav-item${section === id ? ' selected' : ''}`}
          aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            {id === 'provider' ? <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 10a6 6 0 0 0 12 0M12 16v5M8 21h8" /></>
              : id === 'conversation' ? <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H4l2.2-3.5A7.5 7.5 0 1 1 20 11.5Z" />
              : id === 'troubleshooting' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16v1" /></>
              : <><circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3M16 8l3-3" /></>}
          </svg>
          <span>{id === 'troubleshooting' ? voiceText(locale, 'troubleshooting.tab') : t(labels[id])}</span>
        </button>)}
      </nav>
      <div className="settings-main">
        <header className="settings-section-header"><h1>{section === 'troubleshooting' ? voiceText(locale, 'troubleshooting.tab') : t(labels[section])}</h1>
          <p>{section === 'troubleshooting' ? voiceText(locale, 'troubleshooting.summary') : t(descriptions[section])}</p></header>
        {section === 'troubleshooting' ? <CodingDiagnostics locale={locale} /> : <VoiceSettingsEditor backend={claudeBackend} locale={locale}
          activeSection={section} voiceSelector="dropdown" title={t('settings.titleForHost', { host: 'Claude' })}
          providers={{ 'openai-live': 'GPT Live', openai: 'OpenAI Realtime', xai: 'xAI Grok', gemini: 'Gemini Live' }} />}
      </div>
    </div>
  </div>
}
