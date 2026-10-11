param([switch]$StagingOnly)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'VoiceMesh Claude Voice.lnk'
if (-not (Test-Path -LiteralPath (Join-Path $source 'runtime\node.exe'))) { throw 'The private Node runtime is missing from this release.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\dist\index.html'))) { throw 'The built voice page is missing from this release.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\settings-window\src-tauri\target\release\voicemesh-settings-window.exe'))) { throw 'The settings window is missing from this release.' }
if ($source.TrimEnd('\') -eq $destination.TrimEnd('\')) { throw 'Run the installer from the extracted release, not from the installation directory.' }

# Stop only a previous VoiceMesh host from this installation directory.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $destination 'runtime\node.exe'), [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force

if (-not $StagingOnly) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startup)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + (Join-Path $destination 'launch-host.vbs') + '"'
    $shortcut.WorkingDirectory = $destination
    $shortcut.Description = 'Start VoiceMesh for Claude at sign-in'
    $shortcut.Save()
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $destination 'launch-host.vbs') + '"')
}
$status = if ($StagingOnly) { 'staged for testing' } else { 'installed' }
Write-Host "VoiceMesh host $status at $destination"
Write-Host "Claude plugin marketplace: $(Join-Path $destination 'plugin-marketplace')"
Write-Host 'The bundled Node runtime is private to VoiceMesh; no system Node installation is needed.'
