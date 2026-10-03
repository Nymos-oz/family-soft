$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:LOCALAPPDATA 'FamilySoft'
$pidFile = Join-Path $stateDir 'max-bot.pid'
$botScript = Join-Path $PSScriptRoot 'max-bot.js'

if (-not (Test-Path $pidFile)) {
    Write-Output 'MAX bot is not running via the background launcher.'
    exit 0
}

$processId = 0
if (-not [int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$processId)) {
    throw 'MAX bot PID file is invalid. Check active processes before removing it.'
}
$process = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -eq $processId -and $_.Name -in @('node.exe', 'node') -and
    $_.CommandLine.Contains($botScript)
}

if ($process) {
    Stop-Process -Id $processId
    Write-Output 'MAX bot stopped.'
} else {
    Write-Output 'The saved MAX bot process is no longer running.'
}
Remove-Item -LiteralPath $pidFile
