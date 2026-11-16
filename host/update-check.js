import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const stableVersion = /^\d+\.\d+\.\d+$/
const installedPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/

export async function installedVersion() {
  // Source checkouts carry the manifest; packaged app/ sits beside release.json.
  for (const path of ['../.claude-plugin/plugin.json', '../../release.json']) {
    try {
      const { version } = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
      if (installedPattern.test(version)) return version
    } catch { /* Try the packaged version next. */ }
  }
  throw new Error('Installed VoiceMesh version is unavailable')
}

export function upgradeUrl(version, platform = process.platform, arch = process.arch) {
  if (!stableVersion.test(version)) throw new Error('Invalid update version')
  const packageName = { 'darwin-arm64': 'macos-arm64', 'darwin-x64': 'macos-x64', 'win32-x64': 'win-x64' }[`${platform}-${arch}`]
  const release = `https://github.com/hopetonp/claude-voice-mod/releases`
  return packageName ? `${release}/download/v${version}/voicemesh-claude-${packageName}-${version}.zip` : `${release}/tag/v${version}`
}

export async function checkForUpdate({ currentVersion, fetchImpl = fetch, platform, arch } = {}) {
  const current = currentVersion ?? await installedVersion()
  if (!installedPattern.test(current)) throw new Error('Invalid installed version')
  const response = await fetchImpl('https://registry.npmjs.org/claude-voice-mod/latest', {
    signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  })
  if (!response.ok) throw new Error(`npm update check failed (${response.status})`)
  const { version: latest } = await response.json()
  if (!stableVersion.test(latest)) throw new Error('npm returned an invalid version')
  const installed = current.split('-')[0].split('.').map(Number)
  const published = latest.split('.').map(Number)
  let comparison = 0
  for (let i = 0; i < 3 && !comparison; i++) comparison = Math.sign(published[i] - installed[i])
  const updateAvailable = comparison > 0 || (comparison === 0 && current.includes('-'))
  return { current, latest, updateAvailable, upgradeUrl: updateAvailable ? upgradeUrl(latest, platform, arch) : null }
}

export async function openUpgrade(version) {
  // Never open a caller-supplied URL or invoke a command shell.
  const url = upgradeUrl(version)
  if (process.platform === 'darwin') await run('open', [url])
  else if (process.platform === 'win32') await run('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true })
  else await run('xdg-open', [url])
}
