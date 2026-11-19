import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageReleaseApp } from './stage-release-app.js'
import { assertNodeVersion, minimumNodeVersion } from '../npm-installer/node-requirement.cjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export { assertNodeVersion }

export function parseReleaseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (!['--settings-exe', '--output'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: node scripts/build-windows-release.js [--settings-exe <exe>] [--output <directory>]')
    }
    options[flag.slice(2)] = resolve(args[index + 1])
  }
  return options
}

export async function buildWindowsRelease(options, { platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('Build the Windows release on Windows')
  assertNodeVersion()
  const architecture = process.arch
  if (!['x64', 'arm64'].includes(architecture)) throw new Error(`Unsupported architecture: ${architecture}`)
  const settingsExe = options['settings-exe'] ?? join(root, 'settings-window', 'src-tauri', 'target', 'release', 'voicemesh-settings-window.exe')
  const output = options.output ?? join(root, 'release', `voicemesh-claude-win-${architecture}`)
  if (output === root || existsSync(output)) throw new Error(`Release output already exists: ${output}`)
  for (const artifact of [settingsExe, join(root, '.plugin-build'), join(root, 'dist'), join(root, 'dist-setup')]) {
    if (!existsSync(artifact)) throw new Error(`Missing build artifact: ${artifact}`)
  }
  await stageReleaseApp(join(output, 'app'))
  const binaryDestination = join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', basename(settingsExe))
  await mkdir(dirname(binaryDestination), { recursive: true })
  await cp(settingsExe, binaryDestination)
  await cp(join(root, '.plugin-build'), join(output, 'plugin-marketplace'), { recursive: true })
  for (const file of ['install.ps1', 'uninstall.ps1', 'launch-host.vbs', 'launch-host.ps1', 'host-process.ps1']) {
    await cp(join(root, 'windows', file), join(output, file))
  }
  const version = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8')).version
  await writeFile(join(output, 'release.json'), JSON.stringify({ version, architecture, requiredNodeVersion: minimumNodeVersion }, null, 2) + '\n')
  console.log(`Windows release staged: ${output}`)
  return output
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildWindowsRelease(parseReleaseArgs(process.argv.slice(2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
