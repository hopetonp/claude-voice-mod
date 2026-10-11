import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const settingsRoot = join(root, 'settings-window')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tauri = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(npm, ['run', 'setup:build'], root)
run(tauri, ['build', ...(process.platform === 'darwin' ? ['--bundles', 'app'] : ['--no-bundle'])], settingsRoot)
