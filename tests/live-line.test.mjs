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
  assert.deepEqual(liveLine(state, 2900), { speaker: 'Voice', text: 'Done.' })
  assert.equal(liveLine(state, 3000), null)
  assert.equal(liveLine({ ...base, transcript: 'Hello', userChangedAt: 1000, phase: 'idle' }, 1100), null)
  assert.equal(liveLine(base, 1000), null)
})

test('a long line keeps its newest words, cut at a word, behind an ellipsis', async () => {
  const { tail } = await import('../hooks/live-line.js')
  assert.equal(tail('short enough', 20), 'short enough')
  assert.equal(tail('one two three four five six seven', 16), '…five six seven')
  assert.ok(tail('one two three four five six seven', 16).length <= 16)
  assert.equal(tail('averyveryverylongwordwithoutspaces', 10), '…outspaces')
  assert.equal(tail('anything', 0), '')
})
