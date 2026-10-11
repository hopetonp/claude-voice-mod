# Live Voice Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the conversation live in one line of the voice strip, write each finished turn to the message history exactly once, and hand Claude the user's own words on every provider.

**Architecture:** The Mod already receives the live user transcript and voice reply for every provider through the host's `/api/state` (`transcript`, `lastReply`). A pure `liveLine()` decides what the strip shows, and the AbovePrompt render draws it on the left. `VoiceHistory` is reduced to "one bubble per ended turn". For xAI, OpenAI Realtime and Gemini, the host passes the user's latest spoken line to `runCodingCall`, which uses it instead of the model's rewritten instruction.

**Tech Stack:** Claude Code Mod API v2.1.288 (`ui.render` AbovePrompt, `Box`/`Text` with `wrap: 'truncate-start'`), Node host, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-06-live-voice-line-design.md` (approved by Hopeton on 2026-10-06).

## Global Constraints

- Desktop Code tab only. Use Claude's own elements; no new SVG in the live line.
- The live line sits on the left of the voice strip and stops a little short of the existing controls. It is labelled **You** or **Voice**, keeps the newest words visible ("…" on the left), and clears when the turn ends.
- The voice's listening sounds while the user is still talking must not switch the line, and must not end the user's turn.
- A history bubble is only ever written for an ended turn, once, with its full text. There are no pieces and no follow-on bubbles.
- On a hand-off, the prompt is the user's exact words. The model's instruction is used only when there is no user transcript.
- Never use Haiku for subagents; Sonnet is the minimum.
- The project is not a git repository, so there are no commit steps.
- Baseline: `node --test tests/` gives 92 tests, all passing.
- Restart the host only with `npm run host:install:macos -- --dev-connections /Users/hgp/DeepSeek/voicemesh-composer/playground/.data/connections.json`. If launchctl prints a Node error, run it again. A restart drops an active voice session, so ask Hopeton first.

## File Structure

| File | Responsibility |
| --- | --- |
| Create `hooks/live-line.js` | Pure: which speaker and text the live line shows now |
| Modify `hooks/register.js` | Track when the transcript and reply change; draw the live line; remove the "grown caption" branch |
| Rewrite `hooks/voice-history.js` | One bubble per ended turn |
| Modify `host/sts-task-tools.js` | `runCodingCall` accepts the user's spoken line and prefers it |
| Modify `host/realtime-voice.js` | Remember the latest user line and pass it on a coding call |
| Create `tests/live-line.test.mjs`, `tests/live-line-render.test.mjs` | Live line tests |
| Rewrite `tests/voice-history.test.mjs` | Turn-based history tests |
| Modify `tests/sts-task-tools.test.mjs`, `tests/realtime-voice.test.mjs` | Hand-off tests |

---

### Task 1: The live line

**Files:**
- Create: `hooks/live-line.js`
- Modify: `hooks/register.js` (`refresh()` around line 86; the AbovePrompt render around line 519)
- Test: `tests/live-line.test.mjs`, `tests/live-line-render.test.mjs`

**Interfaces:**
- Produces: `liveLine({ transcript, lastReply, userChangedAt, replyChangedAt, phase }, now) → { speaker: 'You' | 'Voice', text: string } | null`; constants `USER_QUIET_MS = 1500`, `LINE_LINGER_MS = 4000`.

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/live-line.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { liveLine } from '../hooks/live-line.js'

const base = { transcript: '', lastReply: '', userChangedAt: 0, replyChangedAt: 0, phase: 'listening' }

test('shows the user while they talk', () => {
  assert.deepEqual(liveLine({ ...base, transcript: 'So here I am', userChangedAt: 1000 }, 1200),
    { speaker: 'You', text: 'So here I am' })
})

test('switches to the voice once the voice takes its turn', () => {
  const state = { ...base, transcript: 'Can you hear me?', userChangedAt: 1000, lastReply: 'Yes, clearly.', replyChangedAt: 3000 }
  assert.deepEqual(liveLine(state, 3100), { speaker: 'Voice', text: 'Yes, clearly.' })
})

test("a listening sound while the user is still talking does not take the line", () => {
  const state = { ...base, transcript: 'I mean, you are doing that part', userChangedAt: 2000, lastReply: 'Mm-hmm.', replyChangedAt: 2100 }
  assert.deepEqual(liveLine(state, 2200), { speaker: 'You', text: 'I mean, you are doing that part' })
})

test('clears a while after the last words, and whenever voice is not live', () => {
  const state = { ...base, lastReply: 'Done.', replyChangedAt: 1000 }
  assert.deepEqual(liveLine(state, 4900), { speaker: 'Voice', text: 'Done.' })
  assert.equal(liveLine(state, 5000), null)
  assert.equal(liveLine({ ...base, transcript: 'Hello', userChangedAt: 1000, phase: 'idle' }, 1100), null)
  assert.equal(liveLine(base, 1000), null)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/live-line.test.mjs`
