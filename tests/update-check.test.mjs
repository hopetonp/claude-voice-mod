import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate, upgradeUrl, installedVersion } from '../host/update-check.js'

test('npm latest is compared numerically with the installed version without a Claude session', async () => {
  for (const [current, latest, expected] of [
    ['0.1.221', '0.1.221', false], ['0.1.220', '0.1.221', true],
    ['0.1.222', '0.1.221', false], ['0.1.9', '0.1.10', true],
    ['0.2.0', '0.1.999', false], ['0.1.221-dev.1', '0.1.221', true],
  ]) {
    const result = await checkForUpdate({ currentVersion: current, platform: 'win32', arch: 'x64',
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://registry.npmjs.org/claude-voice-mod/latest')
        assert.ok(options.signal instanceof AbortSignal)
        return { ok: true, json: async () => ({ version: latest }) }
      } })
    assert.equal(result.current, current)
    assert.equal(result.latest, latest)
    assert.equal(result.updateAvailable, expected)
    assert.equal(result.upgradeUrl, expected ? upgradeUrl(latest, 'win32', 'x64') : null)
  }
  assert.match(await installedVersion(), /^\d+\.\d+\.\d+/)
})

test('upgrade links target the matching platform and reject invalid versions', () => {
  for (const [platform, arch, name] of [['darwin', 'arm64', 'macos-arm64'], ['darwin', 'x64', 'macos-x64'], ['win32', 'x64', 'win-x64']]) {
    assert.equal(upgradeUrl('0.1.221', platform, arch), `https://github.com/hopetonp/claude-voice-mod/releases/download/v0.1.221/voicemesh-claude-${name}-0.1.221.zip`)
  }
  assert.match(upgradeUrl('0.1.221', 'linux', 'x64'), /releases\/tag\/v0.1.221$/)
  assert.throws(() => upgradeUrl('https://evil.test'), /Invalid update version/)
})

test('registry failures and invalid metadata never report an up-to-date result', async () => {
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.221', fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/)
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.221', fetchImpl: async () => { throw new Error('offline') } }), /offline/)
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.221', fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'bad' }) }) }), /invalid version/)
})
