param([switch]$StagingOnly)

$ErrorActionPreference = 'Stop'
$destination = if ($StagingOnly) { Join-Path $env:TEMP 'VoiceMeshPackageSmoke\ClaudeVoice' } else { Join-Path $env:LOCALAPPDATA 'VoiceMesh\ClaudeVoice' }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'VoiceMesh Claude Voice.lnk'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $destination 'runtime\node.exe'), [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
if (-not $StagingOnly) { Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'VoiceMesh host removed. Claude plugin settings and saved voice credentials were left in place.'
