import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

export function settingsWindowBinary(platform = process.platform, env = process.env) {
  const name = platform === 'win32' ? 'voicemesh-settings-window.exe' : 'voicemesh-settings-window'
  return [env.VOICE_SETTINGS_WINDOW_BINARY,
    ...(platform === 'darwin' ? [join(root, 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app', 'Contents', 'MacOS', name)] : []),
    join(root, 'settings-window', 'src-tauri', 'target', 'release', name)]
    .filter(Boolean).find(existsSync) ?? null
}

export async function openSettingsWindow(url) {
  const binary = settingsWindowBinary()
  if (!binary) throw new Error('VoiceMesh settings window is not built; run npm run settings:window:build')
  // Each launch focuses the existing window through Tauri's single-instance hook.
  // It keeps unsaved form state when the URL is unchanged, and updates Claude's theme or locale when it changes.
  const child = spawn(binary, [url], { stdio: 'ignore', windowsHide: true })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}
