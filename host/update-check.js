import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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

/** An install action belongs to the Claude chat that opened the dialog. */
export function createUpdateInstalls() {
  const pending = new Map()
  return {
    request(sessionId, version) {
      if (!sessionId) throw new Error('Open Voice settings from a Claude chat first')
      if (!stableVersion.test(version)) throw new Error('Invalid update version')
      const existing = pending.get(sessionId)
      if (existing) return existing
      const request = { id: randomUUID(), sessionId, version,
        text: `Install VoiceMesh Claude Mod version ${version} on this computer. Follow https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md using the published v${version} installer for this platform. Verify its SHA-256 checksum, run the installer, preserve saved settings and credentials, verify the installed Mod and host versions, and tell me whether Claude must restart. Do not build from source or change this project's code.` }
      pending.set(sessionId, request)
      return request
    },
    get(sessionId) { return pending.get(sessionId) ?? null },
    claim(sessionId, id) {
      const request = pending.get(sessionId)
      if (!request || request.id !== id) return null
      pending.delete(sessionId)
      return request
    },
  }
}
