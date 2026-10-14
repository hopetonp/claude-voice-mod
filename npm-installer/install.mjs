#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const checksums = {
  'darwin-arm64': 'd1600d96d286d9a0788fba716797aa4a0a71f7b11269b17c32036b49880e7c1b',
  'darwin-x64': 'fe0be0bd99260dad5074c84f4488669dc3bcd8d045b9eaa520f71b5a37fb301e',
  'win32-x64': '3257f3ed9f5d8f3b852ed68cd6e34ed3efa6ea2cda983d92edb76387bdf4cef0',
}

export function releaseFor(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`
  const checksum = checksums[key]
  if (!checksum) throw new Error(`VoiceMesh does not have a prebuilt package for ${key}`)
  const os = platform === 'darwin' ? 'macos' : 'win'
  const archive = `voicemesh-claude-${os}-${arch}-${version}.zip`
  return { archive, checksum, url: `https://github.com/hopetonp/claude-voice-mod/releases/download/v${version}/${archive}` }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
}

function powershellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function install() {
  if (process.platform === 'darwin' && process.getuid() === 0) {
    throw new Error('Run npm as your normal Mac user, without sudo, so VoiceMesh installs for that user')
  }
  const release = releaseFor()
  const temp = await mkdtemp(join(tmpdir(), 'voicemesh-npm-'))
  try {
    const zip = join(temp, release.archive)
    const response = await fetch(release.url, { signal: AbortSignal.timeout(300000) })
    if (!response.ok || !response.body) throw new Error(`Could not download VoiceMesh: HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip))
    if (await sha256(zip) !== release.checksum) throw new Error('VoiceMesh package checksum does not match the published release')

    const unpacked = join(temp, 'unpacked')
    if (process.platform === 'darwin') run('ditto', ['-x', '-k', zip, unpacked])
    else run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${powershellQuote(zip)} -DestinationPath ${powershellQuote(unpacked)}`])
    const folder = process.platform === 'darwin'
      ? `voicemesh-claude-macos-${process.arch}-${version}`
      : `voicemesh-claude-win-${process.arch}`
    const packageDir = join(unpacked, folder)
    const metadata = JSON.parse(await readFile(join(packageDir, 'release.json'), 'utf8'))
    if (metadata.version !== version || metadata.architecture !== process.arch) throw new Error('VoiceMesh package version or architecture does not match')

    if (process.platform === 'darwin') run('sh', [join(packageDir, 'install.sh')])
    else run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(packageDir, 'install.ps1')])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // pnpm dlx can run both postinstall and the binary; install only from its binary.
  const shouldInstall = process.env.npm_lifecycle_event !== 'postinstall'
    || process.env.npm_config_user_agent?.startsWith('npm/')
  if (shouldInstall) {
    install().catch(error => { console.error(`VoiceMesh installation failed: ${error.message}`); process.exitCode = 1 })
  }
}
