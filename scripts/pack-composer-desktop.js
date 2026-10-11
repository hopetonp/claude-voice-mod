// Add Composer's shared desktop support to the existing runtime without replacing
// voice bundles from a newer source checkout with an older local build.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const composer = process.argv[2] && resolve(process.argv[2])
if (!composer) throw new Error('Pass the Composer source directory after building its JavaScript and types')
const baseline = join(root, 'vendor', 'voicemesh-composer-0.2.8.tgz')
const staging = join(root, '.build-tools', `composer-desktop-${Date.now()}`)
await mkdir(staging, { recursive: true })
execFileSync('tar', ['-xf', baseline, '-C', staging], { windowsHide: true })
const contents = join(staging, 'package')
const manifestPath = join(contents, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
async function hashes(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = {}
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) Object.assign(result, await hashes(path, relative))
    else result[relative] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  return result
}
const voiceHashes = await hashes(join(contents, 'lib'))
for (const file of ['lib/desktop.js', 'lib/desktop-server.js', 'lib/types/src/desktop.d.ts',
  'lib/types/src/desktop-server.d.ts', 'lib/types/src/server/desktop.d.ts']) {
  await mkdir(dirname(join(contents, file)), { recursive: true })
  await cp(join(composer, file), join(contents, file))
}
await cp(join(composer, 'native', 'settings-window'), join(contents, 'native', 'settings-window'), { recursive: true })
manifest.version = JSON.parse(await readFile(join(composer, 'package.json'), 'utf8')).version
manifest.exports['./desktop'] = { types: './lib/types/src/desktop.d.ts', default: './lib/desktop.js' }
manifest.exports['./desktop/server'] = { types: './lib/types/src/desktop-server.d.ts', default: './lib/desktop-server.js' }
manifest.files = [...new Set([...(manifest.files || ['lib']), 'native/settings-window'])]
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const updatedHashes = await hashes(join(contents, 'lib'))
for (const [file, hash] of Object.entries(voiceHashes)) {
  if (updatedHashes[file] !== hash) throw new Error(`Existing Composer runtime changed: ${file}`)
}
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json',
  '--pack-destination', join(root, 'vendor')], { cwd: contents, windowsHide: true, encoding: 'utf8' }))
console.log(`Packed ${packed[0].filename}; all ${Object.keys(voiceHashes).length} existing runtime files preserved.`)
