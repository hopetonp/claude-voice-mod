import { desktopRunning, watchDesktop } from '../host/desktop-lifecycle.js'
import { readFile } from 'node:fs/promises'

// Local development may borrow Composer Playground's existing connection.
// A normal installation omits this argument and uses this harness's own settings.
const developmentConnections = process.argv[2]
if (developmentConnections) {
  const connections = JSON.parse(await readFile(developmentConnections, 'utf8'))
  const live = connections['openai-live']
  if (!live?.key || !live?.model || !live?.voice) throw new Error('Development GPT Live connection is incomplete')
  process.env.OPENAI_API_KEY = live.key
  process.env.OPENAI_MODEL = live.model
  process.env.OPENAI_VOICE = live.voice
}

// Packaged hosts follow the desktop app; direct `node host/server.js` remains a dev server.
const managed = ['darwin', 'win32'].includes(process.platform)
if (managed && await desktopRunning() === false) process.exit(0)
const { shutdown } = await import('../host/server.js')
if (managed) watchDesktop({ onExit: shutdown })
