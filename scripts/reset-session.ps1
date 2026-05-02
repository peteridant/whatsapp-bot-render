$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$authPath = Join-Path $projectRoot '.baileys_auth'

if (Test-Path $authPath) {
    Move-Item -LiteralPath $authPath -Destination "$authPath.backup-$timestamp"
}

Write-Host 'Bot session reset complete.'
