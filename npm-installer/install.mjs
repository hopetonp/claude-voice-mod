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
  'darwin-arm64': 'e85bd16d236f1650a4c55a0fb8bd7d390b3ff1fd01b0ac8f14e0fbc7a4ba7715',
  'darwin-x64': '7aa317ba83e14928fa30643d9ee2322335ddd7f4836d711fc77ee4a20cf536ee',
  'win32-x64': 'f1148188b538e5e3a66df594501d81e3f35c4f0fbb8e7c981ce183d26b25fd52',
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
