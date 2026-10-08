$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'cloudflare\wrangler.jsonc'
$envPath = Join-Path $projectRoot '.env'
$wrangler = Join-Path $projectRoot 'node_modules\.bin\wrangler.cmd'

if (-not (Test-Path $wrangler)) { throw 'Wrangler is not installed. Run npm install first.' }
if (-not (Test-Path $envPath)) { throw 'The local .env file is missing. Configure MAX_BOT_TOKEN first.' }

function Get-DotEnvValue([string]$Name) {
    $line = Get-Content -LiteralPath $envPath | Where-Object {
        ($_ -replace '^\uFEFF', '') -match "^\s*(?:export\s+)?$([regex]::Escape($Name))="
    } | Select-Object -First 1
    if (-not $line) { return '' }
    $line = $line -replace '^\uFEFF', ''
    $value = $line.Substring($line.IndexOf('=') + 1).Trim()
    if ($value.StartsWith('"')) {
        try { return ($value | ConvertFrom-Json) } catch { throw "$Name in .env is not valid JSON-quoted text." }
    }
    if ($value.StartsWith("'") -and $value.EndsWith("'")) { return $value.Substring(1, $value.Length - 2) }
    return $value
}

function Invoke-Wrangler([string[]]$Arguments, [string]$InputValue = $null) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($null -eq $InputValue) {
            $output = @(& $wrangler @Arguments 2>&1)
        } else {
            $output = @($InputValue | & $wrangler @Arguments 2>&1)
        }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if ($exitCode -ne 0) { throw "Wrangler failed with exit code $exitCode. $text" }
    return $text
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
    $content = [System.IO.File]::ReadAllText($envPath).TrimStart([char]0xFEFF)
    $pattern = "(?m)^\s*(?:export\s+)?$([regex]::Escape($Name))=.*$"
    if ($content -match $pattern) {
        $content = [regex]::Replace($content, $pattern, "$Name=$Value")
    } else {
        $content = $content.TrimEnd() + [Environment]::NewLine + "$Name=$Value" + [Environment]::NewLine
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envPath, $content, $encoding)
}

function Set-WorkerSecret([string]$Name, [string]$Value) {
    if (-not $Value) { return }
    Invoke-Wrangler @('secret', 'put', $Name, '--config', $configPath) $Value | Out-Null
}

$token = Get-DotEnvValue 'MAX_BOT_TOKEN'
if (-not $token) { throw 'MAX_BOT_TOKEN is not configured in .env.' }
$webhookSecret = Get-DotEnvValue 'MAX_WEBHOOK_SECRET'
if (-not $webhookSecret) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $webhookSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-DotEnvValue 'MAX_WEBHOOK_SECRET' $webhookSecret
}
if ($webhookSecret.Length -lt 32) { throw 'MAX_WEBHOOK_SECRET must have at least 32 characters.' }
$buyerToken = Get-DotEnvValue 'BUYER_BOT_TOKEN'
$buyerWebhookSecret = Get-DotEnvValue 'BUYER_WEBHOOK_SECRET'
if ($buyerToken -and -not $buyerWebhookSecret) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $buyerWebhookSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-DotEnvValue 'BUYER_WEBHOOK_SECRET' $buyerWebhookSecret
}

$identity = Invoke-Wrangler @('whoami', '--config', $configPath)
if ($identity -match 'not authenticated|wrangler login') {
    throw 'Cloudflare access is required. Run npx wrangler login and sign in to your Cloudflare account, then retry.'
}

