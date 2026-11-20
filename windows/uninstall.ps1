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
Stop-VoiceMeshProcesses -Destination $destination -MediaProfile (Join-Path $profileRoot '.claude\voicemesh-controls\media-profile')
if (-not $StagingOnly) { Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue }
foreach ($cache in @((Join-Path $localRoot 'com.voicemesh.claude.settings'), (Join-Path $localRoot 'VoiceMesh\Marketplaces'))) {
    Remove-VoiceMeshPath -Path $cache -Recurse
}
if ($Purge) {
    $claudeData = Join-Path $profileRoot '.claude'
    foreach ($relative in @('voicemesh-controls', 'plugins\cache\voicemesh-local',
        'plugins\data\voicemesh-controls-inline', 'plugins\data\voicemesh-controls-voicemesh-local',
        'plugins\data\voicemesh-said-inline', 'plugins\data\voicemesh-said-voicemesh-local')) {
        $path = Join-Path $claudeData $relative
        Remove-VoiceMeshPath -Path $path -Recurse
    }
    $store = Join-Path $claudeData 'plugins\store'
    if (Test-Path -LiteralPath $store) {
        Get-ChildItem -LiteralPath $store -File | Where-Object { $_.Name -match '^voicemesh-(controls|said)_.+\.json$' } | ForEach-Object {
            Remove-VoiceMeshPath -Path $_.FullName
        }
    }
}
Remove-VoiceMeshPath -Path $destination -Recurse
if ($Purge) { Write-Host 'VoiceMesh removed, including saved settings, credentials, transcripts and Mod data.' }
else { Write-Host 'VoiceMesh and caches removed. Saved settings, credentials and history remain; use -Purge to remove them.' }
