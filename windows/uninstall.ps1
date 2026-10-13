param([switch]$StagingOnly)

$ErrorActionPreference = 'Stop'
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
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
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $destination 'runtime\node.exe'), [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
if (-not $StagingOnly) { Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'VoiceMesh host removed. Saved voice settings and credentials remain in place.'
