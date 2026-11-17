import test from 'node:test'
import assert from 'node:assert/strict'
import { recordSubmissionRejection, pausedSubmissionNotice } from '../host/submission-rejection.js'

const task = { id: 'request-1', sessionId: 'chat-1', text: 'Check the project', status: 'submitting', turnId: null }
const reason = 'the session was stopped and nobody has sent input since'

test('a stopped-session rejection preserves the request before reporting the resume action', async () => {
  const events = []
  let saved
  const rejection = await recordSubmissionRejection(task, reason, {
    now: () => 1234, persist: async value => { saved = value; events.push('saved') },
    notify: async text => { events.push(text); return true },
  })
  assert.deepEqual(events, ['saved', pausedSubmissionNotice])
  assert.equal(saved.id, task.id)
  assert.equal(saved.text, task.text)
  assert.equal(saved.status, 'claimed')
  assert.equal(saved.submissionState, 'rejected')
  assert.deepEqual(rejection, { reason, at: 1234 })
})

test('other refusals are not called a stopped session, and duplicate notices stay silent', async () => {
  const notices = []
  await recordSubmissionRejection(task, 'A plugin refused the prompt', { persist: async () => {}, notify: text => notices.push(text) })
  assert.match(notices[0], /work has not started/)
  assert.doesNotMatch(notices[0], /session is paused/)
  await recordSubmissionRejection({ ...task, submissionRejection: { reason } }, reason, {
    persist: async () => {}, notify: text => notices.push(text),
  })
  assert.equal(notices.length, 1)
})

test('a voice notification failure does not lose the saved request or its rejection reason', async () => {
  let saved
  await recordSubmissionRejection(task, reason, {
    persist: async value => { saved = value }, notify: async () => { throw new Error('voice unavailable') },
  })
  assert.equal(saved.submissionState, 'rejected')
  assert.equal(saved.submissionRejection.reason, reason)
})
