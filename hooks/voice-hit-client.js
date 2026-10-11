// A click region laid over one of the voice bar's icons. Like the voice toggle, it posts its action
// through the Client channel, which the Mod answers in its ui.message hook.
export default function VoiceHit(props, surface) {
  const { action, width = 3, height = 1.2 } = props ?? {}
  surface.onPointer(event => {
    if (event.type === 'up' && event.button === 'left'
      && event.x >= 0 && event.x < width && event.y >= 0 && event.y < height) {
      surface.post({ action })
    }
  })
  return surface.elements.Box({ width, height, children: [] })
}
