// Answers and draws /voice-said for voicemesh-controls. A plugin's own $.command.run skips that
// plugin's command.run hooks, so the voice Mod runs this command and this companion answers it.
// A command prints a transcript row without starting a model turn.

/** `/voice-said you <text>` or `/voice-said voice <text>`. */
export function parseSaid(args) {
  const match = /^(you|voice)\s+([\s\S]*)$/.exec(args.trim())
  return match ? { mine: match[1] === 'you', text: match[2].trim() } : { mine: false, text: args.trim() }
}

// The five-bar wave of the voice button, so a voice bubble reads as the voice assistant's.
const voiceIcon = ink => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Voice">${[[.15, 5.2, 5.6], [3.65, 0, 16], [7.15, 3.2, 9.6], [10.65, 1.5, 13], [14.15, 5.2, 5.6]].map(([x, y, height]) => `<rect x="${x}" y="${y}" width="1.7" height="${height}" rx="0.85" fill="${ink}"/>`).join('')}</svg>`

/** The text after `/voice-said` in the command's echo row, or null for any other row. */
export function echoArgs(text) {
  const match = /^\/voice-said(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? match[1] ?? '' : null
}

// Whether turns draw as chat bubbles (the default) or as plain text: the voice Mod's settings write it
// to a file both plugins read. Read at most once a second, since every visible turn draws with it.
let display = { chatBubbles: false, at: -Infinity }
let appearance = { theme: 'light', at: -Infinity }
async function desktopTheme($) {
  if (Date.now() - appearance.at < 1000) return appearance.theme
  const home = await $.env.get('HOME').catch(() => '')
  const appdata = await $.env.get('APPDATA').catch(() => '')
  let theme = 'light'
  for (const path of [appdata && `${appdata}/Claude/config.json`, home && `${home}/Library/Application Support/Claude/config.json`, home && `${home}/.config/Claude/config.json`].filter(Boolean)) {
    try {
      const mode = JSON.parse(await $.fs.read(path)).userThemeMode
      if (mode === 'light' || mode === 'dark') { theme = mode; break }
    } catch {}
  }
  appearance = { theme, at: Date.now() }
  return theme
}
async function chatBubbles($) {
  if (Date.now() - display.at < 1000) return display.chatBubbles
  let chat = false
  try {
    const home = await $.env.get('HOME')
    chat = JSON.parse(await $.fs.read(`${home}/.claude/voicemesh-controls/display.json`)).chatBubbles === true
  } catch {}
  display = { chatBubbles: chat, at: Date.now() }
  return chat
}

async function bubble($, e, args) {
  const { Box, Svg, Text } = $.ui.resolve(e)
  const { mine, text } = parseSaid(args)
  const dark = (await desktopTheme($)) === 'dark'
  const fill = dark ? '#383836' : '#eeede9'
  const ink = dark ? '#f4f4f1' : '#252523'
  // Surfaces without SVG (the terminal) show a text glyph instead.
  const icon = Svg ? Svg({ source: voiceIcon(ink), width: 16, height: 16, alt: 'Voice' }) : Text({ dimColor: true, children: ['♪'] })
  // Plain style, as most apps show a voice conversation: the voice's turns read like Claude's own replies,
  // plain text across the whole row with no bubble or icon; the user's turns keep their bubble.
  if (!mine && !(await chatBubbles($))) return Box({ width: '100%', children: [Text({ children: [text] })] })
  // Boxes have no max width: a 20% spacer on the far side caps a long bubble near the native
  // bubble's 80% width, and the bubble shrinks into the rest so its text wraps.
  const spacer = Box({ width: '20%', flexShrink: 0 })
  // The native prompt bubble's fill and height, measured from the desktop dark theme (about 36px
  // tall). Boxes have no corner radius; a round border in the fill colour rounds the corners.
  const body = Box({ backgroundColor: fill, borderStyle: 'round', borderColor: fill, paddingX: 1, paddingY: 0.6, flexShrink: 1, flexDirection: 'row', columnGap: 1, alignItems: 'flex-start',
    children: [...(mine ? [] : [icon]), Text({ color: ink, children: [text] })] })
  return Box({ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', width: '100%',
    children: mine ? [spacer, body] : [body, spacer],
  })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'voice-said', description: 'Shows a finished voice caption as a bubble (run by VoiceMesh)', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'voice-said' }, async ($, e) => ({ text: parseSaid(e.args).text }))

  // Each /voice-said run is two transcript rows: the command's echo and its output. The bubble is
  // drawn in the output row and the echo is emptied; drawing it in the echo row instead (0.1.11)
  // left every gap larger, so the output row is where it belongs.
  on('ui.render', { component: 'CommandOutput', props: { command: 'voice-said' } }, async ($, e) => bubble($, e, e.props.args))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (echoArgs(e.props.text) !== null) return $.ui.resolve(e).Box({ children: [] })
    return next(e)
  })
}
