import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { desktopSystemTheme } from '@voicemesh/composer/desktop/server'

export function claudeDesktopConfigPath(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'config.json')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'config.json')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'config.json')
}

export function claudeDesktopConfigPaths(platform = process.platform, env = process.env, home = homedir()) {
  const paths = [claudeDesktopConfigPath(platform, env, home)]
  if (platform === 'win32') {
    paths.push(join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Packages',
      'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'config.json'))
  }
  return paths
}

async function desktopConfig(path, read, platform) {
  for (const candidate of path === undefined ? claudeDesktopConfigPaths(platform) : [path]) {
    try { return JSON.parse(await read(candidate, 'utf8')) } catch { /* Try the other Windows installation layout. */ }
  }
  return {}
}

export async function claudeDesktopTheme(path, read = readFile, platform = process.platform, run) {
  const { userThemeMode } = await desktopConfig(path, read, platform)
  if (userThemeMode === 'dark' || userThemeMode === 'light') return userThemeMode
  return desktopSystemTheme(platform, run)
}

export async function claudeDesktopLocale(path, read = readFile, platform = process.platform) {
  const { locale } = await desktopConfig(path, read, platform)
  return typeof locale === 'string' && /^[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/i.test(locale) ? locale : 'en'
}
