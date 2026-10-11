import assert from 'node:assert/strict'
import test from 'node:test'
import { dismissSettings } from '@voicemesh/composer/desktop'

function nativeWindow({ failExit = false } = {}) {
  const calls = []
  return { calls, api: {
    app: { async exit(code) { calls.push(['exit', code]); if (failExit) throw new Error('Exit unavailable') } },
    window: { getCurrentWindow: () => ({ async close() { calls.push(['close']) } }) },
  } }
}

test('a stalled preview cleanup cannot prevent the native popup from exiting', async () => {
  const native = nativeWindow()
  await dismissSettings(native.api, () => new Promise(() => {}), 10)
  assert.deepEqual(native.calls, [['exit', 0]])
})

test('failed preview cleanup still exits the popup', async () => {
  const native = nativeWindow()
  await dismissSettings(native.api, async () => { throw new Error('Host offline') })
  assert.deepEqual(native.calls, [['exit', 0]])
})

test('older or denied exit APIs fall back to closing the native window', async () => {
  const native = nativeWindow({ failExit: true })
  await dismissSettings(native.api, async () => {})
  assert.deepEqual(native.calls, [['exit', 0], ['close']])
})

test('browser settings clean up without calling native APIs', async () => {
  let cleaned = false
  await dismissSettings(undefined, async () => { cleaned = true })
  assert.equal(cleaned, true)
})
