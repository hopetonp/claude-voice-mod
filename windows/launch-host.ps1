$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'app'
$logs = Join-Path $env:USERPROFILE '.claude\voicemesh-controls'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
try {
    $minimum = (Get-Content -LiteralPath (Join-Path $app 'scripts\node-minimum') -Raw).Trim()
    $saved = Join-Path $app 'node-path.txt'
    $node = if (Test-Path -LiteralPath $saved) { (Get-Content -LiteralPath $saved -Raw).Trim() } else { '' }
    if (-not $node -or -not [IO.Path]::IsPathRooted($node) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
        $node = ''
        foreach ($candidate in @(Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue)) {
            try {
                $resolved = & $candidate.Source (Join-Path $app 'scripts\node-requirement.cjs') --resolve 2>$null
                if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path -LiteralPath ($resolved -join "`n").Trim() -PathType Leaf)) {
                    $node = ($resolved -join "`n").Trim()
                    break
                }
            } catch { }
        }
        if (-not $node) { throw "VoiceMesh cannot find a supported Node executable. Install Node.js $minimum or later from https://nodejs.org and run the VoiceMesh installer again." }
        [IO.File]::WriteAllText($saved, $node + "`n")
        Add-Content -LiteralPath (Join-Path $logs 'host-launcher.log') -Value ("$(Get-Date -Format o) Saved Node was unavailable; recovered with $node")
    }
    $check = & $node (Join-Path $app 'scripts\node-requirement.cjs') 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($check -join "`n") }
    $env:PATH = (Split-Path $node) + ';' + $env:PATH
    if (-not $env:VOICE_MEDIA_BROWSER) {
        $env:VOICE_MEDIA_BROWSER = 'chrome.exe'
        foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
            if (-not $base) { continue }
            $candidate = Join-Path $base 'Google\Chrome\Application\chrome.exe'
            if (Test-Path -LiteralPath $candidate) { $env:VOICE_MEDIA_BROWSER = $candidate; break }
        }
    }
    $process = Start-Process -FilePath $node -ArgumentList @('--max-semi-space-size=2', ('"' + (Join-Path $app 'scripts\launch-host.js') + '"')) -WorkingDirectory $app -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $logs 'host.stdout.log') -RedirectStandardError (Join-Path $logs 'host.stderr.log')
    exit $process.ExitCode
} catch {
    Add-Content -LiteralPath (Join-Path $logs 'host.stderr.log') -Value ("$(Get-Date -Format o) " + $_.Exception.Message)
    exit 1
}
