import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceHistory } from '../hooks/voice-history.js'

// What reaches the history: each final piece as flushHistory shows it.
function shown(history, now) {
  const out = []
  let piece
  while ((piece = history.next(now))) {
    history.posted(piece)
    if (!piece.row.delegated && !piece.quiet) out.push(`${piece.row.role}: ${piece.text}`)
  }
  return out
}

test('a classified turn stays out of history until its routing event, regardless of elapsed time', () => {
  const history = new VoiceHistory()
  history.classifierEnabled = true
  const user = history.observe('user', 'u1', 'Read the README title', 100)
  history.complete(user, 200)
  const reply = history.observe('assistant', 'r1', 'Checking.', 500)
  history.complete(reply, 600)
  assert.deepEqual(shown(history, 1_000_000), [], 'a finished caption cannot substitute for a routing decision')
  user.pendingDelegation = true
  assert.deepEqual(shown(history, 2_000_000), [], 'a coding route waits for its native prompt')
  history.attach('Read the README title')
  history.handOff('Read the README title')
  assert.deepEqual(shown(history, 2_000_000), [], 'the native prompt owns the request and acknowledgement')
  assert.equal(history.note('Read the README title'), 'Checking.')
})

test('an already posted acknowledgement does not absorb the coding result', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Check files', 100, 100)
  const acknowledgement = history.observe('assistant', 'a1', 'Checking.', 200, 200)
  history.complete(acknowledgement, 200)
  history.delivered(acknowledgement)
  history.attach('Check files', 300)
  history.handOff('Check files')
  const result = history.observe('assistant', 'r1', 'Three files changed.', 400, 400)
  history.complete(result, 400)
  assert.equal(history.note('Check files'), '')
  assert.deepEqual(shown(history, 400), ['assistant: Three files changed.'])
})

test('coding completion ends an unfilled acknowledgement slot before result speech', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Check files', 100, 100)
  history.attach('Check files', 200)
  history.handOff('Check files')
  history.stopWaiting()
  const result = history.observe('assistant', 'r1', 'Three files changed.', 400, 400)
  history.complete(result, 400)
  assert.equal(history.note('Check files'), '')
  assert.deepEqual(shown(history, 400), ['assistant: Three files changed.'])
})

test('reloaded history releases a coding result after its acknowledgement was already saved', () => {
  const history = new VoiceHistory()
  const request = history.observe('user', 'u1', 'Check files', 100, 100)
  request.delegated = true
  history.delivered(request)
  const acknowledgement = history.observe('assistant', 'a1', 'Checking.', 200, 200)
  history.complete(acknowledgement, 200)
  history.delivered(acknowledgement)
  const result = history.observe('assistant', 'r1', 'Three files changed.', 300, 300)
  history.complete(result, 300)
  assert.deepEqual(shown(history, 300), ['assistant: Three files changed.'])
})

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
  assert.deepEqual(shown(history, 3600), ['user: I mean, you are doing that part already, right?'])
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
  assert.deepEqual(shown(live, 4000), [])
  assert.deepEqual(shown(live, 4200), ['user: Just thinking out loud.'])
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

test('GPT Live: a listening sound then a 2 s pause does not end the turn or lose words', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'I was wondering', 100)
  history.observe('assistant', 'mm', 'Mm.', 300)
  history.finish('assistant', 400)
  history.observe('user', 'u1', 'I was wondering whether', 500)
  assert.deepEqual(shown(history, 2500), [], 'the sound is not a turn boundary')
  history.observe('user', 'u1', 'I was wondering whether this keeps the whole sentence.', 2600)
  assert.deepEqual(shown(history, 4000), [])
  history.observe('assistant', 'r1', 'It does.', 4200)
  history.finish('assistant', 4300)
  assert.deepEqual(shown(history, 5000), ['user: I was wondering whether this keeps the whole sentence.'])
})

test('a listening sound is consumed as a quiet piece, not shown', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Hello there', 100)
  history.observe('assistant', 'mm', 'Mm.', 200)
  history.observe('user', 'u1', 'Hello there friend', 900)
  history.finish('user', 1000)
  const pieces = []
  let piece
  while ((piece = history.next(4000))) { history.posted(piece); pieces.push(piece) }
  assert.deepEqual(pieces.map(item => [item.row.role, !!item.quiet]), [['user', false], ['assistant', true]])
  assert.equal(pieces[1].text, '')
})