Expected: FAIL with `Cannot find module '.../hooks/live-line.js'`.

- [ ] **Step 3: Write `hooks/live-line.js`**

```js
// The live line: who is talking right now and their newest words, drawn in the voice strip while the
// turn is spoken. The history only gets the turn once it has ended (voice-history.js).

// The voice's listening sounds ("Mm-hmm") arrive while the user is still talking, so the line stays on
// the user until the user's words have been still this long.
export const USER_QUIET_MS = 1500
// After the last words change, the line stays this long so the end of a turn can still be read.
export const LINE_LINGER_MS = 4000
const OFF = ['offline', 'idle', 'standby', 'error', 'needs-activation', 'connecting']

/** What the live line shows now, or null for nothing. */
export function liveLine({ transcript = '', lastReply = '', userChangedAt = 0, replyChangedAt = 0, phase = 'idle' }, now) {
  if (OFF.includes(phase)) return null
  const user = transcript.trim()
  const reply = lastReply.trim()
  const userTalking = !!user && now - userChangedAt < USER_QUIET_MS
  const voiceTurn = !!reply && replyChangedAt > userChangedAt && !userTalking
  const pick = voiceTurn ? { speaker: 'Voice', text: reply, at: replyChangedAt }
    : user ? { speaker: 'You', text: user, at: userChangedAt } : null
  if (!pick || now - pick.at >= LINE_LINGER_MS) return null
  return { speaker: pick.speaker, text: pick.text }
}
```

- [ ] **Step 4: Run the unit tests and see them pass**

Run: `node --test tests/live-line.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing render test**

```js
// tests/live-line-render.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

const element = type => props => ({ type, ...props })
const find = (tree, match) => tree == null || typeof tree !== 'object' ? null
  : Array.isArray(tree) ? tree.map(child => find(child, match)).find(Boolean) ?? null
    : match(tree) ? tree : find(tree.children, match)

