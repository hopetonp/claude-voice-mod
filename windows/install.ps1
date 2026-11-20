param([switch]$StagingOnly, [string]$NodePath)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'VoiceMesh Claude Voice.lnk'
$minimum = (Get-Content -LiteralPath (Join-Path $source 'app\scripts\node-minimum') -Raw).Trim()
if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
if (-not $NodePath -or -not [IO.Path]::IsPathRooted($NodePath) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "VoiceMesh requires Node.js $minimum or later. Install Node from https://nodejs.org (or winget install OpenJS.NodeJS) and run this installer again."
}
$nodePath = & $NodePath (Join-Path $source 'app\scripts\node-requirement.cjs') --resolve
if ($LASTEXITCODE -ne 0) { throw 'Node.js does not meet the VoiceMesh requirement. Install a supported Node version and run this installer again.' }
$nodePath = ($nodePath -join "`n").Trim()
if (-not [IO.Path]::IsPathRooted($nodePath) -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js did not return a valid absolute executable path.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\dist\index.html'))) { throw 'The built voice page is missing from this package.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'app\settings-window\src-tauri\target\release\voicemesh-settings-window.exe'))) { throw 'The settings window is missing from this package.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'plugin-marketplace\.claude-plugin\marketplace.json'))) { throw 'The bundled Claude marketplace is missing from this package.' }
if (-not $StagingOnly -and -not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'Claude CLI is required to install the bundled Mods.' }
if ($source.TrimEnd('\') -eq $destination.TrimEnd('\')) { throw 'Run the installer from the built package directory, not from the installation directory.' }

# Stop only a previous VoiceMesh host from this installation directory.
. (Join-Path $source 'host-process.ps1')
$profileRoot = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\user' } else { $env:USERPROFILE }
Stop-VoiceMeshProcesses -Destination $destination -MediaProfile (Join-Path $profileRoot '.claude\voicemesh-controls\media-profile')

New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Remove the old runtime and npm tree on upgrades; Copy-Item alone leaves them behind.
foreach ($stale in @('runtime', 'app\node_modules', 'app\vendor', 'app\host')) {
    $path = Join-Path $destination $stale
    Remove-VoiceMeshPath -Path $path -Recurse
}
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
[IO.File]::WriteAllText((Join-Path $destination 'app\node-path.txt'), $nodePath + "`n")

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
Write-Host "VoiceMesh uses system Node: $nodePath (requires $minimum or later)."
if (-not $StagingOnly) { Write-Host 'Restart Claude to load the Mods, then open Voice settings to configure a provider.' }
