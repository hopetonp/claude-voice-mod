import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const home = process.env.USERPROFILE || process.env.HOME || homedir()
const dataDir = join(home, '.claude', 'voicemesh-controls')
const lockFile = join(dataDir, 'host-bootstrap.lock')
const connectionFile = join(dataDir, 'connection.json')

async function hostAlive() {
  try {
    const { url, token } = JSON.parse(await readFile(connectionFile, 'utf8'))
    if (!url || !token) return false
    const response = await fetch(`${url}/api/state`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(700),
    })
    return response.ok
  } catch { return false }
}

async function claimStart() {
  await mkdir(dataDir, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockFile, 'wx')
      await lock.close()
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(lockFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs
      if (age < 15000) return false
      await rm(lockFile, { force: true })
    }
  }
  return false
}

function browserPath() {
  if (process.env.VOICE_MEDIA_BROWSER) return process.env.VOICE_MEDIA_BROWSER
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  const paths = [
    ...bases.filter(Boolean).map(base => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...bases.filter(Boolean).map(base => join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
  ]
  return paths.find(existsSync) ?? 'chrome.exe'
}

export async function startBundledHost() {
  if (process.platform !== 'win32') return false
  if (await hostAlive()) return true
  if (!await claimStart()) return false
  const output = openSync(join(dataDir, 'host.log'), 'a')
  try {
    const child = spawn(process.execPath, [resolve(appRoot, 'scripts', 'launch-host.js')], {
      cwd: appRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      env: {
        ...process.env,
        HOME: home,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        VOICE_MEDIA_BROWSER: browserPath(),
      },
    })
    await new Promise((resolveStart, rejectStart) => {
      child.once('spawn', resolveStart)
      child.once('error', rejectStart)
    })
    child.unref()
    return true
  } catch (error) {
    await rm(lockFile, { force: true })
    await writeFile(join(dataDir, 'host-bootstrap-error.log'), `${new Date().toISOString()} ${error.message}\n`, { flag: 'a' })
    throw error
  } finally {
    closeSync(output)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startBundledHost().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
