import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

export function parseReleaseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (!['--node-dir', '--settings-exe', '--output'].includes(flag) || !args[index + 1]) {
      throw new Error('Usage: node scripts/build-windows-release.js --node-dir <official Windows Node directory> [--settings-exe <exe>] [--output <directory>]')
    }
    options[flag.slice(2)] = resolve(args[index + 1])
  }
  if (!options['node-dir']) throw new Error('--node-dir is required')
  return options
}

export function assertNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 19)) {
    throw new Error(`Bundled Node must be >=22.19; found ${version.trim()}`)
  }
}

async function copyRequired(source, destination) {
  if (!existsSync(source)) throw new Error(`Missing build artifact: ${source}`)
  await cp(source, destination, { recursive: true })
}

export async function buildWindowsRelease(options, { platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'win32') throw new Error('Build the Windows release on Windows so npm installs Windows dependencies')
  const nodeDir = options['node-dir']
  const nodeExe = join(nodeDir, 'node.exe')
  if (!existsSync(nodeExe) || !existsSync(join(nodeDir, 'LICENSE')) || !existsSync(join(nodeDir, 'npm.cmd'))) {
    throw new Error('--node-dir must point to an official Windows Node distribution with node.exe, npm.cmd, and LICENSE')
  }
  const version = String(run(nodeExe, ['--version'], { encoding: 'utf8' })).trim()
  assertNodeVersion(version)
  const architecture = String(run(nodeExe, ['-p', 'process.arch'], { encoding: 'utf8' })).trim()
  if (!['x64', 'arm64'].includes(architecture) || architecture !== process.arch) {
    throw new Error(`Bundled Node architecture ${architecture} does not match Windows build architecture ${process.arch}`)
  }
  const settingsExe = options['settings-exe'] ?? join(root, 'settings-window', 'src-tauri', 'target', 'release', 'voicemesh-settings-window.exe')
  const output = options.output ?? join(root, 'release', `voicemesh-claude-win-${architecture}`)
  const nodeRelativeOutput = relative(nodeDir, output)
  if (output === root || nodeRelativeOutput === '' || (!nodeRelativeOutput.startsWith('..') && !isAbsolute(nodeRelativeOutput))) {
    throw new Error('Release output must not replace the project or sit inside the Node distribution')
  }
  if (existsSync(output)) throw new Error(`Release output already exists: ${output}`)
  const marketplace = join(root, '.plugin-build')
  for (const artifact of [settingsExe, marketplace, join(root, 'dist'), join(root, 'dist-setup')]) {
    if (!existsSync(artifact)) throw new Error(`Missing build artifact: ${artifact}`)
  }

  await mkdir(join(output, 'app', 'scripts'), { recursive: true })
  await cp(nodeDir, join(output, 'runtime'), { recursive: true })
  for (const folder of ['host', 'dist', 'dist-setup']) await copyRequired(join(root, folder), join(output, 'app', folder))
  await copyRequired(join(root, 'scripts', 'launch-host.js'), join(output, 'app', 'scripts', 'launch-host.js'))
  for (const file of ['package.json', 'package-lock.json']) await copyRequired(join(root, file), join(output, 'app', file))
  await copyRequired(join(root, 'vendor'), join(output, 'app', 'vendor'))
  const binaryDestination = join(output, 'app', 'settings-window', 'src-tauri', 'target', 'release', basename(settingsExe))
  await mkdir(dirname(binaryDestination), { recursive: true })
  await cp(settingsExe, binaryDestination)
  await cp(marketplace, join(output, 'plugin-marketplace'), { recursive: true })
  for (const file of ['install.ps1', 'uninstall.ps1', 'launch-host.vbs']) {
    await copyRequired(join(root, 'windows', file), join(output, file))
  }

  const npmCli = join(output, 'runtime', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(npmCli)) throw new Error('The bundled Node distribution is missing npm-cli.js')
  run(join(output, 'runtime', 'node.exe'), [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: join(output, 'app'), stdio: 'inherit', env: { ...process.env, PATH: `${join(output, 'runtime')};${process.env.PATH ?? ''}` },
  })
  run(join(output, 'runtime', 'node.exe'), ['--input-type=module', '-e', "await import('@voicemesh/composer/server'); await import('ws')"], {
    cwd: join(output, 'app'), stdio: 'inherit',
  })
  await writeFile(join(output, 'release.json'), JSON.stringify({ nodeVersion: version, architecture,
    version: JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version }, null, 2) + '\n')
  console.log(`Windows release staged: ${output}`)
  return output
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildWindowsRelease(parseReleaseArgs(process.argv.slice(2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
