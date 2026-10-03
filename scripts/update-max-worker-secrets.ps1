$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'cloudflare\wrangler.jsonc'
$envPath = Join-Path $projectRoot '.env'
$wrangler = Join-Path $projectRoot 'node_modules\.bin\wrangler.cmd'

if (-not (Test-Path $envPath)) { throw 'The local .env file is missing.' }
if (-not (Test-Path $wrangler)) { throw 'Wrangler is not installed. Run npm install first.' }

function Get-DotEnvValue([string]$Name) {
    $line = Get-Content -LiteralPath $envPath | Where-Object {
        $_ -match "^\s*(?:export\s+)?$([regex]::Escape($Name))="
    } | Select-Object -First 1
    if (-not $line) { return '' }
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

$identity = Invoke-Wrangler @('whoami', '--config', $configPath)
if ($identity -match 'not authenticated|wrangler login') {
    throw 'Run npx wrangler login and sign in to Cloudflare first.'
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

Write-Output 'Configured Worker secrets have been updated.'
