# Match the complete installed script argument, never the shared Node executable.
function Test-VoiceMeshHostCommand($CommandLine, $Destination) {
    if (-not $CommandLine) { return $false }
    $CommandLine = $CommandLine.Replace('/', '\')
    $script = (Join-Path $Destination 'app\scripts\launch-host.js').Replace('/', '\')
    $escaped = [regex]::Escape($script)
    return [regex]::IsMatch($CommandLine, '(?i)(?<!\S)(?:"' + $escaped + '"|' + $escaped + ')(?!\S)')
}

function Test-VoiceMeshMediaCommand($CommandLine, $MediaProfile) {
    if (-not $CommandLine -or -not $MediaProfile) { return $false }
    $escaped = [regex]::Escape($MediaProfile.Replace('/', '\').TrimEnd('\'))
    $normalized = $CommandLine.Replace('/', '\')
    return [regex]::IsMatch($normalized, '(?i)(?<!\S)(?:"--user-data-dir=' + $escaped + '"|--user-data-dir="' + $escaped + '"|--user-data-dir=' + $escaped + '|--user-data-dir\s+"' + $escaped + '"|--user-data-dir\s+' + $escaped + ')(?!\S)')
}

function Stop-VoiceMeshProcesses($Destination, $MediaProfile) {
    $processes = @(Get-CimInstance Win32_Process)
    $owned = [System.Collections.Generic.HashSet[int]]::new()
    $settings = (Join-Path $Destination 'app\settings-window\src-tauri\target\release\voicemesh-settings-window.exe').Replace('/', '\')
    foreach ($process in $processes) {
        $hostMatch = $process.Name -eq 'node.exe' -and (Test-VoiceMeshHostCommand $process.CommandLine $Destination)
        $mediaMatch = $process.Name -eq 'chrome.exe' -and (Test-VoiceMeshMediaCommand $process.CommandLine $MediaProfile)
        $settingsMatch = $process.ExecutablePath -and $process.ExecutablePath.Replace('/', '\').Equals($settings, [StringComparison]::OrdinalIgnoreCase)
        if ($hostMatch -or $mediaMatch -or $settingsMatch) { [void]$owned.Add([int]$process.ProcessId) }
    }
    # Chrome/WebView subprocesses may omit the profile flag; include descendants of verified roots.
    do {
        $changed = $false
        foreach ($process in $processes) {
            if ($owned.Contains([int]$process.ParentProcessId) -and $owned.Add([int]$process.ProcessId)) { $changed = $true }
        }
    } while ($changed)
    if ($owned.Count -eq 0) { return }
    $ids = @($processes | Where-Object { $owned.Contains([int]$_.ProcessId) } | ForEach-Object { [int]$_.ProcessId })
    foreach ($processId in $ids) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    $remaining = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
    if ($remaining.Count -gt 0) { Wait-Process -Id @($remaining.Id) -Timeout 5 -ErrorAction Stop }
}

function Remove-VoiceMeshPath($Path, [switch]$Recurse) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $extended = if ($absolute.StartsWith('\\?\')) { $absolute }
        elseif ($absolute.StartsWith('\\')) { '\\?\UNC\' + $absolute.Substring(2) }
        else { '\\?\' + $absolute }
    if (-not [IO.Directory]::Exists($extended) -and -not [IO.File]::Exists($extended)) { return }
    try { Remove-Item -LiteralPath $Path -Recurse:$Recurse -Force -ErrorAction Stop }
    catch {
        # PowerShell 5.1 can fail on Chrome's long nested filenames even after all processes exit.
        # Retry once with the extended path API; keep reporting genuine lock/permission errors.
        Start-Sleep -Milliseconds 250
        try {
            if ([IO.Directory]::Exists($extended)) { [IO.Directory]::Delete($extended, [bool]$Recurse) }
            elseif ([IO.File]::Exists($extended)) {
                [IO.File]::SetAttributes($extended, [IO.FileAttributes]::Normal)
                [IO.File]::Delete($extended)
            }
        } catch {
            if ([IO.Directory]::Exists($extended) -or [IO.File]::Exists($extended)) { throw }
        }
    }
}
