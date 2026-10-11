import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createTaskLedger } from '../host/task-ledger.js'

const task = (sessionId, id, status = 'queued') =>
  ({ id, text: 'Read the README title', mode: 'submit', status, sessionId, turnId: null, result: null })

test('a claimed voice request survives host restart without becoming queued again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-task-'))
  const file = join(dir, 'task.json')
  try {
    const first = await createTaskLedger(file)
    await first.save(task('claude-1', 'voice-1'))
    await first.save(task('claude-1', 'voice-1', 'claimed'))
    const second = await createTaskLedger(file)
    assert.equal(second.get('claude-1').status, 'claimed')
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('each session keeps its own task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-task-'))
  const file = join(dir, 'task.json')
  try {
    const ledger = await createTaskLedger(file)
    await ledger.save(task('session-a', 'a-1', 'running'))
    await ledger.save(task('session-b', 'b-1'))
    assert.equal(ledger.get('session-a').id, 'a-1')
    assert.equal(ledger.get('session-b').id, 'b-1')
    assert.equal(ledger.get('session-c'), null)
    assert.deepEqual(ledger.all().map(item => item.id).sort(), ['a-1', 'b-1'])
    const reloaded = await createTaskLedger(file)
    assert.equal(reloaded.get('session-a').status, 'running')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a task file from before sessions loads as that session\'s task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-task-'))
  const file = join(dir, 'task.json')
  try {
    await writeFile(file, JSON.stringify(task('claude-old', 'old-1', 'complete')))
    const ledger = await createTaskLedger(file)
    assert.equal(ledger.get('claude-old').id, 'old-1')
    await ledger.save(task('claude-new', 'new-1'))
    assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf8')).tasks).sort(), ['claude-new', 'claude-old'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
