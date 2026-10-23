import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopRunning, watchDesktop } from '../host/desktop-lifecycle.js'

const macMain = '/Applications/Claude.app/Contents/MacOS/Claude'
const probe = (platform, stdout) => desktopRunning({ platform, execute: async () => ({ stdout }) })

test('macOS detects the main desktop app, excluding helpers and Claude Code', async () => {
  assert.equal(await probe('darwin', `${macMain}\n`), true)
  assert.equal(await probe('darwin', '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper\n/usr/local/bin/claude\n'), false)
})

test('Windows detects Claude.exe without confusing claude CLI or a missing process', async () => {
  assert.equal(await probe('win32', '"Claude.exe","123","Console","1","50,000 K"\r\n'), true)
  assert.equal(await probe('win32', 'INFO: No tasks are running which match the specified criteria.\r\n'), false)
  assert.equal(await probe('win32', '"claude-code.exe","123"\n'), false)
})

test('an unavailable process query is unknown, not desktop exit', async () => {
  assert.equal(await desktopRunning({ platform: 'win32', execute: async () => { throw new Error('fixture timeout') } }), null)
})

test('desktop shutdown requires consecutive absences and runs only once', async () => {
  const states = [false, true, false, null, false, false]
  let probes = 0
  let exits = 0
  const stopped = new Promise(resolve => {
    const cancel = watchDesktop({ intervalMs: 5, probe: async () => { probes++; return states.shift() },
      onExit: () => { exits++; resolve(cancel) } })
  })
  // Keep the test alive while the production watcher correctly uses an unref timer.
  const keepAlive = setTimeout(() => {}, 1000)
  try {
    const cancel = await stopped
    cancel()
    assert.equal(probes, 6)
    assert.equal(exits, 1)
  } finally { clearTimeout(keepAlive) }
})


test('desktop session attach restarts macOS and both Windows package layouts', async () => {
  const { register } = await import('../hooks/register.js')
  for (const layout of ['mac', 'windows-mod', 'windows-full']) {
    const events = new Map()
    const spawned = []
    register((name, callback) => events.set(name, callback))
    const env = { HOME: '/home/user', LOCALAPPDATA: '/local' }
    const install = '/local/VoiceMesh/ClaudeVoice'
    const $ = {
      plugin: { root: '/plugin' },
      env: { get: async key => env[key] },
      fs: {
        exists: async path => path === (layout === 'mac'
          ? '/home/user/Library/LaunchAgents/com.voicemesh.claude-host.plist'
          : `${layout === 'windows-mod' ? '/plugin' : install}/runtime/node.exe`),
        read: async () => { throw new Error('No host discovery') },
      },
      process: { spawn: options => (async function* () { spawned.push(options.argv) })() },
    }
    await events.get('session.attach')($, { surface: 'desktop' }, async event => event)
    assert.deepEqual(spawned, [layout === 'mac'
      ? ['/bin/launchctl', 'start', 'com.voicemesh.claude-host']
      : [`${layout === 'windows-mod' ? '/plugin' : install}/runtime/node.exe`,
        `${layout === 'windows-mod' ? '/plugin' : install}/app/scripts/launch-host.js`]])
  }
})