test('the voice strip shows the live line on its left while the user talks', async () => {
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  let clock
  let state = { phase: 'listening', mediaConnected: true, voiceConfigured: true, transcript: '', lastReply: '' }
  const $ = {
    env: { get: async () => '/tmp' },
    fs: { read: async () => JSON.stringify({ url: 'http://voice.test', token: 'test-token' }) },
    session: { id: async () => 'claude-session' },
    command: { register: async () => {} },
    store: { get: async () => [], set: async () => {} },
    clock: { every(_ms, callback) { clock = callback } },
    config: { list: async () => [] },
    ui: { invalidate() {}, log() {}, toast() {},
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg'), Client: element('Client') }) },
    http: { fetch: async url => ({ ok: true, text: JSON.stringify(new URL(url).pathname === '/api/state' ? state : { task: null }) }) },
  }
  try {
    const { register } = await import('../hooks/register.js?live-line-render')
    const handlers = new Map()
    register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
    await handlers.get('session.start:')($, {}, async () => {})
    state = { ...state, transcript: 'Everything I say streams here as I speak' }
    now = 1100
    clock(); await new Promise(setImmediate)
    const strip = await handlers.get('ui.render:AbovePrompt')($, { component: 'AbovePrompt' }, async () => null)
    const words = find(strip, node => node.type === 'Text' && node.wrap === 'truncate-start')
    assert.ok(words, 'the spoken words keep their newest end visible')
    assert.deepEqual(words.children, ['Everything I say streams here as I speak'])
    assert.ok(find(strip, node => node.type === 'Text' && node.children?.[0] === 'You'), 'labelled You')
  } finally { Date.now = realNow }
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `node --test tests/live-line-render.test.mjs`
Expected: FAIL with "the spoken words keep their newest end visible".

- [ ] **Step 7: Track the change times and draw the line in `hooks/register.js`**

Add the import beside the other imports at the top:

```js
import { liveLine } from './live-line.js'
```

Next to the other module-level `let` declarations near the top of the file, add:

```js
// When the user's live transcript and the voice's reply last changed, for the live line.
let userChangedAt = 0
let replyChangedAt = 0
```

In `refresh()`, directly before the line `media = next`, add:

```js
    const changedAt = Date.now()
    const textChanged = next.transcript !== media.transcript || next.lastReply !== media.lastReply
    if (next.transcript !== media.transcript) userChangedAt = changedAt
    if (next.lastReply !== media.lastReply) replyChangedAt = changedAt
```

After the existing line `if (levelsChanged) $.ui.invalidate('ui.render')`, add:

```js
    // Redraw for new words, and keep redrawing while a line shows so it clears on time.
    if (textChanged || liveLine({ ...media, userChangedAt, replyChangedAt }, changedAt)) $.ui.invalidate('ui.render')
```

In the AbovePrompt render, after the `const icon = …` definition, add:

```js
    const line = liveLine({ ...media, userChangedAt, replyChangedAt }, Date.now())
```

and make this the **first** entry in the row's `children` array, before `...(parked ? …)`:

```js
            // The live line: who is talking and their newest words, filling the strip's empty left side
            // and stopping short of the controls.
            ...(line ? [Box({ flexDirection: 'row', flexGrow: 1, flexShrink: 1, minWidth: 0, columnGap: 1, marginRight: 2,
              alignItems: 'center', children: [
                Text({ bold: true, color: ICON_REST, children: [line.speaker] }),
                Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Text({ wrap: 'truncate-start', children: [line.text] })] }),
              ] })] : []),
```

- [ ] **Step 8: Run the render test and the full suite**

Run: `node --test tests/live-line-render.test.mjs && node --test tests/`
Expected: the render test passes; 97 tests, all passing.

---

### Task 2: One history bubble per ended turn

**Files:**
- Rewrite: `hooks/voice-history.js`
- Modify: `hooks/register.js` (`refreshCaptions`, around line 232)
- Rewrite: `tests/voice-history.test.mjs`

**Interfaces:**
- Produces: `VoiceHistory` with `observe(role, id, text, now)`, `finish(role, now)`, `complete(row, now)`, `markDelegated(instruction)`, `next(now) → { row, text, final: true, from: 0 } | null`, `posted(piece)`, `delivered(row)`. These are the same names `register.js` already calls; `next()` now only ever returns final pieces.

- [ ] **Step 1: Replace `tests/voice-history.test.mjs` with turn-based tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceHistory } from '../hooks/voice-history.js'

// What reaches the history: each final piece as flushHistory shows it.
function shown(history, now) {
  const out = []
  let piece
  while ((piece = history.next(now))) {
    history.posted(piece)
    if (!piece.row.delegated) out.push(`${piece.row.role}: ${piece.row.text.slice(piece.from).trim()}`)
  }
  return out
}

test('nothing is written while a turn is still being spoken', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'So I was thinking about', 100)
  history.observe('user', 'u1', 'So I was thinking about the voice panel, and', 600)
  assert.deepEqual(shown(history, 2000), [])
})

