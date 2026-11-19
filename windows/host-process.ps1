# Match the complete installed script argument, never the shared Node executable.
function Test-VoiceMeshHostCommand($CommandLine, $Destination) {
    if (-not $CommandLine) { return $false }
    $script = Join-Path $Destination 'app\scripts\launch-host.js'
    $escaped = [regex]::Escape($script)
    return [regex]::IsMatch($CommandLine, '(?i)(?:"' + $escaped + '"|(?<!\S)' + $escaped + '(?!\S))(?=\s|$)')
}
