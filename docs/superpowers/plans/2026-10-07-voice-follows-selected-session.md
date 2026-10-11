# Voice Follows the Selected Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One voice, owned by the Claude session the user has selected in the desktop app; each session keeps its own voice conversation, its own voice job, and its own waiting results.

**Architecture:** Each session's plugin reports `session.attach` from the desktop to the host as a selection. The host keeps the selected session, a task slot per session, and per-session results. A selection change while voice is live closes the voice connection and starts a new one for the newly selected session, which already loads that session's history and replays its owed results. Results that finish in other sessions are listed in `/api/state` for a toast, a chime and a count badge in the selected session's strip.

**Tech Stack:** Node 26 (ESM) host on `node:http` + `ws`; Claude Code Mod API v2.1.288+ plugin hooks (plain JS); `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-07-voice-follows-selected-session-design.md`. Every task implements part of it.
- Ownership moves on `session.attach` with `surface === 'desktop'`; a `session.detach` never moves ownership. The newest select wins.
- Each session has its own voice conversation. Switching while voice is live reconnects (a stop, then a start for the new session).
- One voice job per session; any number of sessions at once. A job's progress, result and steering stay with the session it was spoken in.
- Background results: toast `<folder>: result ready` (folder = last path component of the session's cwd), one chime (silenced when the provider setting `statusSounds` is false), badge `● 1 result ready` / `● N results ready`, shown left of the clock until heard.
- The plugins are installed at **user** scope. Update them with `claude plugin update voicemesh-controls@voicemesh-local` (no `--scope`).
- This folder is not a git repository: there are no commit steps. Each task ends with the full suite passing: `node --test tests/*.mjs`.
- The host is restarted only with: `npm run host:install:macos -- --dev-connections /Users/hgp/DeepSeek/voicemesh-composer/playground/.data/connections.json` (rerun once if the first run ends in a Node trace).
- No Haiku subagents. Sonnet is the floor.

## File Structure

- `host/task-ledger.js` (modify): one durable task **per session** instead of one overall; reads the old single-task file.
- `host/voice-sessions.js` (create): the selected session, each session's folder and last check-in, and the waiting-results list. Pure, no I/O.
- `host/server.js` (modify): routes keyed by the requesting session; `/api/claude/select`; reconnect on switch; `/api/state` gains `selectedSession` and `waitingResults`; `/api/control` accepts `chime`.
- `media/main.js`, `media/status-sounds.js` (modify): the `chime` command plays a result tone.
- `hooks/register.js` (modify): select on attach; stop claiming the host at start; draw only while owning; toast, chime and badge.
- Tests: `tests/task-ledger.test.mjs`, `tests/voice-sessions.test.mjs` (new), `tests/host-sessions.test.mjs` (new, runs the real host), `tests/session-ownership.test.mjs` (new, plugin).

---

### Task 1: One durable task per session

**Files:**
- Modify: `host/task-ledger.js`
- Test: `tests/task-ledger.test.mjs`

**Interfaces:**
- Produces: `createTaskLedger(path) → Promise<{ get(sessionId): Task|null, all(): Task[], save(task: Task): Promise<Task> }>`. `save` stores the task under `task.sessionId`, replacing that session's previous task. File format: `{ "tasks": { [sessionId]: Task } }`. A legacy file holding one task object loads as that task's session entry.

- [ ] **Step 1: Write the failing tests** (replace the file's single test with these three)

```js
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/task-ledger.test.mjs`
Expected: FAIL, `second.get is not a function`.

- [ ] **Step 3: Implement** (replace `createTaskLedger` in `host/task-ledger.js`; keep `statuses` and `valid` as they are)

```js
/** One durable Claude request per session, so a restarted host never invents or replays a claim. */
export async function createTaskLedger(path) {
  let tasks = {}
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'))
    // Before sessions, the file held one task; it becomes that task's session entry.
    const entries = stored?.tasks && typeof stored.tasks === 'object' ? Object.values(stored.tasks) : [stored]
    for (const task of entries) {
      if (!valid(task)) throw new Error('Invalid saved Claude voice request')
      tasks[task.sessionId] = task
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let tail = Promise.resolve()
  const save = task => {
    if (!valid(task)) throw new Error('Invalid Claude voice request')
    const next = { ...tasks, [task.sessionId]: task }
    const operation = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(path), `.task-${randomUUID()}`)
      try {
        await writeFile(temporary, JSON.stringify({ tasks: next }) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      tasks = { ...tasks, [task.sessionId]: task }
      return task
    })
    tail = operation.catch(() => {})
    return operation
  }
  return { get: sessionId => tasks[sessionId] ?? null, all: () => Object.values(tasks), save }
}
```

- [ ] **Step 4: Run the task-ledger tests**

Run: `node --test tests/task-ledger.test.mjs`
Expected: PASS (3 tests). `host/server.js` still uses `taskLedger.current`; Task 3 replaces that, so do not restart the host between Tasks 1 and 3.

---

### Task 2: The selected session and waiting results

**Files:**
- Create: `host/voice-sessions.js`
- Test: `tests/voice-sessions.test.mjs`

**Interfaces:**
- Produces: `createVoiceSessions({ now = Date.now } = {}) → { select(sessionId, cwd): boolean /* true when the selection changed */, selected(): string|null, seen(sessionId): void, folder(sessionId): string, waiting(owedSessionIds: string[]): { sessionId, folder }[] }`. `waiting` drops the selected session and sessions not seen for `SESSION_GONE_MS = 60000`. `seen` records any session, including one not yet selected since a host restart (its folder is `''` until it selects). `folder` is the last path component of the cwd given to `select`, or `''`.

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVoiceSessions } from '../host/voice-sessions.js'

test('the newest select owns the voice, and says when it changed', () => {
  const sessions = createVoiceSessions({ now: () => 1000 })
  assert.equal(sessions.selected(), null)
  assert.equal(sessions.select('a', '/Users/x/Projects/chopitup'), true)
  assert.equal(sessions.select('a', '/Users/x/Projects/chopitup'), false, 'selecting the owner again changes nothing')
  assert.equal(sessions.select('b', '/Users/x/DeepSeek/deepseek-harness'), true)
  assert.equal(sessions.selected(), 'b')
  assert.equal(sessions.folder('a'), 'chopitup')
})

test('waiting results leave out the selected session and sessions that are gone', () => {
  let clock = 1000
  const sessions = createVoiceSessions({ now: () => clock })
  sessions.select('a', '/p/chopitup')
  sessions.select('b', '/p/codex-voice-mod')
  sessions.select('c', '/p/deepseek-harness')
  assert.deepEqual(sessions.waiting(['a', 'c']), [{ sessionId: 'a', folder: 'chopitup' }])
  clock = 1000 + 61000
  sessions.seen('c')
  assert.deepEqual(sessions.waiting(['a', 'b']), [], 'a has not checked in for a minute; b checked in last at selection')
  sessions.seen('b')
  sessions.select('c', '/p/deepseek-harness')
  assert.deepEqual(sessions.waiting(['b']), [{ sessionId: 'b', folder: 'codex-voice-mod' }])
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/voice-sessions.test.mjs`
Expected: FAIL, cannot find module `../host/voice-sessions.js`.

- [ ] **Step 3: Implement** `host/voice-sessions.js`

```js
// Which Claude session owns the voice: the one the desktop app last attached to (the user's selection).
// Every session's plugin checks in while it runs, so results owed to a closed session are not announced.

const SESSION_GONE_MS = 60000

export function createVoiceSessions({ now = Date.now } = {}) {
  let selected = null
  const known = new Map() // sessionId -> { folder, seenAt }
  const touch = (sessionId, cwd) => {
    const previous = known.get(sessionId)
    const folder = typeof cwd === 'string' && cwd ? cwd.split('/').filter(Boolean).at(-1) ?? '' : previous?.folder ?? ''
    known.set(sessionId, { folder, seenAt: now() })
  }
  return {
    select(sessionId, cwd) {
      touch(sessionId, cwd)
      if (selected === sessionId) return false
      selected = sessionId
      return true
    },
    selected: () => selected,
    // A session checking in is alive; one the host has not seen select since a restart is known by id only.
    seen(sessionId) { touch(sessionId) },
    folder: sessionId => known.get(sessionId)?.folder ?? '',
    waiting(owedSessionIds) {
      return [...new Set(owedSessionIds)]
        .filter(id => id !== selected && known.has(id) && now() - known.get(id).seenAt < SESSION_GONE_MS)
        .map(id => ({ sessionId: id, folder: known.get(id).folder }))
    },
  }
}
```

- [ ] **Step 4: Run them**

Run: `node --test tests/voice-sessions.test.mjs`
Expected: PASS (2 tests).

---

### Task 3: The host routes every request by its own session

**Files:**
- Modify: `host/server.js` (the session and task state at lines 38-87, the routes at lines 234-420, the voice socket at lines 444-475)
- Modify: `host/result-ledger.js` (add `owedSessions()`)
- Test: `tests/host-sessions.test.mjs` (new; starts the real host)

**Interfaces:**
- Consumes: `createTaskLedger` (Task 1), `createVoiceSessions` (Task 2).
- Produces (HTTP, all with `Authorization: Bearer <token>`):
  - `POST /api/claude/select { sessionId, cwd }` → `200 { ok: true, changed }`. `POST /api/claude/session { sessionId }` stays as an alias for older plugins, never refuses.
  - `GET /api/state` adds `selectedSession: string|null` and `waitingResults: { sessionId, folder }[]`.
  - Every `/api/claude/*` route that names a `sessionId` (query or body) works on **that** session's task. Routes for a session other than the selected one are allowed. Only voice dispatch uses the selected session.
  - `POST /api/control { action: 'chime' }` is accepted (Task 4 plays it).
  - `resultLedger.owedSessions(): string[]`, the sessions with unplayed results.

- [ ] **Step 1: Write the failing integration test** `tests/host-sessions.test.mjs`

```js
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// The real host on a free port, with its files in a temporary folder and no media browser.
async function startHost() {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-host-'))
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, ['host/server.js'], { stdio: 'ignore', env: { ...process.env,
    VOICE_HOST_PORT: String(port), VOICE_MEDIA_BROWSER: '/usr/bin/true',
    VOICEMESH_CONNECTION_FILE: join(dir, 'connection.json'), COMPOSER_SETTINGS_FILE: join(dir, 'providers.json'),
    VOICEMESH_TASK_FILE: join(dir, 'task.json'), VOICEMESH_RESULT_FILE: join(dir, 'results.json'),
    VOICEMESH_TRANSCRIPT_FILE: join(dir, 'transcripts.json') } })
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
  return { call, stop }
}

const request = (sessionId, id) => ({ id, text: `Work for ${sessionId}`, mode: 'submit', sessionId })

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
    assert.deepEqual(state.waitingResults, [{ sessionId: 'session-a', folder: 'chopitup' }])
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/host-sessions.test.mjs`
Expected: FAIL. `/api/claude/select` returns 404, and before that the host may exit on `taskLedger.current` (Task 1 removed it).

- [ ] **Step 3: Add `owedSessions` to `host/result-ledger.js`**

```js
  const owedSessions = () => [...new Set(state.rows.filter(row => !row.played).map(row => row.sessionId))]
  return { allocate, record, owed, owedSessions, latest, markPlayed }
```

- [ ] **Step 4: Replace the single session and task in `host/server.js`**

Imports: add `import { createVoiceSessions } from './voice-sessions.js'`.

Replace lines 38-48 (`let claudeSessionId …` through `persistTask`) with:

```js
const sessions = createVoiceSessions()
// Each session's own voice request; a background session's job keeps its slot while another is selected.
const taskOf = sessionId => taskLedger.get(sessionId)
const active = task => !!task && !['complete', 'aborted', 'failed', 'reviewed'].includes(task.status)
for (const task of taskLedger.all()) {
  if (task.playbackId && ['complete', 'aborted', 'failed'].includes(task.status)) await resultLedger.record(task)
}
const persistTask = task => taskLedger.save(task)
// Spoken interruptions per session: a stop waiting for its turn to be cancelled, or notes waiting for
// the turn's next tool call (voice-steer.js).
const pendingSteers = new Map()
```

Delete the old `let pendingSteer = null` declaration a few lines below.

Replace `liveTasks` (lines 52-87) with a version keyed by the voice's owner. It is created per voice socket:

```js
// The voice's coding tools, bound to the session that owns this voice conversation.
const liveTasksFor = owner => ({
  states() {
    const task = taskOf(owner)
    return task ? [{
      requestId: task.id,
      // Composer steers instead of dispatching only while a task reads running or queued; claimed is running.
      status: task.status === 'complete' ? 'completed' : task.status === 'aborted' ? 'stopped'
        : task.status === 'claimed' ? 'running' : task.status,
      text: task.result ?? '', revision: 0,
      turn: task.playbackId,
      resultRevision: task.status === 'complete' ? 0 : null,
    }] : []
  },
  async dispatch(id, { instruction }) {
    if (resultLedger.owed(owner).length) throw new Error('A previous Claude result is waiting to be spoken')
    if (active(taskOf(owner))) throw new Error('Claude is busy')
    const playbackId = await resultLedger.allocate()
    await persistTask({ id, text: instruction, mode: 'submit', status: 'queued', sessionId: owner, turnId: null, result: null, playbackId })
    await transcriptLedger.markDelegated(owner, instruction).catch(() => {})
    return { requestId: id }
  },
  // Composer steers instead of dispatching while a task is active (a spoken stop or correction).
  async steer(id, { instruction }) {
    if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('Invalid steering instruction')
    const task = taskOf(owner)
    if (!task || !['queued', 'claimed', 'running'].includes(task.status)) return this.dispatch(id, { instruction })
    if (task.status === 'queued') {
      // Not yet submitted to Claude: the correction joins the request itself.
      await persistTask({ ...task, text: `${task.text}\n${instruction.trim()}` })
      return this.states()
    }
    pendingSteers.set(owner, addSteer(pendingSteers.get(owner) ?? null, { id, parentId: task.id, previous: task.text, said: instruction.trim() }))
    return this.states()
  },
})
```

- [ ] **Step 5: Rewrite the session-keyed routes in `host/server.js`**

Make these replacements inside the request handler:

`/api/state`:

```js
      const selected = sessions.selected()
      send(response, 200, { ...mediaState, mediaConnected: Date.now() - mediaSeenAt < 2500,
        voiceConfigured: configuredConnections(providerStore).length > 0,
        captionRevision: selected ? transcriptLedger.revision(selected) : 0, sequence,
        selectedSession: selected, waitingResults: sessions.waiting(resultLedger.owedSessions()) })
```

`/api/captions`: any session may read its own captions.

```js
      const requestedSession = url.searchParams.get('sessionId')
      if (!requestedSession) return send(response, 400, { error: 'Missing session' })
      sessions.seen(requestedSession)
      send(response, 200, { revision: transcriptLedger.revision(requestedSession), rows: transcriptLedger.rows(requestedSession) })
```

`/api/claude/status`: `sessionConnected: !!sessions.selected(), taskStatus: taskOf(sessions.selected())?.status ?? null`.

`/api/voice/standby`:

```js
      const selected = sessions.selected()
      send(response, 200, { taskActive: !!selected && ['queued', 'claimed', 'running'].includes(taskOf(selected)?.status),
        owedTurn: selected ? resultLedger.owed(selected)[0]?.playbackId ?? null : null })
```

Replace `/api/claude/session` with `/api/claude/select` plus the alias, and the reconnect on a change:

```js
    if (request.method === 'POST' && ['/api/claude/select', '/api/claude/session'].includes(url.pathname)) {
      const { sessionId, cwd } = await readJson(request)
      if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256) return send(response, 400, { error: 'Invalid session' })
      const changed = sessions.select(sessionId, typeof cwd === 'string' ? cwd.slice(0, 4096) : undefined)
      // A live voice conversation belongs to one session: the newly selected one gets its own.
      if (changed && voiceSockets.clients.size) switchVoice()
      send(response, 200, { ok: true, changed })
      return
    }
```

Add this helper next to `voiceSockets` (after line 444):

```js
// Ends the live voice conversation and starts the selected session's: the voice page's start loads that
// session's history and replays what it is owed (voice-server.js).
function switchVoice() {
  for (const socket of voiceSockets.clients) socket.close()
  commands.push({ id: ++sequence, action: 'stop' }, { id: ++sequence, action: 'start' })
  while (commands.length > 64) commands.shift()
}
```

`POST /api/claude/request`: use the body's `sessionId`, falling back to the selected session:

```js
      const { id, text, mode, sessionId: bodySession } = await readJson(request)
      if (typeof id !== 'string' || id.length < 1 || id.length > 128 || typeof text !== 'string' || !text.trim() || text.length > 16000 || !['review', 'submit'].includes(mode)) {
        return send(response, 400, { error: 'Invalid voice request' })
      }
      const sessionId = typeof bodySession === 'string' && bodySession ? bodySession : sessions.selected()
      if (!sessionId) return send(response, 409, { error: 'No Claude session connected' })
      const current = taskOf(sessionId)
      if (current?.id === id) return send(response, 200, { id, status: current.status })
      if (resultLedger.owed(sessionId).length) return send(response, 409, { error: 'A previous Claude result is waiting to be spoken' })
      if (active(current)) return send(response, 409, { error: 'A Claude request is already active' })
      const playbackId = await resultLedger.allocate()
      await persistTask({ id, text, mode, status: 'queued', sessionId, turnId: null, result: null, playbackId })
      await transcriptLedger.markDelegated(sessionId, text).catch(() => {})
      send(response, 202, { id, status: 'queued' })
```

`GET /api/claude/request` and `GET /api/claude/steer`: replace the `403 Session mismatch` check with `if (!sessionId) return send(response, 400, { error: 'Missing session' })`, call `sessions.seen(sessionId)`, and read `const task = taskOf(sessionId)` / `const steer = pendingSteers.get(sessionId)` where they used `claudeTask` / `pendingSteer`.

`POST /api/claude/steer/delivered`: read `const steer = pendingSteers.get(sessionId)`; on the update, `notes.length || steer.kind === 'stop' ? pendingSteers.set(sessionId, { ...steer, notes }) : pendingSteers.delete(sessionId)`.

`claim`, `reviewed`, `started`, `milestone`, `result`: in each, start with `const claudeTask = taskOf(sessionId)` after reading the body, so the existing checks (`claudeTask.id !== id || claudeTask.sessionId !== sessionId …`) apply to that session's task unchanged. In `milestone`, change `current` to `() => taskOf(sessionId)?.id === id && taskOf(sessionId).status === 'running' && sessions.selected() === sessionId`. In `result`:

```js
      const steered = pendingSteers.get(sessionId)?.parentId === claudeTask.id ? pendingSteers.get(sessionId) : null
      if (steered) pendingSteers.delete(sessionId)
      const finished = { ...claudeTask, status, result: text.slice(0, 16000) }
      await persistTask(finished)
      if (finished.playbackId && steered?.kind !== 'stop') await resultLedger.record(finished)
      const followUp = steerFollowUp(steered)
      if (followUp) {
        const playbackId = await resultLedger.allocate()
        await persistTask({ id: followUp.id, text: followUp.text, mode: 'submit', status: 'queued',
          sessionId, turnId: null, result: null, playbackId })
      }
      send(response, 200, { ok: true })
      // Only the selected session's voice speaks a result now; another session's waits for its return.
      if (sessionId !== sessions.selected()) return
      const connected = activeLive
      void connected?.completed().then(() => connected.replayOwed()).catch(() => {})
```

Recording `finished` keeps the old behaviour: the old `persistTask` had already swapped `claudeTask` to the finished task before it was recorded.

`GET /api/claude/result`: look the id up across sessions: `const task = taskLedger.all().find(item => item.id === url.searchParams.get('id'))`.

`/api/control`: add `'chime'` to the accepted actions list.

- [ ] **Step 6: Bind each voice socket to the selected session**

In the `server.on('upgrade' …)` handler, replace the `owner`/`socketTasks` block with:

```js
  const owner = sessions.selected()
  const conversationId = randomUUID()
  const liveTasks = liveTasksFor(owner)
  const socketTasks = {
    ...liveTasks,
    dispatch(id, input, signal) {
      if (!owner || owner !== sessions.selected()) throw new Error('Claude voice session changed')
      return liveTasks.dispatch(scopedVoiceId('request', owner, conversationId, id), input, signal)
    },
    steer(id, input, signal) {
      if (!owner || owner !== sessions.selected()) throw new Error('Claude voice session changed')
      return liveTasks.steer(scopedVoiceId('request', owner, conversationId, id), input, signal)
    },
    states: () => owner && owner === sessions.selected() ? liveTasks.states() : [],
    owed: () => owner ? resultLedger.owed(owner) : [],
    lastOutput: () => owner ? resultLedger.latest(owner) : null,
    played: playbackId => owner ? resultLedger.markPlayed(playbackId, owner) : Promise.resolve(false),
  }
```

In the caption callback, replace `claudeTask && !['complete', …].includes(claudeTask.status) ? claudeTask.text : ''` with `active(taskOf(owner)) ? taskOf(owner).text : ''`.

Search the file for any remaining `claudeSessionId`, `claudeTask` outside the routes that now define it locally, `claudeSeenAt`, and `pendingSteer` (singular), and remove or convert them as above. `grep -n "claudeSessionId\|claudeSeenAt\|pendingSteer\b" host/server.js` must print nothing.

- [ ] **Step 7: Run the integration test and the suite**

Run: `node --check host/server.js && node --test tests/host-sessions.test.mjs`
Expected: PASS (2 tests).
Run: `node --test tests/*.mjs`
Expected: all pass.

---

### Task 4: The result chime

**Files:**
- Modify: `media/status-sounds.js`, `media/main.js`
- Test: `tests/media-page-requests.test.mjs`

**Interfaces:**
- Consumes: `POST /api/control { action: 'chime' }` (Task 3) delivered to the page through `/api/commands`.
- Produces: the page plays tone `'result'` through `createStatusSounds().play('result')`, unless `connection.statusSounds === false`.

- [ ] **Step 1: Write the failing test** (append to `tests/media-page-requests.test.mjs`)

```js
test('a chime command plays the result tone unless connection sounds are off', async () => {
  const source = await readFile(new URL('../media/main.js', import.meta.url), 'utf8')
  assert.match(source, /command\.action === 'chime'\) \{ if \(connection\?\.statusSounds !== false\) chimes\.play\('result'\) \}/)
  const sounds = await readFile(new URL('../media/status-sounds.js', import.meta.url), 'utf8')
  assert.match(sounds, /if \(tone === 'result'\)/)
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/media-page-requests.test.mjs`
Expected: FAIL on the first `assert.match`.

- [ ] **Step 3: Implement**

In `media/status-sounds.js`, inside `chime(tone)` before the last `return`:

```js
  // A finished result in another session: two soft rising notes, unlike the connection cues.
  if (tone === 'result') return [beep(523.25, 16000, .09, .08), beep(783.99, 16000, .16, .08)]
```

In `media/main.js`, after `const lifecycle = createVoiceLifecycle(…)`, add `const chimes = createStatusSounds()`, and in `pollCommands` add after the `speaker-test` line:

```js
      if (command.action === 'chime') { if (connection?.statusSounds !== false) chimes.play('result') }
```

- [ ] **Step 4: Run, then build the page**

Run: `node --test tests/media-page-requests.test.mjs && npm run media:build`
Expected: PASS, then `✓ built`.

---

### Task 5: The plugin selects on attach and shows background results

**Files:**
- Modify: `hooks/register.js`
- Test: `tests/session-ownership.test.mjs` (new)

**Interfaces:**
- Consumes: `/api/claude/select`, `/api/state` `selectedSession` and `waitingResults` (Task 3), `/api/control { action: 'chime' }`.
- Produces: in the strip, a badge `Text` reading `● 1 result ready` / `● N results ready`; a toast `<folder>: result ready`; ownership gating `owning = !media.selectedSession || media.selectedSession === sessionId`.

- [ ] **Step 1: Write the failing tests** `tests/session-ownership.test.mjs`

```js
import assert from 'node:assert/strict'
import test from 'node:test'

const element = type => props => ({ type, ...props })
const find = (tree, match) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, match)).find(Boolean) ?? null
    : match(tree) ? tree : find(tree.children, match)

async function mod(tag, initial) {
  let state = { phase: 'listening', mediaConnected: true, voiceConfigured: true, transcript: '', lastReply: '', ...initial }
  const posted = []
  const toasts = []
  let clock
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 't' }) },
    session: { id: async () => 'session-b', cwd: async () => '/p/codex-voice-mod' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast: text => toasts.push(text),
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (options.method === 'POST') posted.push([path, JSON.parse(options.body)])
      return { ok: true, status: 200, text: JSON.stringify(path === '/api/state' ? state : { task: null, ok: true }) }
    } },
  }
  const { register } = await import(`../hooks/register.js?${tag}`)
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  await handlers.get('session.start:')($, {}, async () => {})
  return {
    posted, toasts,
    set: patch => { state = { ...state, ...patch } },
    tick: async () => { clock(); await new Promise(setImmediate) },
    attach: surface => handlers.get('session.attach:')($, { surface, clientId: 'desktop-2' }, async e => e),
    detach: () => handlers.get('session.detach:')?.($, { surface: 'desktop', clientId: 'desktop-2', reason: 'detach' }, async e => e),
    render: () => handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt', surface: 'desktop' }, async () => null),
  }
}

test('starting a session does not take the voice; the desktop attaching does', async () => {
  const ui = await mod('own-attach', {})
  await ui.tick()
  assert.equal(ui.posted.some(([path]) => ['/api/claude/session', '/api/claude/select'].includes(path)), false)
  await ui.attach('mobile')
  assert.equal(ui.posted.some(([path]) => path === '/api/claude/select'), false, 'only the desktop selects')
  await ui.attach('desktop')
  assert.deepEqual(ui.posted.find(([path]) => path === '/api/claude/select'), ['/api/claude/select', { sessionId: 'session-b', cwd: '/p/codex-voice-mod' }])
  const before = ui.posted.length
  await ui.detach()
  assert.equal(ui.posted.length, before, 'leaving a session never moves the voice')
})

test('a session that does not own the voice draws no live line', async () => {
  const ui = await mod('own-gate', { selectedSession: 'session-a' })
  await ui.tick()
  ui.set({ transcript: 'Words spoken in another session' })
  await ui.tick()
  assert.equal(find(await ui.render(), node => node.type === 'Text' && node.wrap === 'truncate-start'), null)
})

test('a result finishing in another session raises one toast, one chime and a count badge', async () => {
  const ui = await mod('own-badge', { selectedSession: 'session-b' })
  await ui.tick()
  ui.set({ waitingResults: [{ sessionId: 'session-a', folder: 'chopitup' }] })
  await ui.tick()
  await ui.tick()
  assert.deepEqual(ui.toasts, ['chopitup: result ready'])
  assert.equal(ui.posted.filter(([path, body]) => path === '/api/control' && body.action === 'chime').length, 1)
  assert.equal(find(await ui.render(), node => node.type === 'Text' && /result ready/.test(node.children?.[0] ?? '')).children[0], '● 1 result ready')
  ui.set({ waitingResults: [{ sessionId: 'session-a', folder: 'chopitup' }, { sessionId: 'session-c', folder: 'deepseek-harness' }] })
  await ui.tick()
  assert.equal(find(await ui.render(), node => node.type === 'Text' && /results ready/.test(node.children?.[0] ?? '')).children[0], '● 2 results ready')
  assert.deepEqual(ui.toasts, ['chopitup: result ready', 'deepseek-harness: result ready'])
  ui.set({ waitingResults: [] })
  await ui.tick()
  assert.equal(find(await ui.render(), node => node.type === 'Text' && /ready/.test(node.children?.[0] ?? '')), null)
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/session-ownership.test.mjs`
Expected: FAIL. `session.attach` has no handler, and the plugin still posts `/api/claude/session`.

- [ ] **Step 3: Select on attach; stop claiming at start**

In `hooks/register.js`:

1. Add a `session.attach` hook before `on('session.start', …)`:

```js
  // The desktop app attaches to the session the user selects (and detaches from the one they leave), so
  // the newest attach owns the voice. A detach changes nothing: the next attach takes over.
  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop') await selectThisSession($).catch(() => {})
    return next(e)
  })
```

2. Add the helper next to `postBridge`:

```js
async function selectThisSession($) {
  if (!connection) await refresh($)
  if (!connection) return
  sessionId ??= await $.session.id()
  await postBridge($, '/api/claude/select', { sessionId, cwd: await $.session.cwd() })
}
```

3. In `pollVoiceTask`, delete the block that posts `/api/claude/session` when `boundHost !== connection.url` (lines 238-241), and delete the `boundHost` variable and its other assignments (lines 16, 170, 367, 530).

4. In `control`, replace `await postBridge($, '/api/claude/session', { sessionId, takeOver: true })` with `await selectThisSession($)`. Pressing start in a session also selects it, which covers a session the desktop attached to before the host was up.

- [ ] **Step 4: Draw only while owning**

Add a helper near `currentLine`:

```js
// The selected session owns the voice. Before any session has selected (an older host), every session does.
function owning() {
  return !media.selectedSession || media.selectedSession === sessionId
}
```

In `currentLine`, return `null` first when `!owning()`. In `refresh`, wrap the `history.observe(…)` block for the no-ledger path in `if (owning())`. In `tick`, call `refreshCaptions` and `flushHistory` only `if (owning())`.

- [ ] **Step 5: The toast, the chime and the badge**

Add module state next to `claudeTurn`:

```js
// Results finished in other sessions: each announced once (toast and chime), and counted in a badge.
let announced = new Set()
let waitingCount = 0
```

At the end of the successful path in `refresh`, after `media = next`:

```js
    const waiting = Array.isArray(next.waitingResults) ? next.waitingResults : []
    if (owning()) {
      for (const result of waiting) {
        if (announced.has(result.sessionId)) continue
        announced.add(result.sessionId)
        $.ui.toast(`${result.folder || 'Another session'}: result ready`)
        void control($, 'chime')
      }
    }
    announced = new Set([...announced].filter(id => waiting.some(result => result.sessionId === id)))
    if (waiting.length !== waitingCount) $.ui.invalidate('ui.render')
    waitingCount = waiting.length
```

In `control`, `'chime'` is posted like the other actions; make sure the `action === 'start'` branches do not run for it (they check `action === 'start'` already).

In the AbovePrompt render, add the badge immediately before the clock's seat in the row's children:

```js
            ...(waitingCount ? [Box({ flexShrink: 0, paddingX: 1, backgroundColor: '#1f3d2b', borderStyle: 'round', borderColor: '#1f3d2b',
              children: [Text({ color: '#7ee2a8', wrap: 'truncate', children: [`● ${waitingCount} ${waitingCount === 1 ? 'result' : 'results'} ready`] })] })] : []),
```

- [ ] **Step 6: Run the new tests and the suite**

Run: `node --test tests/session-ownership.test.mjs`
Expected: PASS (3 tests).
Run: `node --test tests/*.mjs`
Expected: all pass. Tests that mocked `/api/claude/session` may now see `/api/claude/select` only on start; update any such assertion to the new path, without removing the behaviour it checks.

---

### Task 6: Install, restart, live test

**Files:**
- Modify: `.claude-plugin/plugin.json` (version bump)

- [ ] **Step 1: Install the plugin and validate**

```bash
npm run plugin:stage
```
```bash
claude plugin validate .plugin-build/plugins/voicemesh-controls
```
```bash
claude plugin update voicemesh-controls@voicemesh-local
```
Expected: `Validation passed`, then `updated from 0.1.104 to 0.1.105 for scope user`. Bump the version in `.claude-plugin/plugin.json` first.

- [ ] **Step 2: Restart the host** (ask the user first; it drops a live call)

```bash
npm run host:install:macos -- --dev-connections /Users/hgp/DeepSeek/voicemesh-composer/playground/.data/connections.json
```
Then check: `curl -s http://127.0.0.1:61445/api/connections` lists `openai-live`.

- [ ] **Step 3: Live test with the user** (after they restart the app)

1. In session A, start voice and ask for a job ("read the README title and wait 30 seconds").
2. Switch to session B: the voice reconnects within about 3 seconds, and A's conversation is not mentioned.
3. Ask B for a job. Both run.
4. When A finishes: a toast "<A's folder>: result ready", one chime, and the badge `● 1 result ready` in B.
5. Switch to A: the voice reconnects and speaks A's result; the badge clears.
6. Put two sessions in split view and click each in turn: the voice follows the last one clicked.

Record what happened in the spec's status line, and update `memory/voice-follows-selected-session.md`.