test('GPT Live: word-by-word growth with a listening sound in the middle stays one bubble', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'I mean, you are', 100)
  history.observe('assistant', 'mm', 'Mm.', 300)
  history.finish('assistant', 400)
  history.observe('user', 'u1', 'I mean, you are doing that part already, right?', 900)
  assert.deepEqual(shown(history, 2000), [], 'the user was talking less than 1.5 s ago')
  history.observe('assistant', 'r1', 'Yes, I am.', 2600)
  history.finish('assistant', 3000)
  assert.deepEqual(shown(history, 3600), ['user: I mean, you are doing that part already, right?', 'assistant: Mm.'])
})

test('xAI: segments seconds apart and marked complete early stay one bubble', () => {
  const history = new VoiceHistory()
  history.complete(history.observe('user', 'u1', 'Okay, so here I am speaking,', 100), 100)
  history.observe('user', 'u1', "Okay, so here I am speaking, and let's see what happens", 3300)
  assert.deepEqual(shown(history, 6500), [])
  history.observe('user', 'u1', "Okay, so here I am speaking, and let's see what happens when I'm done.", 6600)
  history.observe('assistant', 'r1', 'Queued.', 7000)
  history.finish('assistant', 7200)
  assert.deepEqual(shown(history, 8200), ["user: Okay, so here I am speaking, and let's see what happens when I'm done."])
})

test("the voice's reply is written once it finishes, at once when final", () => {
  const history = new VoiceHistory()
  history.complete(history.observe('assistant', 'r1', 'All done.', 100), 100)
  assert.deepEqual(shown(history, 100), ['assistant: All done.'])
  history.observe('assistant', 'r2', 'Still', 200)
  history.observe('assistant', 'r2', 'Still working on it.', 400)
  history.finish('assistant', 500)
  assert.deepEqual(shown(history, 1600), [])
  assert.deepEqual(shown(history, 1700), ['assistant: Still working on it.'])
})

test('with voice idle, a still user turn is written after a short hold; while live, after a long one', () => {
  const idle = new VoiceHistory()
  idle.observe('user', 'u1', 'Thanks', 100)
  idle.finish('user', 200)
  assert.deepEqual(shown(idle, 2500), [])
  assert.deepEqual(shown(idle, 2700), ['user: Thanks'])
  const live = new VoiceHistory()
  live.observe('user', 'u1', 'Just thinking out loud.', 100)
  assert.deepEqual(shown(live, 8000), [])
  assert.deepEqual(shown(live, 8200), ['user: Just thinking out loud.'])
})

test('a turn handed to Claude is not written as a speech bubble', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Read the README title', 100)
  history.observe('assistant', 'r1', 'Checking.', 300)
  history.markDelegated('Read the README title')
  assert.deepEqual(shown(history, 400), [])
  history.finish('assistant', 500)
  assert.deepEqual(shown(history, 1800), ['assistant: Checking.'])
})

test('a later turn never jumps ahead of an earlier one', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'First', 100)
  history.observe('assistant', 'r1', 'Reply', 2000)
  history.finish('assistant', 2100)
  history.observe('user', 'u2', 'Second', 2200)
  assert.deepEqual(shown(history, 3400), ['user: First', 'assistant: Reply'])
})
```

- [ ] **Step 2: Run them to see the failures**

Run: `node --test tests/voice-history.test.mjs`
Expected: several FAIL. For example, "nothing is written while a turn is still being spoken" fails, because the current code posts pieces.

- [ ] **Step 3: Replace `hooks/voice-history.js`**

```js
const normalized = text => text.trim().replace(/\s+/g, ' ').toLowerCase()