$config = Get-Content -LiteralPath $configPath -Raw
$placeholderId = '00000000-0000-0000-0000-000000000000'
if ($config.Contains($placeholderId)) {
    $databaseList = Invoke-Wrangler @('d1', 'list', '--json', '--config', $configPath)
    $jsonStartMatch = [regex]::Match($databaseList, '(?m)^\s*\[')
    $jsonStart = $jsonStartMatch.Index
    if (-not $jsonStartMatch.Success) { throw 'Wrangler did not return a valid D1 database list.' }
    $databases = @(ConvertFrom-Json $databaseList.Substring($jsonStart) | Where-Object { $_.name -eq 'family-soft-max-bot' })
    if ($databases.Count -eq 0) {
        Invoke-Wrangler @('d1', 'create', 'family-soft-max-bot') | Out-Null
        $databaseList = Invoke-Wrangler @('d1', 'list', '--json', '--config', $configPath)
        $jsonStartMatch = [regex]::Match($databaseList, '(?m)^\s*\[')
        $jsonStart = $jsonStartMatch.Index
        if (-not $jsonStartMatch.Success) { throw 'Wrangler did not return a valid D1 database list after creation.' }
        $databases = @(ConvertFrom-Json $databaseList.Substring($jsonStart) | Where-Object { $_.name -eq 'family-soft-max-bot' })
    }
    if ($databases.Count -ne 1) { throw 'Could not uniquely identify the Cloudflare D1 database.' }
    $databaseId = $databases[0].uuid
    if (-not $databaseId) { throw 'D1 was created, but Wrangler did not return a database ID. Update cloudflare/wrangler.jsonc with the ID from the dashboard.' }
    $config = $config.Replace($placeholderId, $databaseId)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $config, $encoding)
}

Invoke-Wrangler @('d1', 'migrations', 'apply', 'family-soft-max-bot', '--remote', '--config', $configPath) | Out-Null

Set-WorkerSecret 'MAX_BOT_TOKEN' $token
Set-WorkerSecret 'MAX_WEBHOOK_SECRET' $webhookSecret
if ($buyerToken) {
    if ($buyerWebhookSecret.Length -lt 32) { throw 'BUYER_WEBHOOK_SECRET must have at least 32 characters.' }
    Set-WorkerSecret 'BUYER_BOT_TOKEN' $buyerToken
    Set-WorkerSecret 'BUYER_WEBHOOK_SECRET' $buyerWebhookSecret
}
foreach ($name in @('MAX_BOT_OWNER_ID', 'SBP_PHONE', 'SBP_BANK', 'SBP_RECEIVER_NAME')) {
    Set-WorkerSecret $name (Get-DotEnvValue $name)
}

$deployOutput = Invoke-Wrangler @('deploy', '--config', $configPath)
$workerUrl = [regex]::Match($deployOutput, 'https://[A-Za-z0-9.-]+\.workers\.dev').Value
if (-not $workerUrl) {
    Write-Output $deployOutput
    throw 'Worker deployed, but Wrangler did not report its workers.dev address. Copy that URL into MAX_WEBHOOK_URL in .env, then register the webhook.'
}

$webhookUrl = "$($workerUrl.TrimEnd('/'))/webhook"
Set-DotEnvValue 'MAX_WEBHOOK_URL' $webhookUrl
if (-not (Get-DotEnvValue 'MAX_BOT_OWNER_ID')) {
    Write-Warning 'The bot will run, but checkout and sewing requests remain disabled until MAX_BOT_OWNER_ID is set.'
}
if (-not (Get-DotEnvValue 'SBP_PHONE') -or -not (Get-DotEnvValue 'SBP_BANK') -or -not (Get-DotEnvValue 'SBP_RECEIVER_NAME')) {
    Write-Warning 'Checkout remains disabled until SBP_PHONE, SBP_BANK, and SBP_RECEIVER_NAME are configured.'
}

& (Join-Path $PSScriptRoot 'stop-max-bot.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not stop local Long Polling; do not register a webhook while another bot poller is active.' }

Push-Location $projectRoot
$environmentNames = @('MAX_BOT_TOKEN', 'MAX_WEBHOOK_URL', 'MAX_WEBHOOK_SECRET')
if ($buyerToken) { $environmentNames += @('BUYER_BOT_TOKEN', 'BUYER_WEBHOOK_SECRET') }
$previousEnvironment = @{}
try {
    foreach ($name in $environmentNames) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, (Get-DotEnvValue $name), 'Process')
    }
    & node --use-system-ca scripts/register-max-webhook.js
    if ($LASTEXITCODE -ne 0) {
        & (Join-Path $PSScriptRoot 'start-max-bot.ps1')
        throw 'MAX webhook registration failed. The local bot was restarted.'
    }
} finally {
    Pop-Location
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}

Write-Output "MAX chat bot is deployed at $workerUrl and registered through HTTPS webhook."
