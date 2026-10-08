$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'cloudflare\wrangler.jsonc'
$envPath = Join-Path $projectRoot '.env'
$wrangler = Join-Path $projectRoot 'node_modules\.bin\wrangler.cmd'

if (-not (Test-Path $envPath)) { throw 'The local .env file is missing.' }
if (-not (Test-Path $wrangler)) { throw 'Wrangler is not installed. Run npm install first.' }

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

$identity = Invoke-Wrangler @('whoami', '--config', $configPath)
if ($identity -match 'not authenticated|wrangler login') {
    throw 'Run npx wrangler login and sign in to Cloudflare first.'
}

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

$names = @('MAX_BOT_TOKEN', 'MAX_WEBHOOK_SECRET', 'MAX_BOT_OWNER_ID', 'SBP_PHONE', 'SBP_BANK', 'SBP_RECEIVER_NAME')
foreach ($name in $names) {
    $value = Get-DotEnvValue $name
    if (-not $value) {
        if ($name -in @('MAX_BOT_OWNER_ID', 'SBP_PHONE', 'SBP_BANK', 'SBP_RECEIVER_NAME')) {
            Write-Warning "$name is empty and will not be updated in Cloudflare."
            continue
        }
        throw "$name is required in .env."
    }
    Invoke-Wrangler @('secret', 'put', $name, '--config', $configPath) $value | Out-Null
}

if ($buyerToken) {
    if ($buyerWebhookSecret.Length -lt 32) { throw 'BUYER_WEBHOOK_SECRET must contain at least 32 characters.' }
    Invoke-Wrangler @('secret', 'put', 'BUYER_BOT_TOKEN', '--config', $configPath) $buyerToken | Out-Null
    Invoke-Wrangler @('secret', 'put', 'BUYER_WEBHOOK_SECRET', '--config', $configPath) $buyerWebhookSecret | Out-Null

    $environmentNames = @('BUYER_BOT_TOKEN', 'BUYER_WEBHOOK_SECRET', 'MAX_WEBHOOK_URL')
    $previousEnvironment = @{}
    Push-Location $projectRoot
    try {
        foreach ($name in $environmentNames) {
            $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, (Get-DotEnvValue $name), 'Process')
        }
        & node --use-system-ca scripts/register-max-webhook.js
        if ($LASTEXITCODE -ne 0) { throw 'Could not register the buyer bot webhook.' }
    } finally {
        Pop-Location
        foreach ($name in $environmentNames) {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
        }
    }
    Write-Output 'Worker secrets were updated and the buyer bot webhook was registered.'
} else {
    Write-Warning 'BUYER_BOT_TOKEN is empty. Fami remains the only configured bot; add the first bot token locally to restore the buyer bot.'
}