// The live line (live-line.js) shows a turn while it is spoken; the history gets each turn once, whole,
// when it has ended. Providers differ too much to post earlier: GPT Live grows a caption word by word
// and slips listening sounds into the user's turn; xAI sends speech seconds apart and calls captions
// complete early.

// A finished reply waits briefly for its last caption words.
const ASSISTANT_SETTLE_MS = 1200
// A later row ends the user's turn only once the user's words have been still this long, so a
// listening sound ("Mm-hmm") in the middle of the user's speech does not end it.
const USER_QUIET_MS = 1500
// The voice hands a coding request over just after its first words ("Checking."), and that request
// shows as its own prompt; so a user turn waits until shortly after the reply's caption ends.
const HANDOVER_MS = 500
// With a reply under way, or voice idle, a still user turn ends after this long.
const USER_HOLD_MS = 2500
// A live session with no reply: a still user turn ends after this long.
const USER_ALONE_MS = 8000

// One row per caption id.
export class VoiceHistory {
  constructor() { this.rows = [] }

  observe(role, id, text, now = Date.now()) {
    if (!['user', 'assistant'].includes(role) || !id || !text?.trim()) return
    let row = this.rows.find(item => item.id === id && item.role === role)
    if (!row) {
      const previous = this.rows.at(-1)
      if (previous && !previous.delivered && !previous.finished) {
        previous.finished = true
        previous.finishedAt = now
      }
      row = { role, id, text: '', posted: 0, shown: 0, changedAt: now, finished: false, finishedAt: 0, delivered: false, delegated: false }
      this.rows.push(row)
    }
    if (row.text !== text && !row.delivered) {
      row.text = text.slice(0, 4000)
      row.changedAt = now
      if (row.finished && role === 'assistant') row.finishedAt = now
    }
    if (this.rows.length > 128) this.rows.splice(0, this.rows.length - 128)
    return row
  }

  /** This role's turn is over (for the user: voice went idle, so no reply is coming). */
  finish(role, now = Date.now()) {
    const row = [...this.rows].reverse().find(item => item.role === role && !item.delivered)
    if (row && !row.finished) {
      row.finished = true
      row.finishedAt = now
    }
    if (row) row.ended = true
  }

  /** The provider marked this caption final. Trusted for the voice's replies; ignored for user speech. */
  complete(row, now = Date.now()) {
    if (row.delivered) return
    if (!row.finished) row.finishedAt = now
    row.finished = true
    row.complete = true
  }

  markDelegated(instruction) {
    const request = normalized(instruction)
    for (const row of this.rows) {
      if (row.role === 'user' && request && (request.includes(normalized(row.text)) || normalized(row.text).includes(request))) {
        row.delegated = true
      }
    }
  }

  ended(row, now) {
    if (row.role === 'assistant') return row.finished && (row.complete || now >= row.finishedAt + ASSISTANT_SETTLE_MS)
    const after = this.rows[this.rows.indexOf(row) + 1]
    const still = now - row.changedAt
    if (after) {
      return still >= USER_QUIET_MS && (after.delivered || (after.finished && now >= after.finishedAt + HANDOVER_MS) || still >= USER_HOLD_MS)
    }
    return still >= (row.ended ? USER_HOLD_MS : USER_ALONE_MS)
  }

  /** The oldest unwritten turn, once it has ended; turns are written in order. */
  next(now = Date.now()) {
    const row = this.rows.find(item => !item.delivered)
    if (!row || !(row.delegated || this.ended(row, now))) return null
    return { row, text: row.text.trim(), first: true, final: true, from: 0 }
  }

  posted(piece) { this.delivered(piece.row) }

