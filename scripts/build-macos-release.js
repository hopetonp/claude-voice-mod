import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const version = JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version
const name = `voicemesh-claude-macos-${process.arch}-${version}`
const args = process.argv.slice(2)
const zip = args.includes('--zip')
const paths = args.filter(arg => arg !== '--zip')
if (paths.length > 1 || paths.some(arg => arg.startsWith('--'))) throw new Error('Usage: node scripts/build-macos-release.js [output-directory] [--zip]')
const output = resolve(paths[0] ?? join(root, 'release', name))
const node = process.execPath
const nodeLicense = join(dirname(dirname(node)), 'LICENSE')
const settingsApp = join(root, 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app')

if (process.platform !== 'darwin') throw new Error('Build the macOS release on macOS')
if (!['arm64', 'x64'].includes(process.arch)) throw new Error(`Unsupported architecture: ${process.arch}`)
if (output === root || existsSync(output) || (zip && existsSync(`${output}.zip`))) throw new Error(`Release output already exists: ${output}`)
for (const path of [nodeLicense, settingsApp, join(root, '.plugin-build'), join(root, 'dist'), join(root, 'dist-setup')]) {
  if (!existsSync(path)) throw new Error(`Missing build artifact: ${path}`)
}
const copy = async (source, destination) => cp(join(root, source), join(output, destination), { recursive: true })

await mkdir(join(output, 'runtime'), { recursive: true })
await mkdir(join(output, 'app', 'scripts'), { recursive: true })
await cp(node, join(output, 'runtime', 'node'))
await cp(nodeLicense, join(output, 'runtime', 'LICENSE'))
for (const folder of ['host', 'dist', 'dist-setup', 'vendor']) await copy(folder, join('app', folder))
for (const file of ['package.json', 'package-lock.json']) await copy(file, join('app', file))
for (const file of ['launch-host.js', 'install-host-macos.js']) await copy(join('scripts', file), join('app', 'scripts', file))
await mkdir(join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos'), { recursive: true })
await cp(settingsApp, join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceMesh Settings.app'), { recursive: true })
await copy('.plugin-build', 'plugin-marketplace')
await copy(join('macos', 'install.sh'), 'install.sh')
await copy(join('macos', 'uninstall.sh'), 'uninstall.sh')

execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(output, 'app'), stdio: 'inherit' })
execFileSync(join(output, 'runtime', 'node'), ['--input-type=module', '-e', "await import('@voicemesh/composer/server'); await import('@voicemesh/settings-editor'); await import('ws')"], { cwd: join(output, 'app'), stdio: 'inherit' })
await writeFile(join(output, 'release.json'), JSON.stringify({ version, architecture: process.arch, nodeVersion: process.version }, null, 2) + '\n')
if (zip) execFileSync('ditto', ['-c', '-k', '--keepParent', output, `${output}.zip`], { stdio: 'inherit' })
console.log(`macOS package: ${output}${zip ? ` (ZIP: ${output}.zip)` : ''}`)
