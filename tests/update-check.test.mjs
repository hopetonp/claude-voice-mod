import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate, upgradeUrl, installedVersion, createUpdateInstalls } from '../host/update-check.js'

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


test('install requests are scoped to their originating chat, deduplicated, and claimed once', () => {
  const requests = createUpdateInstalls()
  assert.throws(() => requests.request(null, '0.1.222'), /Claude chat/)
  assert.throws(() => requests.request('owner', 'bad'), /Invalid update version/)
  const request = requests.request('owner', '0.1.222')
  assert.equal(requests.request('owner', '0.1.222'), request)
  assert.equal(requests.get('other'), null)
  assert.equal(requests.claim('other', request.id), null)
  assert.equal(requests.claim('owner', 'wrong'), null)
  assert.match(request.text, /Install VoiceMesh Claude Mod version 0.1.222/)
  assert.match(request.text, /Verify its SHA-256 checksum/)
  assert.equal(requests.claim('owner', request.id), request)
  assert.equal(requests.claim('owner', request.id), null)
})

test('the originating chat receives one install request while voice is off', async () => {
  const requests = createUpdateInstalls()
  const request = requests.request('owner', '0.1.222')
  const { register } = await import('../hooks/register.js?update-install')
  const handlers = new Map(), submitted = []
  register((name, options, handler) => handlers.set(name, handler ?? options))
  let poll
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
    session: { id: async () => 'owner', cwd: async () => '/project', surfaces: async () => [] },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { poll = callback } },
    ui: { invalidate() {}, toast() {} },
    prompt: { submit: async value => { submitted.push(value); return {} } },
    http: { fetch: async (url, init) => {
      const parsed = new URL(url)
      const data = parsed.pathname === '/api/state'
        ? { phase: 'idle', mediaConnected: true, voiceConfigured: true, selectedSession: 'other', captionRevision: 0,
            updateInstall: requests.get(parsed.searchParams.get('sessionId')) }
        : parsed.pathname === '/api/updates/install/claim'
          ? { request: requests.claim(JSON.parse(init.body).sessionId, JSON.parse(init.body).id) }
          : parsed.pathname === '/api/captions' ? { revision: 0, rows: [] } : { task: null }
      return { ok: true, text: JSON.stringify(data) }
    } },
  }
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }
  await handlers.get('session.start')($, {}, async () => {})
  await settle(); poll(); await settle(); poll(); await settle()
  assert.deepEqual(submitted, [{ text: request.text, asUser: true }])
})
