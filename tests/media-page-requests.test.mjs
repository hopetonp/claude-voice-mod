import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Chrome keeps a request open until its reply is read. The page's state updates go out four times a
// second, so an unread reply there stopped every request the page made after about an hour.
test("the media page reads the reply to every state update it sends", async () => {
  const source = await readFile(new URL('../media/main.js', import.meta.url), 'utf8')
  const publish = source.slice(source.indexOf('async function publish()'), source.indexOf('function caption('))
  assert.match(publish, /const response = await fetch\('\/api\/media-state'/)
  assert.match(publish, /await response\.(arrayBuffer|text|json)\(\)/, 'the reply is read, so the request closes')
})

test('a chime command plays the result tone unless connection sounds are off', async () => {
  const source = await readFile(new URL('../media/main.js', import.meta.url), 'utf8')
  assert.match(source, /command\.action === 'chime'\) \{ if \(connection\?\.statusSounds !== false\) chimes\.play\('result'\) \}/)
  const sounds = await readFile(new URL('../media/status-sounds.js', import.meta.url), 'utf8')
  assert.match(sounds, /if \(tone === 'result'\)/)
})

test('a quiet start or stop (a session switch) plays no connection chime', async () => {
  const source = await readFile(new URL('../media/main.js', import.meta.url), 'utf8')
  assert.match(source, /if \(command\.quiet\) quietUntil = Date\.now\(\) \+ QUIET_MS/)
  assert.match(source, /statusSounds: Date\.now\(\) >= quietUntil && \(connection\?\.statusSounds \?\? true\)/)
})