test('a listening sound in a pause the user then talks on from does not end their turn', () => {
  const history = new VoiceHistory()
  const out = now => {
    const lines = []
    let piece
    while ((piece = history.next(now))) {
      history.posted(piece)
      if (!piece.quiet && !piece.row.delegated) lines.push(`${piece.row.role}: ${piece.row.text.trim()}`)
    }
    return lines
  }
  history.observe('user', 'u1', 'I mean, you are', 100)
  history.observe('assistant', 'mm', 'Mm-hmm.', 300)
  history.finish('assistant', 400)
  assert.deepEqual(out(2500), [], 'the user is only pausing')
  history.observe('user', 'u1', 'I mean, you are doing that part already, right?', 2600)
  history.observe('assistant', 'r1', 'Yes, I am.', 4000)
  history.finish('assistant', 4300)
  assert.deepEqual(out(5500), ['user: I mean, you are doing that part already, right?', 'assistant: Yes, I am.'])
})

test('a short real reply such as "Okay." still ends the turn and is written', () => {
  const history = new VoiceHistory()
  const out = now => {
    const lines = []
    let piece
    while ((piece = history.next(now))) {
      history.posted(piece)
      if (!piece.quiet) lines.push(`${piece.row.role}: ${piece.row.text.trim()}`)
    }
    return lines
  }
  history.observe('user', 'u1', 'Hang on one second.', 100)
  history.observe('assistant', 'r1', 'Okay.', 2000)
  history.finish('assistant', 2200)
  assert.deepEqual(out(3500), ['user: Hang on one second.', 'assistant: Okay.'])
})

test('a real reply is written even when the user transcript changes after the reply began', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Can you hear', 100)
  history.observe('assistant', 'r1', 'Yes, I can hear you clearly.', 1000)
  history.observe('user', 'u1', 'Can you hear me?', 1200)
  history.finish('assistant', 1500)
  const lines = []
  let piece
  while ((piece = history.next(3800))) {
    history.posted(piece)
    if (!piece.quiet) lines.push(`${piece.row.role}: ${piece.row.text.trim()}`)
  }
  assert.deepEqual(lines, ['user: Can you hear me?', 'assistant: Yes, I can hear you clearly.'])
})

test('a hand-off before the bubble is written means no bubble: the prompt is the one copy', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Can you read the README title?', 100)
  history.observe('assistant', 'r1', 'Checking.', 300)
  history.finish('assistant', 400)
  assert.equal(history.handOff('Can you read the README title?'), null, 'nothing was written yet')
  const lines = []
  let piece
  while ((piece = history.next(5000))) {
    history.posted(piece)
    if (!piece.quiet && !piece.row.delegated) lines.push(`${piece.row.role}: ${piece.row.text}`)
  }
  assert.deepEqual(lines, ['assistant: Checking.'])
})

test('a hand-off after the bubble was written reports the written words, so the prompt shows as a marker', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', ' The um, there is a case where it doubles up', 100)
  history.observe('assistant', 'r1', "I'm here. Checking.", 300)
  history.finish('assistant', 400)
  while (history.next(5000)) history.posted(history.next(5000))
  assert.equal(history.handOff('The um, there is a case where it doubles up Are you listening to me'),
    'The um, there is a case where it doubles up')
})

test('the marker carries only the words the bubble is missing', async () => {
  const { extraWords } = await import('../hooks/voice-history.js')
  assert.equal(extraWords('The um, there is a case where it doubles up', 'The um, there is a case where it doubles up Are you listening to me'), 'Are you listening to me')
  assert.equal(extraWords('Read the README title', 'Read the README title'), '')
  assert.equal(extraWords('Something else', 'A different request'), '')
})

test('words added to a caption after its bubble was written become a bubble of their own', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'No I like it. That looks good', 100)
  assert.deepEqual(shown(history, 4200), ['user: No I like it. That looks good'])
  // GPT Live keeps one caption when the voice does not answer, and adds the next words to it.
  history.observe('user', 'u1', 'No I like it. That looks good How long is it set to show?', 9000)
  assert.deepEqual(shown(history, 9500), [], 'the new words are still being spoken')
  history.observe('assistant', 'r1', 'Two seconds.', 10000)
  history.finish('assistant', 10300)
  assert.deepEqual(shown(history, 11600), ['user: How long is it set to show?', 'assistant: Two seconds.'])
})

test('the live line shows only the words not yet written as a bubble', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'That looks good', 100)
  assert.equal(history.unwritten('That looks good'), 'That looks good', 'nothing written yet')
  shown(history, 4200)
  assert.equal(history.unwritten('That looks good'), 'That looks good', 'the written turn may still linger whole')
  assert.equal(history.unwritten('That looks good How long'), 'How long')
  history.observe('user', 'u1', 'That looks good How long', 9000)
  assert.equal(history.unwritten('That looks good How long is it'), 'How long is it')
  assert.equal(history.unwritten('Something else entirely'), 'Something else entirely')
})

