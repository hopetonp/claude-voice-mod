import assert from 'node:assert/strict'
import test from 'node:test'
import { install } from '../npm-installer/install.mjs'

test('download progress is visible and checksum failure never claims installation succeeded', async () => {
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const messages = []
  try {
    globalThis.fetch = async () => new Response(Buffer.alloc(1100000), { headers: { 'Content-Length': '1100000' } })
    console.error = value => messages.push(value)
    await assert.rejects(install(), /checksum does not match/)
    assert.match(messages.join('\n'), /Downloading.*Downloaded.*Verifying/s)
    assert.doesNotMatch(messages.join('\n'), /Checksum verified|installed\. Restart/)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalError
  }
})
