import { createRoot } from 'react-dom/client'
import { useLayoutEffect } from 'react'
import { VoiceSettingsShell } from '@voicemesh/settings-editor'
import { claudeBackend, closePreviewSession } from './client/claude-backend.ts'
import { dismissSettings, settingsReady, type SettingsWindowApi } from '@voicemesh/composer/desktop'
import '@voicemesh/settings-editor/style.css'
import './shell.css'

declare global {
  interface Window {
    __TAURI__?: SettingsWindowApi
  }
}

async function closeSettings(): Promise<void> {
  await dismissSettings(window.__TAURI__, closePreviewSession)
}

const locale = new URLSearchParams(location.search).get('locale') || 'en'
document.documentElement.lang = locale
window.addEventListener('pagehide', () => { void closePreviewSession() })

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  const theme = new URLSearchParams(location.search).get('theme')
  if (!theme || theme === 'auto') document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'
})

function SettingsApp() {
  useLayoutEffect(() => {
    // This runs after the shell is in the DOM, without an arbitrary timer or a
    // dependency on remote catalogs. The native window has already been positioned.
    void settingsReady(window.__TAURI__).catch(error => {
      // Older installed windows are already visible and don't implement this command.
      console.debug('Settings ready signal unavailable', error)
    })
  }, [])
  return <VoiceSettingsShell backend={claudeBackend} locale={locale} hostName="Claude" voiceSelector="dropdown"
    providers={{ 'openai-live': 'GPT Live', openai: 'OpenAI Realtime', xai: 'xAI Grok', gemini: 'Gemini Live' }}
    onClose={window.__TAURI__ ? () => { void closeSettings() } : undefined} />
}

createRoot(document.getElementById('app')!).render(<SettingsApp />)
