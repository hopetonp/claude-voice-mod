/** Own Composer's browser audio runtime without a visible media tab. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnBackground } from '@voicemesh/composer/desktop/server'

export async function startBackgroundMedia(url) {
  const browser = process.env.VOICE_MEDIA_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const appEnd = browser.indexOf('.app/')
  const browserApp = process.platform === 'darwin' && appEnd !== -1 ? browser.slice(0, appEnd + 4) : null
  const profile = process.env.VOICE_MEDIA_PROFILE ?? join(homedir(), '.claude', 'voicemesh-controls', 'media-profile')
  await mkdir(profile, { recursive: true, mode: 0o700 })
  let child
  let closing = false
  let restartTimer
  let launchedAt = 0
  const launch = () => {
    launchedAt = Date.now()
    const args = [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      // The page is never visible, so Chrome would otherwise treat it as a background page: slow its
      // timers, deprioritize its renderer, and (on Windows) consider it occluded.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', `--user-data-dir=${profile}`,
      // Local-only DevTools endpoint, for inspecting the page while diagnosing it.
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      ...(process.env.VOICE_FAKE_MEDIA === '1' || process.env.VOICE_MEDIA_AUDIO_FILE ? ['--use-fake-device-for-media-stream'] : []),
      ...(process.env.VOICE_MEDIA_AUDIO_FILE ? [`--use-file-for-fake-audio-capture=${process.env.VOICE_MEDIA_AUDIO_FILE}`] : []),
      url,
    ]
    // LaunchServices makes Chrome the responsible app for macOS microphone permission.
    // Spawning Chrome from the Node login service attributes capture to Node instead.
    child = browserApp
      ? spawn('/usr/bin/open', ['-n', '-W', '-a', browserApp, '--args', ...args], { stdio: 'ignore' })
      : spawnBackground(browser, args, { stdio: 'ignore' })
    child.once('error', error => {
      console.error(`VoiceMesh media worker could not start: ${error.message}`)
    })
    child.once('exit', () => {
      if (!closing) {
        console.error('VoiceMesh media worker stopped; restarting')
        restartTimer = setTimeout(launch, 2000)
      }
    })
  }
  // Ends this profile's Chrome.
  const killWorker = () => {
    if (browserApp) {
      try {
        const processes = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
        for (const line of processes.split('\n')) {
          const match = line.match(/^\s*(\d+)\s+(.*)$/)
          if (match?.[2].startsWith(`${browser} `) && match[2].includes(`--user-data-dir=${profile}`)) {
            process.kill(Number(match[1]), 'SIGTERM')
          }
        }
      } catch (error) { console.error(`VoiceMesh media worker stop failed: ${error.message}`) }
    }
    child?.kill('SIGTERM')
  }
  launch()
  return {
    launchedAt: () => launchedAt,
    stop() {
      closing = true
      clearTimeout(restartTimer)
      killWorker()
    },
  }
}
