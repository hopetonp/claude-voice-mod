import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openaiLiveProvider } from '@voicemesh/composer/server'
import { createTranscriptLedger } from '../host/transcript-ledger.js'

test('caption revisions and delegation survive a host restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-transcripts-'))
  const file = join(dir, 'transcripts.json')
  try {
    const first = await createTranscriptLedger(file)
    await first.record('claude-1', { id: 'user-1', role: 'user', text: 'Read the README' })
    await first.record('claude-1', { id: 'user-1', role: 'user', text: 'Read the README title' })
    await first.markDelegated('claude-1', 'Read the README title')
    await first.record('claude-1', { id: 'reply-1', role: 'assistant', text: 'The title is Claude Voice Mod.' })
    await first.record('claude-1', { id: 'user-2', role: 'user', text: 'Thanks' })
    await first.record('claude-2', { id: 'other-user', role: 'user', text: 'A different session' })
    const revision = first.revision('claude-1')
    const second = await createTranscriptLedger(file)
    assert.equal(second.revision('claude-1'), revision)
    assert.deepEqual(second.rows('claude-1').map(row => [row.id, row.text, row.delegated]), [
      ['user-1', 'Read the README title', true],
      ['reply-1', 'The title is Claude Voice Mod.', false],
      ['user-2', 'Thanks', false],
    ])
    assert.deepEqual(second.history('claude-1'), [
      { role: 'user', text: 'Read the README title' },
      { role: 'assistant', text: 'The title is Claude Voice Mod.' },
      { role: 'user', text: 'Thanks' },
    ])
    const protocol = openaiLiveProvider.create({ key: 'test-only', model: 'test-model', voice: 'test-voice',
      instructions: 'Test', startupHistory: second.history('claude-1') })
    assert.deepEqual(protocol.setup.session.input.map(message => message.role), ['user', 'assistant', 'user'])
    assert.equal(protocol.setup.session.input[0].content[0].text, 'Read the README title')
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a final caption phase is kept so the Mod knows the utterance is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-transcripts-'))
  const file = join(dir, 'transcripts.json')
  try {
    const ledger = await createTranscriptLedger(file)
    await ledger.record('claude-1', { id: 'user-1', role: 'user', text: 'Hello there', phase: 'update' })
    assert.equal(ledger.rows('claude-1')[0].final, false)
    const before = ledger.revision('claude-1')
    await ledger.record('claude-1', { id: 'user-1', role: 'user', text: 'Hello there', phase: 'final' })
    assert.equal(ledger.rows('claude-1')[0].final, true)
    assert(ledger.revision('claude-1') > before, 'finalizing unchanged text is still a new revision')
    await ledger.record('claude-1', { id: 'user-1', role: 'user', text: 'Hello there', phase: 'update' })
    assert.equal(ledger.rows('claude-1')[0].final, true, 'a late update does not reopen a final row')
    const reloaded = await createTranscriptLedger(file)
    assert.equal(reloaded.rows('claude-1')[0].final, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('pipeline coding admission links the claimed task to its spoken caption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-transcripts-'))
  const file = join(dir, 'transcripts.json')
  try {
    const ledger = await createTranscriptLedger(file)
    await ledger.record('claude-1', { id: 'old', role: 'user', text: 'Hello' })
    await ledger.record('claude-1', { id: 'request', role: 'user', text: 'Read package.json' })
    await ledger.recordCodingRoute('claude-1', 'task-1', 'Read package.json', true)
    await ledger.recordCodingRoute('claude-1', 'task-1', 'Read package.json', true)
    const reloaded = await createTranscriptLedger(file)
    assert.deepEqual(reloaded.turns('claude-1').filter(turn => turn.requestId === 'task-1')
      .map(turn => ({ state: turn.state, userCaptionIds: turn.userCaptionIds })),
    [{ state: 'coding', userCaptionIds: ['request'] }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('captions are listed in the order they were spoken, not the order they arrived', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-transcripts-'))
  try {
    const ledger = await createTranscriptLedger(join(dir, 'transcripts.json'))
    await ledger.record('claude-1', { id: 'user-1', role: 'user', text: 'It went off. It was', at: 1000 })
    await ledger.record('claude-1', { id: 'reply-1', role: 'assistant', text: 'Good,', at: 1900 })
    // Transcribed after the reply began, but said before it.
    await ledger.record('claude-1', { id: 'user-2', role: 'user', text: 'quiet', at: 1800 })
    assert.deepEqual(ledger.rows('claude-1').map(row => row.id), ['user-1', 'user-2', 'reply-1'])
    // A piece found to be said earlier moves its caption earlier.
    await ledger.record('claude-1', { id: 'reply-1', role: 'assistant', text: 'Good, yes.', at: 1700 })
    assert.deepEqual(ledger.rows('claude-1').map(row => row.id), ['user-1', 'reply-1', 'user-2'])
    assert.deepEqual(ledger.history('claude-1').map(row => row.text), ['It went off. It was', 'Good, yes.', 'quiet'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
