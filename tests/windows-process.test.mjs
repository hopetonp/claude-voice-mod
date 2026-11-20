import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('Windows cleanup matches mixed-slash paths, stops owned descendants, and preserves other Node and Chrome processes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-process-test-'))
  try {
    const harness = join(root, 'check.ps1')
    await writeFile(harness, String.raw`
param($Helpers)
$ErrorActionPreference = 'Stop'
. $Helpers
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$destination = 'C:\Users\Tester\AppData\Local\VoiceMesh\ClaudeVoice'
$profile = 'C:\Users\Tester\.claude\voicemesh-controls\media-profile'
$hostArg = ($destination + '\app\scripts\launch-host.js').Replace('\', '/')
Assert (Test-VoiceMeshHostCommand ('node.exe "' + $hostArg.ToUpper() + '"') $destination) 'Mixed slashes and case must match'
Assert (-not (Test-VoiceMeshHostCommand ('node.exe "' + $hostArg + '.other"') $destination)) 'Host suffix must not match'
Assert (-not (Test-VoiceMeshHostCommand 'node.exe C:/other/app/scripts/launch-host.js' $destination)) 'Another installation must not match'
foreach ($arg in @(('--user-data-dir="' + $profile + '"'), ('"--user-data-dir=' + $profile + '"'), ('--user-data-dir=' + $profile.Replace('\', '/')))) {
    Assert (Test-VoiceMeshMediaCommand ('chrome.exe ' + $arg) $profile) 'VoiceMesh Chrome profile argument must match'
}
Assert (-not (Test-VoiceMeshMediaCommand ('chrome.exe --user-data-dir="' + $profile + '-other"') $profile)) 'Profile suffix must not match'
Assert (-not (Test-VoiceMeshMediaCommand 'chrome.exe --user-data-dir=C:\Users\Tester\Chrome' $profile)) 'Regular Chrome must not match'
$global:processes = @(
    [pscustomobject]@{ProcessId=101; ParentProcessId=1; Name='node.exe'; CommandLine=('node.exe "' + $hostArg + '"'); ExecutablePath='C:\node\node.exe'},
    [pscustomobject]@{ProcessId=102; ParentProcessId=1; Name='chrome.exe'; CommandLine=('chrome.exe --user-data-dir="' + $profile + '"'); ExecutablePath='C:\Chrome\chrome.exe'},
    [pscustomobject]@{ProcessId=103; ParentProcessId=102; Name='chrome.exe'; CommandLine='chrome.exe --type=renderer'; ExecutablePath='C:\Chrome\chrome.exe'},
    [pscustomobject]@{ProcessId=201; ParentProcessId=1; Name='node.exe'; CommandLine='node.exe C:\other\app.js'; ExecutablePath='C:\node\node.exe'},
    [pscustomobject]@{ProcessId=202; ParentProcessId=1; Name='chrome.exe'; CommandLine='chrome.exe --user-data-dir=C:\normal-profile'; ExecutablePath='C:\Chrome\chrome.exe'}
)
$global:stopped = @()
function Get-CimInstance { param($ClassName) return $global:processes }
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) $global:stopped += $Id }
function Get-Process { param($Id, $ErrorAction) return @() }
Stop-VoiceMeshProcesses -Destination $destination -MediaProfile $profile
Assert ((($global:stopped | Sort-Object) -join ',') -eq '101,102,103') 'Cleanup stopped unrelated processes or missed owned children'
Write-Output 'Scoped process cleanup passed'
`)
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, resolve('windows/host-process.ps1')], { encoding: 'utf8' })
    assert.match(output, /Scoped process cleanup passed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows PowerShell 5.1 cleanup deletes profile filenames beyond 260 characters', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-long-profile-'))
  try {
    const profile = join(root, 'media-profile')
    const nested = join(profile, 'a'.repeat(70), 'b'.repeat(70), 'c'.repeat(70))
    await mkdir(nested, { recursive: true })
    const file = join(nested, 'verified_contents.json')
    assert.ok(file.length > 260)
    await writeFile(file, '{}')
    const harness = join(root, 'check.ps1')
    await writeFile(harness, 'param($Helpers, $MediaProfilePath)\n$ErrorActionPreference = "Stop"\n. $Helpers\nRemove-VoiceMeshPath -Path $MediaProfilePath -Recurse\n')
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, resolve('windows/host-process.ps1'), profile], { encoding: 'utf8' })
    await assert.rejects(access(profile), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
