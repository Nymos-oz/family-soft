$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$botScript = Join-Path $projectRoot 'scripts\max-bot.js'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$stateDir = Join-Path $env:LOCALAPPDATA 'FamilySoft'
$logsDir = Join-Path $stateDir 'logs'
$pidFile = Join-Path $stateDir 'max-bot.pid'

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$existing = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('node.exe', 'node') -and
    $_.ExecutablePath -eq $nodePath -and
    $_.CommandLine.Contains($botScript)
} | Select-Object -First 1

if ($existing) {
    Set-Content -Path $pidFile -Value $existing.ProcessId
    Write-Output "MAX bot is already running (PID $($existing.ProcessId))."
    exit 0
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logsDir "max-bot-$timestamp.out.log"
$stderr = Join-Path $logsDir "max-bot-$timestamp.err.log"
$process = Start-Process -FilePath $nodePath `
    -ArgumentList @('--use-system-ca', '--env-file-if-exists=.env', "`"$botScript`"") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Start-Sleep -Seconds 3
$running = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -eq $process.Id -and $_.CommandLine.Contains($botScript)
}
if (-not $running) {
    Write-Output 'MAX bot did not stay running. Startup output:'
    if (Test-Path $stderr) { Get-Content $stderr }
    if (Test-Path $stdout) { Get-Content $stdout }
    exit 1
}

Set-Content -Path $pidFile -Value $process.Id
Write-Output "MAX bot started in the background (PID $($process.Id))."
Write-Output "Startup log: $stdout"
if (Test-Path $stdout) { Get-Content $stdout }
if ((Test-Path $stderr) -and (Get-Item $stderr).Length -gt 0) { Get-Content $stderr }