test('a continuation handed to Claude marks the prompt with only its new words', async () => {
  const { extraWords } = await import('../hooks/voice-history.js')
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'That looks good', 100)
  shown(history, 4200)
  history.observe('user', 'u1', 'That looks good How long is it set', 9000)
  const written = history.handOff('That looks good How long is it set')
  assert.equal(extraWords(written, 'That looks good How long is it set'), 'How long is it set')
  assert.deepEqual(shown(history, 20000), [], 'the continuation goes as the prompt, not a bubble')
})

// The fifth argument is when each caption was spoken (the provider's clock); the fourth, when it arrived.
test("the user's last words, transcribed after the voice began answering, end the user's turn ahead of the reply", () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Okay, it worked. It went off. It was', 100, 10)
  history.observe('assistant', 'r1', 'Good,', 1000, 900)
  // GPT Live files the last word as a caption of its own, transcribed after the reply began.
  history.observe('user', 'u2', 'quiet', 1300, 800)
  history.observe('assistant', 'r1', "Good, that's what we want.", 2000, 900)
  history.finish('assistant', 2500)
  assert.deepEqual(shown(history, 4000), ['user: Okay, it worked. It went off. It was quiet', "assistant: Good, that's what we want."])
})

test('words spoken before a reply come before it however long their transcript takes', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'It went off.', 100, 10)
  history.observe('assistant', 'r1', 'Good, that is what we want.', 1000, 900)
  history.finish('assistant', 1500)
  history.observe('user', 'u2', 'It was quiet', 9000, 800)
  assert.deepEqual(shown(history, 12000), ['user: It went off. It was quiet', 'assistant: Good, that is what we want.'])
})

test('late words after the user bubble was already written still come before the reply', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'It went off.', 100, 10)
  history.observe('assistant', 'mm', 'Mm.', 200, 150)
  assert.deepEqual(shown(history, 4500), ['user: It went off.'])
  history.observe('assistant', 'r1', 'Good,', 5000, 4900)
  history.observe('user', 'u2', 'It was quiet', 5400, 4800)
  history.observe('assistant', 'r1', 'Good, that is what we want.', 6000, 4900)
  history.finish('assistant', 6500)
  assert.deepEqual(shown(history, 9000), ['user: It was quiet', 'assistant: Good, that is what we want.'])
})

test('a hand-off draws the voice reply under the request, never as a bubble', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Read the README title', 100, 10)
  history.observe('assistant', 'r1', 'Okay,', 900, 800)
  history.handOff('Read the README title')
  history.attach('Read the README title', 1000)
  history.observe('assistant', 'r1', 'Okay, starting that.', 1500, 800)
  assert.equal(history.note('Read the README title'), 'Okay, starting that.')
  history.finish('assistant', 1600)
  assert.deepEqual(shown(history, 4000), [], 'the request is the prompt and the reply is its note')
  assert.ok(history.rows.every(row => row.delivered))
})

test('a reply that begins after the hand-off still becomes its note', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Read the README title', 100, 10)
  history.handOff('Read the README title')
  history.attach('Read the README title', 1000)
  assert.equal(history.note('Read the README title'), '')
  history.observe('assistant', 'r1', 'Starting that.', 1500, 1200)
  assert.equal(history.note('Read the README title'), 'Starting that.')
  // Later speech is ordinary conversation.
  history.finish('assistant', 1700)
  history.observe('user', 'u2', 'Thanks', 3000, 2900)
  history.observe('assistant', 'r2', 'Sure.', 4000, 3900)
  history.finish('assistant', 4100)
  assert.deepEqual(shown(history, 8000), ['user: Thanks', 'assistant: Sure.'])
  assert.equal(history.note('Read the README title'), 'Starting that.')
})

test("a progress report is not the hand-off's reply", () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'Read the README title', 100, 10)
  history.handOff('Read the README title')
  history.attach('Read the README title', 1000)
  history.stopWaiting()
  history.observe('assistant', 'r1', 'Claude is reading the file.', 5000, 4900)
  history.finish('assistant', 5100)
  assert.equal(history.note('Read the README title'), '')
  assert.deepEqual(shown(history, 8000), ['assistant: Claude is reading the file.'])
})

test('a user caption spoken after the reply is a new turn', () => {
  const history = new VoiceHistory()
  history.observe('user', 'u1', 'How long is it set?', 100)
  history.observe('assistant', 'r1', 'Two seconds.', 1000)
  history.finish('assistant', 1500)
  history.observe('user', 'u2', 'Thanks', 3000)
  history.finish('user', 3100)
  assert.deepEqual(shown(history, 7000), ['user: How long is it set?', 'assistant: Two seconds.', 'user: Thanks'])
})
