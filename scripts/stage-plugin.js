import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = join(root, '.plugin-build')
const plugin = join(output, 'plugins', 'voicemesh-controls')

await rm(output, { recursive: true, force: true })
await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
await cp(join(root, '.claude-plugin', 'plugin.json'), join(plugin, '.claude-plugin', 'plugin.json'))
await cp(join(root, 'hooks'), join(plugin, 'hooks'), { recursive: true })
// The companion answers /voice-said for the voice Mod, whose own command runs skip its own hooks.
await cp(join(root, 'said-plugin'), join(output, 'plugins', 'voicemesh-said'), { recursive: true })
await mkdir(join(output, '.claude-plugin'), { recursive: true })
await writeFile(join(output, '.claude-plugin', 'marketplace.json'), JSON.stringify({
  name: 'voicemesh-local',
  description: 'VoiceMesh voice controls for Claude',
  owner: { name: 'Hopeton Palmer' },
  plugins: [
    { name: 'voicemesh-controls', source: './plugins/voicemesh-controls' },
    { name: 'voicemesh-said', source: './plugins/voicemesh-said' },
  ],
}, null, 2) + '\n')
console.log(output)
