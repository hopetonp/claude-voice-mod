export default function VoiceToggle(_, surface) {
  surface.onPointer(event => {
    if (event.type === 'up' && event.button === 'left'
      && event.x >= 0 && event.x < 4 && event.y >= 0 && event.y < 1) {
      surface.post({ action: 'toggle' })
    }
  })
  return surface.elements.Box({ width: 4, height: 1, children: [] })
}