  delivered(row) {
    row.delivered = true
    row.shown = row.posted = row.text.length
  }
}
```

- [ ] **Step 4: Remove the "grown caption" branch from `refreshCaptions` in `hooks/register.js`**

A written turn is never extended now, so restore the original rule. Replace these lines:

```js
    // A caption that grew past what was already shown keeps its new words: they post as a follow-on
    // bubble. Marking it delivered here would drop them (xAI completes captions early, then extends them).
    const grown = !caption.delegated && saved?.final && Number.isSafeInteger(saved.posted) && caption.text.length > saved.posted
    if (grown) Object.assign(row, { posted: Math.max(row.posted, saved.posted), shown: Math.max(row.shown, saved.posted) })
    else if (caption.delegated || (saved ? saved.final || !Number.isSafeInteger(saved.posted) : index < lastKnown)) history.delivered(row)
```

with:

```js
    if (caption.delegated || (saved ? saved.final || !Number.isSafeInteger(saved.posted) : index < lastKnown)) history.delivered(row)
```

- [ ] **Step 5: Run the history tests, then the whole suite**

Run: `node --test tests/voice-history.test.mjs && node --test tests/`
Expected: the 7 new history tests pass. In the Mod tests (`tests/mod-history.test.mjs`, `tests/mod-ledger-history.test.mjs`), some cases were written for the old early posting. Two will now contradict the spec, so delete them:
- **"words a provider adds after the caption was shown appear instead of being dropped"** expects follow-on bubbles.
- Any test asserting a bubble at a time when the user's words changed less than 1.5 s earlier, with no idle and no reply. Under the new rule the bubble comes later.

For any other failing Mod test, change **only the times** (`now = …`) so the turn has ended under the rules above, and keep every assertion about the bubble text. Then rerun `node --test tests/` until all pass, and record each test deleted or retimed in the task report.

---

### Task 3: Hand Claude the user's own words on every provider

**Files:**
- Modify: `host/sts-task-tools.js` (`runCodingCall`)
- Modify: `host/realtime-voice.js` (user caption handling around line 123; the coding call around line 176)
- Test: `tests/sts-task-tools.test.mjs`, `tests/realtime-voice.test.mjs`

**Interfaces:**
- Produces: `runCodingCall(call, tasks, signal, spoken = '')`. When `spoken.trim()` is non-empty, it replaces `args.instruction` for `dispatch_coding_task`, sliced to 16000 characters, both for dispatching and for steering.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sts-task-tools.test.mjs`:

```js
test("a coding call carries the user's own words when there is a transcript", async () => {
  const { runCodingCall } = await import('../host/sts-task-tools.js')
  const dispatched = []
  const tasks = { states: () => [], async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const call = { call_id: 'c1', name: 'dispatch_coding_task', arguments: JSON.stringify({ instruction: 'User reports that the bubble splits.' }) }
  await runCodingCall(call, tasks, undefined, '  Why does the bubble split into pieces?  ')
  await runCodingCall({ ...call, call_id: 'c2' }, tasks, undefined, '')
  assert.deepEqual(dispatched, ['Why does the bubble split into pieces?', 'User reports that the bubble splits.'])
})
```

Append to `tests/realtime-voice.test.mjs`:

```js
test("the realtime path hands Claude the user's latest spoken line, not the model's rewrite", async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.bufferedAmount = 0
  socket.send = () => {}
  socket.close = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }
  let owner
  const dispatched = []
  const tasks = { states: () => [], owed: () => [], async played() { return true },
    async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const store = { selectedProvider: () => 'xai', get: () => ({ key: 'k', model: 'm', voice: 'v', responseDetail: 'concise' }) }
  attachRealtimeVoice(socket, store, tasks, () => {}, async () => {}, () => [], {
    providers: { xai: { id: 'xai', toolResponseStartsResponse: true } },
    transcriptionModels: async () => [],
    openChannel: async (_settings, inbound) => { owner = inbound; return { send: async () => {}, close: async () => {}, closed: new Promise(() => {}) } },
  })
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'start', provider: 'xai' })))
  await flush()
  await owner.receive({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'u1', transcript: 'Can you check why the bubble splits?' })
  await owner.receive({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{
    type: 'function_call', call_id: 'call-1', name: 'dispatch_coding_task', arguments: '{"instruction":"User reports that bubbles split."}',
  }] } })
  await flush(); await flush()
  assert.deepEqual(dispatched, ['Can you check why the bubble splits?'])
  socket.close()
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/sts-task-tools.test.mjs tests/realtime-voice.test.mjs`
Expected: both new tests FAIL, showing the model's instruction being dispatched.

