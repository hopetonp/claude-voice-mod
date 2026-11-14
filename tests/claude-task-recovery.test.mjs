import assert from 'node:assert/strict'
import test from 'node:test'
import { completionFromTranscript } from '../host/claude-task-recovery.js'

const task = { id: 'request-one', sessionId: 'session-one', status: 'running', turnId: 'desktop-turn',
  claimedAt: 1000, text: 'Read the README' }
const root = { type: 'user', uuid: 'user-one', promptId: 'cli-prompt', sessionId: task.sessionId,
  timestamp: new Date(1100).toISOString(), origin: { kind: 'plugin', name: 'voicemesh-controls', asUser: true },
  message: { content: task.text } }
const answer = { type: 'assistant', uuid: 'answer-one', parentUuid: root.uuid, sessionId: task.sessionId,
  message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'README checked.' }] } }
const stop = { type: 'system', uuid: 'stop-one', parentUuid: answer.uuid, sessionId: task.sessionId,
  subtype: 'stop_hook_summary', preventedContinuation: false, hookErrors: [] }
const transcript = (...rows) => rows.map(row => JSON.stringify(row)).join('\n') + '\n'

test('an exact plugin request with a final answer and completed Stop hooks is recovered', () => {
  assert.deepEqual(completionFromTranscript(task, transcript(root, answer, stop)), {
    status: 'complete', text: 'README checked.', evidence: 'claude-transcript-completion',
  })
})

test('age, a partial answer, missing hooks, or a continuation do not prove completion', () => {
  assert.equal(completionFromTranscript(task, transcript(root)), null)
  assert.equal(completionFromTranscript(task, transcript(root, answer)), null)
  assert.equal(completionFromTranscript(task, transcript(root, answer, { ...stop, preventedContinuation: true })), null)
  assert.equal(completionFromTranscript(task, transcript(root, { ...answer, message: { ...answer.message, stop_reason: 'tool_use' } }, stop)), null)
})

test('another session, typed request, duplicate matching prompt, or broken ancestry cannot release this task', () => {
  for (const changed of [{ ...root, sessionId: 'other' }, { ...root, origin: { kind: 'user' } },
    { ...root, message: { content: 'A different request' } }]) {
    assert.equal(completionFromTranscript(task, transcript(changed, answer, stop)), null)
  }
  assert.equal(completionFromTranscript(task, transcript(root, { ...root, uuid: 'duplicate' }, answer, stop)), null)
  assert.equal(completionFromTranscript(task, transcript(root, { ...answer, parentUuid: 'missing' }, stop)), null)
  assert.equal(completionFromTranscript(task, transcript(root, { ...answer, isSidechain: true }, stop)), null)
})

test('a newer prompt or malformed history cannot supply an old task completion', () => {
  const newer = { ...root, uuid: 'new-user', parentUuid: root.uuid, promptId: 'new-prompt', message: { content: 'New request' } }
  assert.equal(completionFromTranscript(task, transcript(root, newer, { ...answer, parentUuid: newer.uuid }, stop)), null)
  assert.equal(completionFromTranscript(task, transcript(root) + 'invalid\n' + transcript(answer, stop)), null)
})

const interrupted = { type: 'user', uuid: 'interrupted', parentUuid: answer.uuid,
  sessionId: task.sessionId, promptId: root.promptId,
  message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }

test('a native manual stop recovers the exact voice task without a completion callback', () => {
  for (const text of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
    assert.deepEqual(completionFromTranscript(task, transcript(root, answer,
      { ...interrupted, message: { content: [{ type: 'text', text }] } })), {
      status: 'aborted', text: '', evidence: 'claude-transcript-interruption',
    })
  }
})

test('interruption text in another prompt, subagent, tool result, or user quote cannot release a task', () => {
  for (const change of [
    { promptId: 'other-prompt' }, { isSidechain: true }, { parentUuid: 'unrelated' },
    { origin: { kind: 'user' } }, { isMeta: true }, { sessionId: 'other' },
    { message: { content: [{ type: 'tool_result', is_error: true, content: '[Request interrupted by user]' }] } },
    { message: { content: 'They said [Request interrupted by user]' } },
  ]) assert.equal(completionFromTranscript(task, transcript(root, answer, { ...interrupted, ...change })), null)
})
