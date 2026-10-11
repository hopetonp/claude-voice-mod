import assert from 'node:assert/strict'
import test from 'node:test'
import { voiceBubble } from '../hooks/voice-bubble.js'

const element = type => props => ({ type, ...props })
const ui = { Box: element('Box'), Text: element('Text'), Svg: element('Svg') }

test('the handoff reply bubble uses the active Claude theme', () => {
  const light = voiceBubble(ui, 'Checking', true, 'light').children[0]
  const dark = voiceBubble(ui, 'Checking', true, 'dark').children[0]
  assert.equal(light.backgroundColor, '#eeede9')
  assert.equal(light.children[1].color, '#252523')
  assert.equal(dark.backgroundColor, '#383836')
  assert.equal(dark.children[1].color, '#f4f4f1')
})
