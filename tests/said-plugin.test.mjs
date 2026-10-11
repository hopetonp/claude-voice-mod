import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSaid } from '../said-plugin/hooks/register.js'

test('voice-said arguments name the speaker and carry the whole caption', () => {
  assert.deepEqual(parseSaid('you How is it going?'), { mine: true, text: 'How is it going?' })
  assert.deepEqual(parseSaid('voice Going well.\nThanks.'), { mine: false, text: 'Going well.\nThanks.' })
  assert.deepEqual(parseSaid('stray text'), { mine: false, text: 'stray text' })
})

test('the echo row of a /voice-said run carries the speaker and caption', async () => {
  const { echoArgs } = await import('../said-plugin/hooks/register.js')
  assert.equal(echoArgs('/voice-said you How is it going?'), 'you How is it going?')
  assert.equal(echoArgs('/voice-said'), '')
  assert.equal(echoArgs('An ordinary prompt'), null)
  assert.equal(echoArgs('/voice-saidx nope'), null)
})

test("turns draw as chat bubbles by default; with bubbles off the voice's turns are plain text", async () => {
  const { register } = await import('../said-plugin/hooks/register.js?plain-style')
  const handlers = new Map()
  register((name, options, handler) => handlers.set(`${name}:${options?.component ?? ''}`, handler ?? options))
  let file = null
  let theme = 'light'
  const element = type => props => ({ type, ...props })
  const $ = {
    env: { get: async () => '/home/test' },
    fs: { read: async path => {
      if (path === '/home/test/Library/Application Support/Claude/config.json') return JSON.stringify({ userThemeMode: theme })
      if (path !== '/home/test/.claude/voicemesh-controls/display.json' || file === null) throw new Error('missing')
      return file
    } },
    ui: { resolve: () => ({ Box: element('Box'), Text: element('Text'), Svg: element('Svg') }) },
  }
  const draw = args => handlers.get('ui.render:CommandOutput')($, { component: 'CommandOutput', props: { command: 'voice-said', args } })
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    const chat = await draw('you Hello there')
    assert.equal(chat.justifyContent, 'flex-end', 'your bubble sits on the right')
    assert.equal(chat.children[1].backgroundColor, '#eeede9', 'light Claude uses a light bubble')
    assert.equal(chat.children[1].children[0].color, '#252523')
    theme = 'dark'
    now = 3000
    const dark = await draw('you Hello there')
    assert.equal(dark.children[1].backgroundColor, '#383836', 'dark Claude uses a dark bubble')
    assert.equal(dark.children[1].children[0].color, '#f4f4f1')
    file = JSON.stringify({ chatBubbles: false })
    now = 5000
    const mine = await draw('you Hello there')
    assert.equal(mine.justifyContent, 'flex-end', "the user's turns keep their bubble")
    const voice = await draw('voice Hi, how can I help?')
    const drawn = JSON.stringify(voice)
    assert.equal(drawn.includes('#212121'), false, "the voice's turns have no bubble")
    assert.equal(drawn.includes('"type":"Svg"'), false, 'and no icon')
    assert.equal(voice.width, '100%', 'and run across the whole row')
  } finally { Date.now = realNow }
})
