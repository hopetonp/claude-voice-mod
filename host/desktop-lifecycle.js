import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Inspect the main app, not Claude Code or an Electron helper left after app exit.
export async function desktopRunning({ platform = process.platform, execute = run } = {}) {
  try {
    if (platform === 'darwin') {
      const { stdout } = await execute('/bin/ps', ['-ax', '-o', 'comm='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
      return stdout.split('\n').some(command => /\/Claude\.app\/Contents\/MacOS\/Claude$/.test(command.trim()))
    }
    if (platform === 'win32') {
      const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq Claude.exe', '/FO', 'CSV', '/NH'], { timeout: 2000, windowsHide: true })
      return stdout.split('\n').some(line => /^"Claude\.exe",/i.test(line.trim()))
    }
  } catch (error) {
    // A failed process query is not evidence that the app exited.
    console.error(`VoiceMesh desktop lifecycle check failed: ${error.message}`)
  }
  return null
}

export function watchDesktop({ onExit, probe = desktopRunning, intervalMs = 2000 } = {}) {
  let absent = 0
  let checking = false
  const timer = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      const running = await probe()
      absent = running === false ? absent + 1 : 0
      // Allow a brief process handover during a desktop update or restart.
      if (absent >= 2) {
        clearInterval(timer)
        console.info('Claude Desktop exited; stopping VoiceMesh host')
        await onExit()
      }
    } finally { checking = false }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
