import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createTranscriptLedger } from '../host/transcript-ledger.js'
import { speechClock, turnOutcomes, turnTasks } from '../host/voice-server.js'

const withLedger = async body => {
  const dir = await mkdtemp(join(tmpdir(), 'voicemesh-turns-'))
  try { await body(join(dir, 'transcripts.json')) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('a coding turn records its exact request and the user captions it covers', () => withLedger(async file => {
  const ledger = await createTranscriptLedger(file)
  await ledger.record('s', { id: 'old', role: 'user', text: 'Earlier chat', at: 100 })
  await ledger.openTurn('s', 'turn:a', 150)
  await ledger.settleTurn('s', 'turn:a', { state: 'voice' }, 160)
  await ledger.record('s', { id: 'u1', role: 'user', text: 'Read the README', at: 200 })
  await ledger.record('s', { id: 'u2', role: 'user', text: 'title please', at: 260 })
  const before = ledger.revision('s')
  await ledger.openTurn('s', 'turn:b', 300)
  assert.ok(ledger.revision('s') > before, 'opening a turn bumps the revision')
  assert.equal(ledger.turns('s').at(-1).state, 'pending')
  await ledger.record('s', { id: 'r1', role: 'assistant', text: 'Checking.', at: 320 })
  const opened = ledger.revision('s')
  const turn = await ledger.settleTurn('s', 'turn:b', { state: 'coding', requestId: 'request:x', mode: 'dispatch' }, 400)
  assert.ok(ledger.revision('s') > opened, 'settling a turn bumps the revision')
  assert.deepEqual(turn, { id: 'turn:b', state: 'coding', offsetAt: 300, settledAt: 400, requestId: 'request:x',
    mode: 'dispatch', userCaptionIds: ['u1', 'u2'], revision: turn.revision })
  assert.deepEqual(ledger.turns('s')[0].userCaptionIds, ['old'])
  // Records survive a host restart.
  const reloaded = await createTranscriptLedger(file)
  assert.deepEqual(reloaded.turns('s'), ledger.turns('s'))
  assert.equal(reloaded.revision('s'), ledger.revision('s'))
}))

test('turns are kept per session and a settled turn is not settled again', () => withLedger(async file => {
  const ledger = await createTranscriptLedger(file)
  await ledger.openTurn('s', 'turn:a', 100)
  await ledger.openTurn('other', 'turn:z', 100)
  await ledger.settleTurn('s', 'turn:a', { state: 'voice' }, 110)
  assert.equal(await ledger.settleTurn('s', 'turn:a', { state: 'coding', requestId: 'request:x' }, 120), null)
  assert.equal(ledger.turns('s')[0].state, 'voice')
  assert.equal(ledger.turns('other')[0].state, 'pending')
  assert.equal(await ledger.settleTurn('s', 'turn:unknown', { state: 'voice' }), null)
  assert.equal(await ledger.settleTurn('other', 'turn:z', { state: 'pending' }), null, 'pending is not an outcome')
}))

test('an earlier turn the voice library dropped is superseded, and the call ending closes open turns', () => withLedger(async file => {
  const ledger = await createTranscriptLedger(file)
  await ledger.openTurn('s', 'turn:a', 100)
  await ledger.openTurn('s', 'turn:b', 200)
  await ledger.settleTurn('s', 'turn:b', { state: 'clarify' }, 300)
  assert.deepEqual(ledger.turns('s').map(turn => turn.state), ['superseded', 'clarify'])
  // If the dropped turn resolves after all, it takes its real outcome.
  await ledger.settleTurn('s', 'turn:a', { state: 'voice' }, 310)
  assert.deepEqual(ledger.turns('s').map(turn => turn.state), ['voice', 'clarify'])
  await ledger.openTurn('s', 'turn:c', 400)
  await ledger.closeTurns('s', 500)
  assert.deepEqual(ledger.turns('s').at(-1), { id: 'turn:c', state: 'closed', offsetAt: 400, settledAt: 500,
    userCaptionIds: [], revision: ledger.turns('s').at(-1).revision })
}))

test("the delegation offset lands on the captions' spoken-time clock", () => {
  let now = 50_000
  const clock = speechClock(() => now)
  clock.start()
  now = 90_000
  assert.equal(clock.at(1_200), 51_200)
  assert.equal(clock.stamp('user:a', 1_200), clock.at(1_200))
  assert.equal(clock.at(undefined), undefined)
})

const policy = {
  missingTranscript: 'Please repeat your question.',
  rejected: 'Claude could not accept that request.',
  classification: { voice: 'routed to voice', clarify: 'asks to clarify', unavailable: 'classifier unavailable' },
}

test("each non-coding outcome settles from the voice library's own note for that delegation", async () => {
  const settled = []
  const sent = []
  const send = turnOutcomes(async message => { sent.push(message.content); return true },
    policy, { settle: (id, outcome) => settled.push([id, outcome.state]) })
  for (const [content, id] of [['routed to voice', 'd1'], ['asks to clarify', 'd2'], ['classifier unavailable', 'd3'],
    ['Claude could not accept that request.', 'd4'], ['Please repeat your question.', 'd5']]) {
    await send({ type: 'session.commentary.append', delegation_id: id, content }, () => true)
  }
  // Notes that are not a turn's outcome settle nothing: a result read-back, a milestone, the admission notice.
  await send({ type: 'session.commentary.append', delegation_id: null, content: 'Claude request completed.' }, () => true)
  await send({ type: 'session.thinking.append', delegation_id: 'd6', content: 'admitted' }, () => true)
  assert.deepEqual(settled, [['d1', 'voice'], ['d2', 'clarify'], ['d3', 'unavailable'], ['d4', 'rejected'], ['d5', 'missing-transcript']])
  assert.equal(sent.length, 7, 'every note is still sent')
})

test('a turn is a coding hand-off only once its request is filed, with that request id', async () => {
  const settled = []
  let active = null
  const tasks = {
    dispatch: async id => { active = { requestId: `request:${id}`, status: 'queued' }; return { requestId: active.requestId } },
    steer: async () => [active],
    states: () => active ? [active] : [],
  }
  const wrapped = turnTasks(tasks, { settle: (id, outcome) => settled.push([id, outcome]) })
  assert.deepEqual(await wrapped.dispatch('d1', { instruction: 'Read the README' }), { requestId: 'request:d1' })
  await wrapped.steer('d2', { instruction: 'Also the title' })
  assert.deepEqual(settled, [
    ['d1', { state: 'coding', requestId: 'request:d1', mode: 'dispatch' }],
    ['d2', { state: 'coding', requestId: 'request:d1', mode: 'steer' }],
  ])
  const failing = turnTasks({ ...tasks, dispatch: async () => { throw new Error('Claude is busy') } },
    { settle: (id, outcome) => settled.push([id, outcome]) })
  await assert.rejects(failing.dispatch('d3', { instruction: 'x' }))
  assert.equal(settled.length, 2, 'a refused request is not a coding turn; the rejection note settles it')
})

test("a call's first turn covers only that call's captions, never an earlier call's in the same chat", () => withLedger(async file => {
  const ledger = await createTranscriptLedger(file)
  // An earlier voice call in this chat: captions, and a turn of its own.
  await ledger.record('s', { id: 'c1-u1', role: 'user', text: 'Old question', at: 100, conversationId: 'call-1' })
  await ledger.record('s', { id: 'c1-u2', role: 'user', text: 'Another old one', at: 150, conversationId: 'call-1' })
  await ledger.openTurn('s', 'turn:c1', 160, 'call-1')
  await ledger.record('s', { id: 'c1-u3', role: 'user', text: 'Said after that turn', at: 170, conversationId: 'call-1' })
  // A caption saved before calls were recorded, and one typed outside any call.
  await ledger.record('s', { id: 'legacy', role: 'user', text: 'Legacy row', at: 180 })
  // The current call.
  await ledger.record('s', { id: 'c2-u1', role: 'user', text: 'Read the README', at: 300, conversationId: 'call-2' })
  await ledger.openTurn('s', 'turn:c2a', 350, 'call-2')
  const first = await ledger.settleTurn('s', 'turn:c2a', { state: 'coding', requestId: 'request:x', mode: 'dispatch' }, 360)
  assert.deepEqual(first.userCaptionIds, ['c2-u1'])
  await ledger.record('s', { id: 'c2-u2', role: 'user', text: 'Thanks', at: 400, conversationId: 'call-2' })
  await ledger.openTurn('s', 'turn:c2b', 450, 'call-2')
  assert.deepEqual((await ledger.settleTurn('s', 'turn:c2b', { state: 'voice' }, 460)).userCaptionIds, ['c2-u2'])
  // The earlier call's turn, still open when that call ended, keeps to its own call too.
  await ledger.closeTurns('s', 500)
  assert.deepEqual(ledger.turns('s')[0].userCaptionIds, ['c1-u1', 'c1-u2'])
  assert.equal('conversationId' in ledger.turns('s')[0], false, 'the call stays internal to the host')
  // The call identity survives a host restart.
  const reloaded = await createTranscriptLedger(file)
  await reloaded.openTurn('s', 'turn:c2c', 600, 'call-2')
  await reloaded.record('s', { id: 'c2-u3', role: 'user', text: 'One more', at: 550, conversationId: 'call-2' })
  assert.deepEqual((await reloaded.settleTurn('s', 'turn:c2c', { state: 'voice' }, 610)).userCaptionIds, ['c2-u3'])
}))
