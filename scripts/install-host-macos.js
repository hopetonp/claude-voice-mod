import { execFileSync } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('This installer supports macOS only')

const root = fileURLToPath(new URL('..', import.meta.url))
const label = 'com.voicemesh.claude-host'
const domain = `gui/${process.getuid()}`
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const logDir = join(homedir(), '.claude', 'voicemesh-controls')
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const element = (tag, value) => `<${tag}>${escapeXml(value)}</${tag}>`

if (process.argv[2] === '--remove') {
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }) } catch {}
  const { rm } = await import('node:fs/promises')
  await rm(plist, { force: true })
  console.log('VoiceMesh host login service removed')
  process.exit(0)
}

let developmentConnections
if (process.argv[2] === '--dev-connections') {
  developmentConnections = process.argv[3]
  if (!developmentConnections || !isAbsolute(developmentConnections)) throw new Error('Pass an absolute development connection file path')
} else if (process.argv.length > 2) throw new Error('Usage: install-host-macos.js [--dev-connections /absolute/path | --remove]')

const args = [process.execPath, join(root, 'scripts', 'launch-host.js'), ...(developmentConnections ? [developmentConnections] : [])]
// launchd does not inherit an interactive shell's PATH. Local model installation needs
// a current Python and npm, both commonly installed by Homebrew on macOS.
const servicePath = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${element('key', 'Label')}${element('string', label)}
${element('key', 'ProgramArguments')}<array>${args.map(value => element('string', value)).join('')}</array>
${element('key', 'WorkingDirectory')}${element('string', root)}
${element('key', 'EnvironmentVariables')}<dict>${element('key', 'PATH')}${element('string', servicePath)}</dict>
${element('key', 'RunAtLoad')}<true/>
${element('key', 'KeepAlive')}<true/>
${element('key', 'StandardOutPath')}${element('string', join(logDir, 'host.stdout.log'))}
${element('key', 'StandardErrorPath')}${element('string', join(logDir, 'host.stderr.log'))}
</dict></plist>
`

await mkdir(dirname(plist), { recursive: true })
await mkdir(logDir, { recursive: true, mode: 0o700 })
await Promise.all(['host.stdout.log', 'host.stderr.log'].map(name => writeFile(join(logDir, name), '', { mode: 0o600, flag: 'a' })))
const temporary = `${plist}.${process.pid}.tmp`
await writeFile(temporary, xml, { mode: 0o600, flag: 'wx' })
execFileSync('plutil', ['-lint', temporary], { stdio: 'ignore' })
try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }) } catch {}
await rename(temporary, plist)
// launchd may still be tearing down the old service just after bootout returns.
let bootstrapError
for (let attempt = 0; attempt < 10; attempt++) {
  try { execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'ignore' }); bootstrapError = null; break }
  catch (error) {
    bootstrapError = error
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 100))
  }
}
if (bootstrapError) throw bootstrapError
console.log(`VoiceMesh host login service installed: ${plist}`)
