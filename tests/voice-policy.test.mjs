import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { codingAcknowledgement, liveInstructions, noHandoffTalk, spokenTechnicalText } from '../host/voice-policy.js'

test('questions about images or the screen go to the coding session, stated early', () => {
  const text = liveInstructions()
  const rule = text.indexOf('whether you can see something')
  assert.ok(rule > 0, 'the rule covers "can you see" questions')
  assert.ok(rule < text.indexOf('Speak naturally'), 'the rule comes right after the opening line, before the speaking style')
  assert.match(text, /delegate that exact question to the coding session/)
  assert.match(text, /never say that you cannot see it, cannot see images, or that the user should describe it/)
  assert.equal(text.match(/cannot see/g).length, 3, 'stated once, not duplicated')
})

test('every provider gets example acknowledgements and no routing talk', async () => {
  assert.match(codingAcknowledgement, /"I'm on it," "One moment, please," or "Let me check that\."/)
  assert.match(codingAcknowledgement, /examples, not a fixed list/)
  assert.ok(liveInstructions().includes(codingAcknowledgement), 'realtime providers and GPT Live')
  const pipeline = await readFile(new URL('../media/pipeline.js', import.meta.url), 'utf8')
  assert.match(pipeline, /spoken replies\. \$\{codingAcknowledgement\}/, 'pipeline providers')
})

test('no reply, result, or acknowledgement mentions a handoff or reads technical text aloud', async () => {
  assert.match(noHandoffTalk, /Never say that you passed, handed, sent, forwarded, delegated, or dispatched anything/)
  assert.match(noHandoffTalk, /never mention a coding agent, coding session, another assistant, a tool, or a handoff/)
  assert.match(spokenTechnicalText, /Never read file paths, shell commands, URLs, code, or long identifiers aloud/)
  for (const rule of [noHandoffTalk, spokenTechnicalText]) {
    assert.ok(liveInstructions().includes(rule), 'realtime providers and GPT Live')
    for (const file of ['../media/pipeline.js', '../host/realtime-voice.js']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8')
      const name = rule === noHandoffTalk ? 'noHandoffTalk' : 'spokenTechnicalText'
      assert.ok(source.includes(`\${${name}}`), `${file} speaks with ${name}`)
    }
  }
})