- [ ] **Step 3: Prefer the spoken line in `runCodingCall` (`host/sts-task-tools.js`)**

Change the signature to:

```js
export async function runCodingCall(call, tasks, signal, spoken = '') {
```

After the `dispatch_coding_task` validation (the `throw new Error('Invalid coding request')` block), add:

```js
    // The prompt Claude sees is the user's own words, as with GPT Live; the model's rewrite is a fallback.
    const instruction = (typeof spoken === 'string' && spoken.trim() ? spoken.trim() : args.instruction.trim()).slice(0, 16000)
```

and replace `args.instruction.trim()` with `instruction` in both the `tasks.steer(…)` call and the `tasks.dispatch(…)` call. Also change `isStopRequest(args.instruction)` to `isStopRequest(instruction)`.

- [ ] **Step 4: Remember the latest user line in `host/realtime-voice.js`**

Next to the other `let` declarations inside `attachRealtimeVoice`, add:

```js
  // The user's latest spoken line, handed to Claude on the next coding call instead of the model's rewrite.
  let spokenRequest = ''
```

In `receive`, inside the existing `if (event.type === 'conversation.item.input_audio_transcription.updated' || …completed')` block, before the `await caption('user', …)` call, add:

```js
      if (typeof event.transcript === 'string' && event.transcript.trim()) spokenRequest = event.transcript
```

In the coding-call loop, replace:

```js
          const result = await runCodingCall(call, tasks, lifetime.signal)
```

with:

```js
          // Each spoken line is handed over once; a second call in the same turn falls back to the model's words.
          const spoken = call.name === 'dispatch_coding_task' ? spokenRequest : ''
          if (spoken) spokenRequest = ''
          const result = await runCodingCall(call, tasks, lifetime.signal, spoken)
```

- [ ] **Step 5: Run the tests and the full suite**

Run: `node --test tests/sts-task-tools.test.mjs tests/realtime-voice.test.mjs && node --test tests/`
Expected: all pass.

---

### Task 4: Install and check live in Desktop

- [ ] **Step 1: Install the Mod**

Bump `.claude-plugin/plugin.json`'s patch version by one, then run:

```bash
npm run plugin:stage && claude plugin validate .plugin-build/plugins/voicemesh-controls
```

```bash
claude plugin update voicemesh-controls@voicemesh-local
```

Expected: "Validation passed", and the plugin updated to the new version.

- [ ] **Step 2: Restart the host (Task 3 changed host code), after asking Hopeton**

```bash
npm run host:install:macos -- --dev-connections /Users/hgp/DeepSeek/voicemesh-composer/playground/.data/connections.json
```

Run it again if the first attempt prints a Node error. Then confirm `/api/state` reports `voiceConfigured: true`.

- [ ] **Step 3: Hopeton runs `/reload-plugins` and checks, on GPT Live and on xAI**

1. While he talks, the left of the voice strip shows **You** and his newest words, and older words drop off the left.
2. While the voice answers, the line shows **Voice** and its words. A "Mm-hmm" while he is talking does not switch it.
3. Each finished turn appears in the history as **one** complete bubble. A long sentence with pauses is not split, and there are no one-word bubbles.
4. A request handed to Claude shows as a prompt in his exact words. On xAI there is no "User reports that…", and there is no duplicate speech bubble.

- [ ] **Step 4: Compare with the ledger**

For the test turns, compare `~/.claude/voicemesh-controls/transcripts.json` with the Mod's saved history in `~/.claude/plugins/store/voicemesh-controls_*.json`. Every user row's full text must have been posted once, with `posted` equal to the text length.
