import assert from 'node:assert/strict'
import test from 'node:test'
import { speechClock } from '../host/voice-server.js'

test("GPT Live captions are stamped with when they were spoken on the session's clock", () => {
  let now = 50_000
  const clock = speechClock(() => now)
  clock.start()
  now = 99_000
  assert.equal(clock.stamp('user:a', 1200), 51_200)
  // A later piece of the same caption keeps it as early as its first piece.
  assert.equal(clock.stamp('user:a', 2400), 51_200)
  // An earlier piece that arrives late moves it earlier.
  assert.equal(clock.stamp('user:a', 800), 50_800)
  assert.equal(clock.stamp('assistant:b', 2000), 52_000)
  // The final caption at close carries no piece and keeps its stamp.
  assert.equal(clock.stamp('assistant:b'), 52_000)
})
