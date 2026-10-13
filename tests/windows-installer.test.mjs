import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('Windows installer installs and refreshes both Mods, checks failures, and preserves staging isolation', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-installer-'))
  const source = join(root, 'download with spaces')
  try {
    for (const artifact of ['runtime/node.exe', 'app/dist/index.html',
      'app/settings-window/src-tauri/target/release/voicemesh-settings-window.exe',
      'plugin-marketplace/.claude-plugin/marketplace.json']) {
      const destination = join(source, artifact)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await writeFile(destination, '{}')
    }
    for (const name of ['install.ps1', 'uninstall.ps1']) {
      await copyFile(resolve('windows', name), join(source, name))
    }
    const harness = join(root, 'check.ps1')
    await writeFile(harness, String.raw`
param($TestRoot)
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = Join-Path $TestRoot 'local'
$env:TEMP = Join-Path $TestRoot 'temp'
$global:calls = @()
$global:hasClaude = $true
$global:failInstall = $false
$global:launches = 0
$global:shortcutRemoved = $false
function Get-CimInstance { param($ClassName, $Filter) }
function Get-Command {
  param($Name, $ErrorAction)
  if ($Name -eq 'claude' -and $global:hasClaude) { return @{ Name = 'claude' } }
}
function claude {
  $global:calls += ,@($args)
  $global:LASTEXITCODE = if ($global:failInstall -and $args[1] -eq 'install') { 7 } else { 0 }
}
function New-Object {
  param($ComObject)
  $shell = [pscustomobject]@{}
  $shell | Add-Member ScriptMethod CreateShortcut {
    param($Path)
    $shortcut = [pscustomobject]@{TargetPath=''; Arguments=''; WorkingDirectory=''; Description=''}
    $shortcut | Add-Member ScriptMethod Save {}
    return $shortcut
  }
  return $shell
}
function Start-Process {
  param($FilePath, $ArgumentList, $WindowStyle)
  if ($WindowStyle -ne 'Hidden') { throw 'Host launch must be hidden' }
  $global:launches++
}
function Remove-Item {
  param($LiteralPath, [switch]$Recurse, [switch]$Force, $ErrorAction)
  if ($LiteralPath.EndsWith('VoiceMesh Claude Voice.lnk')) { $global:shortcutRemoved = $true; return }
  Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force -ErrorAction SilentlyContinue
}
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$installer = Join-Path $TestRoot 'download with spaces\install.ps1'
$uninstaller = Join-Path $TestRoot 'download with spaces\uninstall.ps1'
$destination = Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice'
$global:hasClaude = $false
$caught = $false
try { & $installer } catch { $caught = $_.Exception.Message -match 'Claude CLI is required' }
Assert $caught 'Missing Claude must fail before changing the installation'
Assert (-not (Test-Path $destination)) 'Missing Claude created an installation'
$global:hasClaude = $true
& $installer
Assert ($global:calls.Count -eq 6) 'Installation must refresh the marketplace and both Mods'
Assert ($global:calls[0][3] -eq '--keep-data') 'Upgrade must preserve Mod data'
Assert ($global:calls[3][3] -eq (Join-Path $destination 'plugin-marketplace')) 'Marketplace must use the installed path'
Assert ($global:calls[4][2] -eq 'voicemesh-controls@voicemesh-local') 'Controls were not installed'
Assert ($global:calls[5][2] -eq 'voicemesh-said@voicemesh-local') 'Caption Mod was not installed'
& $installer
Assert ($global:calls.Count -eq 12) 'Reinstallation must refresh both Mods'
$global:failInstall = $true
$caught = $false
try { & $installer } catch { $caught = $_.Exception.Message -match 'installation failed.*exit 7' }
Assert $caught 'Claude installation failure must be reported'
$global:failInstall = $false
$global:calls = @()
$global:launches = 0
& $installer -StagingOnly
Assert ($global:calls.Count -eq 0 -and $global:launches -eq 0) 'Staging must not touch Claude or launch a host'
& $uninstaller -StagingOnly
Assert ($global:calls.Count -eq 0) 'Staging uninstall must not touch Claude'
& $uninstaller
Assert ($global:calls.Count -eq 3) 'Uninstall must remove both Mods and marketplace'
Assert ($global:calls[0][3] -eq '--keep-data') 'Uninstall must preserve Mod data'
Assert $global:shortcutRemoved 'Uninstall must remove the startup shortcut'
Assert (-not (Test-Path $destination)) 'Uninstall left the package in place'
Write-Output 'Installer parity checks passed'
`)
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, root], { encoding: 'utf8' })
    assert.match(output, /Installer parity checks passed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
