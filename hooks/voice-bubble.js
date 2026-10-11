// The voice's reply drawn under a request it handed to Claude, in the same look as the voicemesh-said
// companion's voice bubble (said-plugin/hooks/register.js); keep the two alike.

const voiceIcon = ink => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Voice">${[[.15, 5.2, 5.6], [3.65, 0, 16], [7.15, 3.2, 9.6], [10.65, 1.5, 13], [14.15, 5.2, 5.6]].map(([x, y, height]) => `<rect x="${x}" y="${y}" width="1.7" height="${height}" rx="0.85" fill="${ink}"/>`).join('')}</svg>`

/** `ui` is `$.ui.resolve(e)`; `chat` is the Chat bubbles setting. */
export function voiceBubble(ui, text, chat = true, theme = 'light') {
  const { Box, Svg, Text } = ui
  if (!chat) return Box({ width: '100%', children: [Text({ children: [text] })] })
  const fill = theme === 'dark' ? '#383836' : '#eeede9'
  const ink = theme === 'dark' ? '#f4f4f1' : '#252523'
  const icon = Svg ? Svg({ source: voiceIcon(ink), width: 16, height: 16, alt: 'Voice' }) : Text({ dimColor: true, children: ['♪'] })
  const body = Box({ backgroundColor: fill, borderStyle: 'round', borderColor: fill, paddingX: 1, paddingY: 0.6, flexShrink: 1, flexDirection: 'row', columnGap: 1, alignItems: 'flex-start',
    children: [icon, Text({ color: ink, children: [text] })] })
  return Box({ flexDirection: 'row', justifyContent: 'flex-start', width: '100%', children: [body, Box({ width: '20%', flexShrink: 0 })] })
}
