import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CLAIM_START_TIMEOUT_MS } from '../host/claim-recovery.js'
import { finishedTranscript } from './host-recovery-fixture.js'

// The real host on a free port, with its files in a temporary folder and no media browser.
async function startHost({ transcripts, tasks, claudeTranscript } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-host-'))
  await mkdir(join(dir, 'claude-projects', 'fixture'), { recursive: true })
  if (claudeTranscript) await writeFile(join(dir, 'claude-projects', 'fixture', `${claudeTranscript.sessionId}.jsonl`), claudeTranscript.text)
  if (transcripts) await writeFile(join(dir, 'transcripts.json'), JSON.stringify(transcripts))
  if (tasks) await writeFile(join(dir, 'task.json'), JSON.stringify({ tasks }))
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, ['host/server.js'], { stdio: 'ignore', env: { ...process.env,
    VOICE_HOST_PORT: String(port), VOICE_MEDIA_BROWSER: '/usr/bin/true',
    VOICEMESH_CONNECTION_FILE: join(dir, 'connection.json'), COMPOSER_SETTINGS_FILE: join(dir, 'providers.json'),
    VOICEMESH_TASK_FILE: join(dir, 'task.json'), VOICEMESH_RESULT_FILE: join(dir, 'results.json'),
    VOICEMESH_TRANSCRIPT_FILE: join(dir, 'transcripts.json'), VOICEMESH_CLAUDE_PROJECTS: join(dir, 'claude-projects') } })
  let connection
  for (let i = 0; i < 100 && !connection; i++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    connection = await readFile(join(dir, 'connection.json'), 'utf8').then(JSON.parse).catch(() => null)
  }
  const call = async (method, path, body) => {
    const response = await fetch(connection.url + path, { method, headers: { Authorization: `Bearer ${connection.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  const stop = async () => { child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }) }
  return { call, stop, child, dir }
}

const request = (sessionId, id) => ({ id, text: `Work for ${sessionId}`, mode: 'submit', sessionId })

test('a completed turn missed during reload heals from its exact Claude transcript', async () => {
  const task = { ...request('session-a', 'lost-completion'), status: 'running', turnId: 'desktop-turn',
    claimedAt: 1000, result: null, playbackId: 1 }
  const host = await startHost({ tasks: { 'session-a': task },
    claudeTranscript: { sessionId: task.sessionId, text: finishedTranscript(task) } })
  try {
    await host.call('POST', '/api/claude/select', { sessionId: task.sessionId })
    assert.equal((await host.call('GET', '/api/claude/status')).body.taskStatus, 'complete')
    const diagnostics = (await host.call('GET', '/api/claude/diagnostics')).body
    assert.equal(diagnostics.task.recoveryEvidence, 'claude-transcript-completion')
    assert.equal(diagnostics.task.canRelease, false)
    assert.equal((await host.call('GET', '/api/pipeline/owed')).body.result.text, 'Recovered answer.')
    await host.call('POST', '/api/pipeline/played', { playbackId: 1 })
    assert.equal((await host.call('POST', '/api/claude/request', request('session-a', 'next-request'))).status, 202)
  } finally { await host.stop() }
})

test('result acknowledgements are idempotent without overwriting a newer task', async () => {
  const host = await startHost()
  try {
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a' })
    await host.call('POST', '/api/claude/request', request('session-a', 'first-request'))
    await host.call('POST', '/api/claude/claim', { id: 'first-request', sessionId: 'session-a' })
    await host.call('POST', '/api/claude/started', { id: 'first-request', sessionId: 'session-a', turnId: 'first-turn' })
    const result = { id: 'first-request', sessionId: 'session-a', turnId: 'first-turn', status: 'complete', text: 'Done.' }
    assert.equal((await host.call('POST', '/api/claude/result', result)).status, 200)
    await host.call('POST', '/api/pipeline/played', { playbackId: 1 })
    await host.call('POST', '/api/claude/request', request('session-a', 'next-request'))
    assert.equal((await host.call('POST', '/api/claude/result', result)).status, 200)
    assert.equal((await host.call('GET', '/api/claude/request?sessionId=session-a')).body.task.id, 'next-request')
    assert.equal((await host.call('POST', '/api/claude/result', { ...result, turnId: 'wrong-turn' })).status, 409)
    assert.equal((await host.call('POST', '/api/claude/result', { ...result, text: 'Different result.' })).status, 409)
  } finally { await host.stop() }
})

test('manual backup requires confirmation and the exact selected task; age does not release it', async () => {
  const task = { ...request('session-a', 'running-request'), status: 'running', turnId: 'active-turn',
    claimedAt: 1000, result: null, playbackId: 1 }
  const host = await startHost({ tasks: { 'session-a': task } })
  try {
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a' })
    assert.equal((await host.call('GET', '/api/claude/status')).body.taskStatus, 'running')
    const release = { sessionId: 'session-a', id: task.id, turnId: task.turnId, confirmRelease: true }
    for (const invalid of [{ ...release, confirmRelease: false }, { ...release, id: 'outdated-request' },
      { ...release, sessionId: 'session-b' }, { ...release, turnId: 'outdated-turn' }]) {
      assert.equal((await host.call('POST', '/api/claude/release', invalid)).status, 409)
    }
    assert.equal((await host.call('POST', '/api/claude/release', release)).status, 200)
    assert.equal((await host.call('GET', '/api/pipeline/owed')).body.result, null)
    assert.equal((await host.call('POST', '/api/claude/request', request('session-a', 'new-request'))).status, 202)
  } finally { await host.stop() }
})

test('claim and submit-start are separate durable handoff steps', async () => {
  const host = await startHost()
  try {
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a' })
    await host.call('POST', '/api/claude/request', request('session-a', 'voice-one'))
    assert.equal((await host.call('POST', '/api/claude/claim', { id: 'voice-one', sessionId: 'session-a' })).status, 200)
    assert.equal((await host.call('GET', '/api/claude/request?sessionId=session-a')).body.task.submissionState, 'not-started')
    assert.equal((await host.call('POST', '/api/claude/submitting', { id: 'voice-one', sessionId: 'session-a' })).status, 200)
    assert.equal((await host.call('POST', '/api/claude/claim-failed', { id: 'voice-one', sessionId: 'session-a' })).status, 409,
      'an uncertain submission cannot be discarded and replayed')
    assert.equal((await host.call('POST', '/api/claude/started', { id: 'voice-one', sessionId: 'session-a', turnId: 'turn-one' })).status, 200)
    assert.equal((await host.call('GET', '/api/claude/status')).body.taskStatus, 'running')
    await host.call('POST', '/api/claude/request', request('session-b', 'voice-two'))
    await host.call('POST', '/api/claude/claim', { id: 'voice-two', sessionId: 'session-b' })
    assert.equal((await host.call('POST', '/api/claude/claim-failed', { id: 'voice-two', sessionId: 'session-b' })).status, 200)
    assert.equal((await host.call('POST', '/api/claude/request', request('session-b', 'voice-three'))).status, 202)
  } finally { await host.stop() }
})

test('an expired claim without a Claude turn stops blocking new coding requests', async () => {
  const sessionId = 'session-a'
  const host = await startHost({ tasks: { [sessionId]: {
    ...request(sessionId, 'old-claim'), status: 'claimed', turnId: null, result: null,
    claimedAt: Date.now() - CLAIM_START_TIMEOUT_MS - 1000,
  } } })
  try {
    await host.call('POST', '/api/claude/select', { sessionId })
    assert.equal((await host.call('GET', '/api/claude/status')).body.taskStatus, 'failed')
    assert.equal((await host.call('GET', `/api/claude/request?sessionId=${sessionId}`)).body.task, null)
    assert.equal((await host.call('POST', '/api/claude/request', request(sessionId, 'new-request'))).status, 202)
    assert.equal((await host.call('GET', `/api/claude/request?sessionId=${sessionId}`)).body.task.id, 'new-request')
  } finally { await host.stop() }
})

test('each session runs its own voice job, and a background result is listed as waiting', async () => {
  const host = await startHost()
  try {
    assert.equal((await host.call('POST', '/api/claude/select', { sessionId: 'session-a', cwd: '/p/chopitup' })).body.changed, true)
    assert.equal((await host.call('POST', '/api/claude/request', request('session-a', 'a-1'))).status, 202)
    assert.equal((await host.call('POST', '/api/claude/select', { sessionId: 'session-b', cwd: '/p/codex-voice-mod' })).status, 200)
    assert.equal((await host.call('POST', '/api/claude/request', request('session-b', 'b-1'))).status, 202,
      'a job in B while A still has one')
    assert.equal((await host.call('GET', '/api/claude/request?sessionId=session-a')).body.task.id, 'a-1')
    assert.equal((await host.call('GET', '/api/claude/request?sessionId=session-b')).body.task.id, 'b-1')
    // A's job runs and finishes while B is selected.
    await host.call('POST', '/api/claude/claim', { id: 'a-1', sessionId: 'session-a' })
    await host.call('POST', '/api/claude/started', { id: 'a-1', sessionId: 'session-a', turnId: 'turn-a' })
    assert.equal((await host.call('POST', '/api/claude/result', { id: 'a-1', sessionId: 'session-a', turnId: 'turn-a',
      status: 'complete', text: 'README title is Claude Voice Mod' })).status, 200)
    const state = (await host.call('GET', '/api/state')).body
    assert.equal(state.selectedSession, 'session-b')
    assert.deepEqual(state.waitingResults.map(({ finishedAt, title, ...rest }) => rest), [{ sessionId: 'session-a', folder: 'chopitup' }])
    assert.ok(state.waitingResults[0].finishedAt > 0, 'a result that finished away carries when it finished')
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a', cwd: '/p/chopitup' })
    assert.deepEqual((await host.call('GET', '/api/state')).body.waitingResults, [], 'A is selected again; its result is no longer elsewhere')
  } finally { await host.stop() }
})

test('the old session route never refuses a newer session', async () => {
  const host = await startHost()
  try {
    await host.call('POST', '/api/claude/session', { sessionId: 'session-a' })
    await host.call('POST', '/api/claude/request', request('session-a', 'a-1'))
    assert.equal((await host.call('POST', '/api/claude/session', { sessionId: 'session-b' })).status, 200)
    assert.equal((await host.call('GET', '/api/state')).body.selectedSession, 'session-b')
  } finally { await host.stop() }
})

test('each session keeps its own voice state: leaving one with voice on does not turn it on in the next', async () => {
  const host = await startHost()
  try {
    let cursor = 0
    const issued = async () => {
      const { body } = await host.call('GET', `/api/commands?after=${cursor}`)
      cursor = body.commands.at(-1)?.id ?? cursor
      quiet.push(...body.commands.map(command => command.quiet === true))
      return body.commands.map(command => command.action)
    }
    const quiet = []
    const page = phase => host.call('POST', '/api/media-state', { phase, muted: false, level: 0 })
    await page('idle')
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a', cwd: '/p/a' })
    await host.call('POST', '/api/control', { action: 'start' })
    assert.deepEqual(await issued(), ['start'])
    await page('listening')
    await host.call('POST', '/api/claude/select', { sessionId: 'session-b', cwd: '/p/b' })
    assert.deepEqual(await issued(), ['stop'], 'B never had voice on, so voice goes off')
    await page('idle')
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a', cwd: '/p/a' })
    assert.deepEqual(await issued(), ['start'], 'A had voice on when it was left, so it comes back on')
    await page('listening')
    await host.call('POST', '/api/control', { action: 'stop' })
    await issued()
    await page('idle')
    await host.call('POST', '/api/claude/select', { sessionId: 'session-b', cwd: '/p/b' })
    await host.call('POST', '/api/claude/select', { sessionId: 'session-a', cwd: '/p/a' })
    assert.deepEqual(await issued(), [], 'A was turned off by hand, so it stays off')
    assert.deepEqual(quiet, [false, true, true, false], 'switching sessions starts and stops quietly; by hand it chimes')
  } finally { await host.stop() }
})

test("the captions route carries each spoken turn's routing record, for that session only", async () => {
  const caption = { sessionId: 'session-a', id: 'caption:u1', role: 'user', text: 'Read the README', delegated: true,
    final: true, spokenAt: 200, createdRevision: 1, revision: 1 }
  const turn = { sessionId: 'session-a', id: 'turn:t1', state: 'coding', offsetAt: 300, settledAt: 400,
    requestId: 'request:r1', mode: 'dispatch', userCaptionIds: ['caption:u1'], revision: 2 }
  const host = await startHost({ transcripts: { revision: 2, rows: [caption], turns: [turn,
    { ...turn, sessionId: 'session-b', id: 'turn:other', revision: 2 }] } })
  try {
    const { body } = await host.call('GET', '/api/captions?sessionId=session-a')
    assert.equal(body.revision, 2)
    const { sessionId, ...expected } = turn
    assert.deepEqual(body.turns, [expected])
  } finally { await host.stop() }
})

test('host exits and removes discovery on shutdown even with an open socket', { timeout: 10000 }, async () => {
  const { createConnection } = await import('node:net')
  const host = await startHost()
  const connection = JSON.parse(await readFile(join(host.dir, 'connection.json'), 'utf8'))
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(connection.url).port) })
  await once(socket, 'connect')
  // Hold an incomplete HTTP request open across shutdown.
  socket.write('GET /api/state HTTP/1.1\r\nHost: localhost\r\n')
  try {
    const exited = once(host.child, 'exit')
    host.child.kill('SIGTERM')
    const [code] = await exited
    assert.equal(code, 0)
    await assert.rejects(readFile(join(host.dir, 'connection.json')), { code: 'ENOENT' })
  } finally {
    socket.destroy()
    await host.stop()
  }
})
