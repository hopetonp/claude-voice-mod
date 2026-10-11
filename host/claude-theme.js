import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export function claudeDesktopConfigPath(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'config.json')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'config.json')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'config.json')
}

export async function claudeDesktopTheme(path = claudeDesktopConfigPath(), read = readFile, platform = process.platform, run = execFile) {
  try {
    const { userThemeMode } = JSON.parse(await read(path, 'utf8'))
    if (userThemeMode === 'dark' || userThemeMode === 'light') return userThemeMode
  } catch {
    // The app can still follow the operating system without a readable config.
  }
  try {
    if (platform === 'darwin') {
      const { stdout } = await run('defaults', ['read', '-g', 'AppleInterfaceStyle'])
      return stdout.trim() === 'Dark' ? 'dark' : 'light'
    }
    if (platform === 'win32') {
      // /api/state is polled frequently. A console for each registry query steals
      // focus and flashes the taskbar even when the Settings window is closed.
      const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { windowsHide: true })
      return /AppsUseLightTheme\s+REG_DWORD\s+0x0(?:\s|$)/i.test(stdout) ? 'dark' : 'light'
    }
    const { stdout } = await run('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'])
    return stdout.includes('prefer-dark') ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export async function claudeDesktopLocale(path = claudeDesktopConfigPath(), read = readFile) {
  try {
    const { locale } = JSON.parse(await read(path, 'utf8'))
    return typeof locale === 'string' && /^[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/i.test(locale) ? locale : 'en'
  } catch {
    return 'en'
  }
}
