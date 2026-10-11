import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { desktopSystemTheme } from '@voicemesh/composer/desktop/server'

export function claudeDesktopConfigPath(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'config.json')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'config.json')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'config.json')
}

export async function claudeDesktopTheme(path = claudeDesktopConfigPath(), read = readFile, platform = process.platform, run) {
  try {
    const { userThemeMode } = JSON.parse(await read(path, 'utf8'))
    if (userThemeMode === 'dark' || userThemeMode === 'light') return userThemeMode
  } catch {
    // The app can still follow the operating system without a readable config.
  }
  return desktopSystemTheme(platform, run)
}

export async function claudeDesktopLocale(path = claudeDesktopConfigPath(), read = readFile) {
  try {
    const { locale } = JSON.parse(await read(path, 'utf8'))
    return typeof locale === 'string' && /^[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/i.test(locale) ? locale : 'en'
  } catch {
    return 'en'
  }
}
