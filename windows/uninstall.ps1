param([switch]$StagingOnly, [switch]$Purge)

$ErrorActionPreference = 'Stop'
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
$profileRoot = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\user' } else { $env:USERPROFILE }
$localRoot = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\local' } else { $env:LOCALAPPDATA }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'VoiceMesh Claude Voice.lnk'
if (-not $StagingOnly) {
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        foreach ($plugin in @('voicemesh-controls@voicemesh-local', 'voicemesh-said@voicemesh-local')) {
            try { & claude plugin uninstall $plugin --keep-data -y *> $null } catch { }
        }
        try { & claude plugin marketplace remove voicemesh-local *> $null } catch { }
    } else {
        Write-Warning 'Claude CLI was not found; remove the VoiceMesh Mods and voicemesh-local marketplace in Claude.'
    }
}
. (Join-Path $PSScriptRoot 'host-process.ps1')
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    Test-VoiceMeshHostCommand $_.CommandLine $destination
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
if (-not $StagingOnly) { Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue }
foreach ($cache in @((Join-Path $localRoot 'com.voicemesh.claude.settings'), (Join-Path $localRoot 'VoiceMesh\Marketplaces'))) {
    if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
}
if ($Purge) {
    $claudeData = Join-Path $profileRoot '.claude'
    foreach ($relative in @('voicemesh-controls', 'plugins\cache\voicemesh-local',
        'plugins\data\voicemesh-controls-inline', 'plugins\data\voicemesh-controls-voicemesh-local',
        'plugins\data\voicemesh-said-inline', 'plugins\data\voicemesh-said-voicemesh-local')) {
        $path = Join-Path $claudeData $relative
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    $store = Join-Path $claudeData 'plugins\store'
    if (Test-Path -LiteralPath $store) {
        Get-ChildItem -LiteralPath $store -File | Where-Object { $_.Name -match '^voicemesh-(controls|said)_.+\.json$' } | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }
}
Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
if ($Purge) { Write-Host 'VoiceMesh removed, including saved settings, credentials, transcripts and Mod data.' }
else { Write-Host 'VoiceMesh and caches removed. Saved settings, credentials and history remain; use -Purge to remove them.' }
