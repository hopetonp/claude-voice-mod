param([switch]$StagingOnly)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'VoiceMesh Claude Voice.lnk'
if (-not (Test-Path -LiteralPath (Join-Path $source 'runtime\node.exe'))) { throw 'The private Node runtime is missing from this release.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\dist\index.html'))) { throw 'The built voice page is missing from this release.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\settings-window\src-tauri\target\release\voicemesh-settings-window.exe'))) { throw 'The settings window is missing from this release.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'plugin-marketplace\.claude-plugin\marketplace.json'))) { throw 'The bundled Claude marketplace is missing from this release.' }
if (-not $StagingOnly -and -not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'Claude CLI is required to install the bundled Mods.' }
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
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $destination 'launch-host.vbs') + '"') -WindowStyle Hidden

    # Refresh the Mods from the durable installation path, preserving saved data.
    foreach ($plugin in @('voicemesh-controls@voicemesh-local', 'voicemesh-said@voicemesh-local')) {
        try { & claude plugin uninstall $plugin --keep-data -y *> $null } catch { }
    }
    try { & claude plugin marketplace remove voicemesh-local *> $null } catch { }
    & claude plugin marketplace add (Join-Path $destination 'plugin-marketplace')
    if ($LASTEXITCODE -ne 0) { throw "Claude marketplace registration failed (exit $LASTEXITCODE)." }
    foreach ($plugin in @('voicemesh-controls@voicemesh-local', 'voicemesh-said@voicemesh-local')) {
        & claude plugin install $plugin -y
        if ($LASTEXITCODE -ne 0) { throw "Claude Mod installation failed for $plugin (exit $LASTEXITCODE)." }
    }
}
$status = if ($StagingOnly) { 'staged for testing' } else { 'installed' }
Write-Host "VoiceMesh host $status at $destination"
Write-Host "Claude plugin marketplace: $(Join-Path $destination 'plugin-marketplace')"
Write-Host 'The bundled Node runtime is private to VoiceMesh; no system Node installation is needed.'
if (-not $StagingOnly) { Write-Host 'Restart Claude to load the Mods, then open Voice settings to configure a provider.' }
