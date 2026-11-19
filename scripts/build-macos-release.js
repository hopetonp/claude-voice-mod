import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageReleaseApp } from './stage-release-app.js'
import { assertNodeVersion, minimumNodeVersion } from '../npm-installer/node-requirement.cjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const version = JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version
const name = `voicemesh-claude-macos-${process.arch}-${version}`
const args = process.argv.slice(2)
const zip = args.includes('--zip')
const paths = args.filter(arg => arg !== '--zip')
if (paths.length > 1 || paths.some(arg => arg.startsWith('--'))) throw new Error('Usage: node scripts/build-macos-release.js [output-directory] [--zip]')
const output = resolve(paths[0] ?? join(root, 'release', name))
const settingsApp = join(root, 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app')

if (process.platform !== 'darwin') throw new Error('Build the macOS release on macOS')
assertNodeVersion()
if (!['arm64', 'x64'].includes(process.arch)) throw new Error(`Unsupported architecture: ${process.arch}`)
if (output === root || existsSync(output) || (zip && existsSync(`${output}.zip`))) throw new Error(`Release output already exists: ${output}`)
for (const path of [settingsApp, join(root, '.plugin-build'), join(root, 'dist'), join(root, 'dist-setup')]) {
  if (!existsSync(path)) throw new Error(`Missing build artifact: ${path}`)
}
const copy = async (source, destination) => cp(join(root, source), join(output, destination), { recursive: true })

await stageReleaseApp(join(output, 'app'))
await mkdir(join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos'), { recursive: true })
await cp(settingsApp, join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app'), { recursive: true })
const packagedSettings = join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app')
execFileSync('/usr/bin/strip', ['-x', join(packagedSettings, 'Contents', 'MacOS', 'voicemesh-settings-window')])
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', packagedSettings])
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', packagedSettings])
await copy('.plugin-build', 'plugin-marketplace')
await copy(join('macos', 'install.sh'), 'install.sh')
await copy(join('macos', 'uninstall.sh'), 'uninstall.sh')

await writeFile(join(output, 'release.json'), JSON.stringify({ version, architecture: process.arch, requiredNodeVersion: minimumNodeVersion }, null, 2) + '\n')
if (zip) execFileSync('ditto', ['-c', '-k', '--keepParent', output, `${output}.zip`], { stdio: 'inherit' })
console.log(`macOS package: ${output}${zip ? ` (ZIP: ${output}.zip)` : ''}`)
