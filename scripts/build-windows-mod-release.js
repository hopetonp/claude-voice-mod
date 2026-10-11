import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWindowsRelease, parseReleaseArgs } from './build-windows-release.js'

const root = fileURLToPath(new URL('..', import.meta.url))

export async function buildWindowsModRelease(options) {
  const output = options.output ?? join(root, 'release', 'voicemesh-claude-mod-win-x64')
  await buildWindowsRelease({ ...options, output })
  const controls = join(output, 'plugin-marketplace', 'plugins', 'voicemesh-controls')
  await rename(join(output, 'runtime'), join(controls, 'runtime'))
  await rename(join(output, 'app'), join(controls, 'app'))
  await addWindowsAutostart(controls)
  for (const installer of ['install.ps1', 'uninstall.ps1', 'launch-host.vbs']) {
    await rm(join(output, installer))
  }
  console.log(`Marketplace Mod release staged: ${output}`)
  return output
}

export async function addWindowsAutostart(controls) {
  await cp(join(root, 'scripts', 'bootstrap-host.js'), join(controls, 'app', 'scripts', 'bootstrap-host.js'))
  const hooksPath = join(controls, 'hooks', 'hooks.json')
  const hooks = JSON.parse(await readFile(hooksPath, 'utf8'))
  hooks.hooks = {
    ...hooks.hooks,
    SessionStart: [{
      hooks: [{
        type: 'command',
        command: '${CLAUDE_PLUGIN_ROOT}/runtime/node.exe',
        args: ['${CLAUDE_PLUGIN_ROOT}/app/scripts/bootstrap-host.js'],
        timeout: 10,
      }],
    }],
  }
  await writeFile(hooksPath, JSON.stringify(hooks, null, 2) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildWindowsModRelease(parseReleaseArgs(process.argv.slice(2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
