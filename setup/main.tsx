import { createRoot } from 'react-dom/client'
import { VoiceSettingsShell } from '@voicemesh/settings-editor'
import { claudeBackend, closePreviewSession } from './client/claude-backend.ts'
import '@voicemesh/settings-editor/style.css'
import './shell.css'

declare global {
  interface Window {
    __TAURI__?: {
      app: { exit: (code: number) => Promise<void> }
      window: { getCurrentWindow: () => { close: () => Promise<void> } }
    }
  }
}

async function closeSettings(): Promise<void> {
  try { await closePreviewSession() } catch { /* Closing must still exit if preview cleanup fails. */ }
  const tauri = window.__TAURI__
  if (!tauri) return
  try { await tauri.app.exit(0) }
  catch { await tauri.window.getCurrentWindow().close() }
}

const locale = new URLSearchParams(location.search).get('locale') || 'en'
document.documentElement.lang = locale
window.addEventListener('pagehide', () => { void closePreviewSession() })

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  const theme = new URLSearchParams(location.search).get('theme')
  if (!theme || theme === 'auto') document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'
})

createRoot(document.getElementById('app')!).render(
  <VoiceSettingsShell backend={claudeBackend} locale={locale} hostName="Claude" voiceSelector="dropdown"
    providers={{ 'openai-live': 'GPT Live', openai: 'OpenAI Realtime', xai: 'xAI Grok', gemini: 'Gemini Live' }}
    onClose={window.__TAURI__ ? () => { void closeSettings() } : undefined} />,
)
