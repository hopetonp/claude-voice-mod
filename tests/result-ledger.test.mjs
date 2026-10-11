import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResultLedger } from '../host/result-ledger.js'
import { pendingLiveResultPlayback, observeLiveResultPlayback, liveResultPlaybackSettled } from '@voicemesh/composer/browser'

test('unplayed coding results survive a restart and playback clears only their owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-results-'))
  const file = join(dir, 'results.json')
  try {
    const first = await createResultLedger(file)
    const one = await first.allocate()
    await first.record({ id: 'request-one', sessionId: 'claude-one', playbackId: one,
      status: 'complete', result: 'The README title is Claude Voice Mod.' })
    const two = await first.allocate()
    await first.record({ id: 'request-two', sessionId: 'claude-two', playbackId: two,
      status: 'failed', result: 'The task failed.' })
    const three = await first.allocate()
    await first.record({ id: 'request-three', sessionId: 'claude-one', playbackId: three,
      status: 'complete', result: 'The follow-up is complete.' })

    const recovered = await createResultLedger(file)
    await recovered.record({ id: 'request-one', sessionId: 'claude-one', playbackId: one,
      status: 'complete', result: 'The README title is Claude Voice Mod.' })
    assert.deepEqual(recovered.owed('claude-one').map(row => row.text), [
      'The README title is Claude Voice Mod.', 'The follow-up is complete.',
    ])
    assert.equal(await recovered.markPlayed(one, 'claude-two'), false)
    assert.equal(await recovered.markPlayed(one, 'claude-one'), true)
    assert.deepEqual(recovered.owed('claude-one').map(row => row.id), ['request-three'])
    assert.deepEqual(recovered.owed('claude-two').map(row => row.id), ['request-two'])
    assert.equal(recovered.latest('claude-one').text, 'The follow-up is complete.')
    assert.equal(recovered.latest('claude-two').text, 'The task failed.')
    assert.equal(recovered.latest('unknown'), null)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Composer settles a result only after acceptance, caption, and playback', () => {
  let playback = pendingLiveResultPlayback(7, false)
  playback = observeLiveResultPlayback(playback, 'accepted')
  playback = observeLiveResultPlayback(playback, 'caption')
  assert.equal(liveResultPlaybackSettled(playback), false)
  playback = observeLiveResultPlayback(playback, { speaking: true })
  playback = observeLiveResultPlayback(playback, { speaking: false })
  assert.equal(liveResultPlaybackSettled(playback), true)
})
