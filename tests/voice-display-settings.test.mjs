import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceDisplaySettings } from '../host/voice-display-settings.js'
import { liveMessageHeight } from '../hooks/live-message.js'

test('multi-line voice settings default to on with eight lines independently of chat bubbles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-display-'))
  try {
    const file = join(root, 'voice-display.json'), settings = createVoiceDisplaySettings(file)
    const chatFile = join(root, 'display.json')
    await writeFile(chatFile, JSON.stringify({ chatBubbles: true }))
    assert.deepEqual(await settings.read(), { multiline: true, maxLines: 8 })
    await writeFile(file, JSON.stringify({ maxLines: 8 }))
    assert.deepEqual(await settings.read(), { multiline: true, maxLines: 8 }, 'existing settings without multiline default to true')
    await writeFile(file, JSON.stringify({ multiline: null, maxLines: 8 }))
    assert.deepEqual(await settings.read(), { multiline: true, maxLines: 8 }, 'existing null values default to true')
    await settings.save({ multiline: true })
    assert.deepEqual(await settings.read(), { multiline: true, maxLines: 8 })
    await settings.save({ maxLines: 3 })
    assert.deepEqual(await settings.read(), { multiline: true, maxLines: 3 })
    for (const value of [0, 11, 1.5, '8', null]) await assert.rejects(settings.save({ maxLines: value }))
    await assert.rejects(settings.save({ multiline: 'true' }))
    assert.equal(JSON.parse(await readFile(file, 'utf8')).maxLines, 3)
    await settings.save({ multiline: false })
    assert.deepEqual(await settings.read(), { multiline: false, maxLines: 3 }, 'an explicit single-line preference overrides the default')
    assert.deepEqual(JSON.parse(await readFile(chatFile, 'utf8')), { chatBubbles: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the live message grows to the selected cap across words, newlines, and long tokens', () => {
  assert.equal(liveMessageHeight('Short message', 80), 1)
  assert.equal(liveMessageHeight('one two three four', 10), 2)
  assert.equal(liveMessageHeight('first\nsecond\nthird', 80, 2), 2)
  assert.equal(liveMessageHeight('x'.repeat(500), 20), 8)
  assert.equal(liveMessageHeight('x'.repeat(500), 20, 4), 4)
  assert.equal(liveMessageHeight('😀'.repeat(8), 4), 2, 'surrogate pairs count as one character')
})
