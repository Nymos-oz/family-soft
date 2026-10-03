$ErrorActionPreference = 'Stop'
$secureToken = Read-Host -Prompt 'Paste the NEW MAX bot token (input hidden)' -AsSecureString
$tokenPointer = [IntPtr]::Zero
$exitCode = 1

try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:MAX_BOT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    & node --use-system-ca scripts/setup-max-bot.js
    $exitCode = $LASTEXITCODE
}
finally {
    Remove-Item Env:MAX_BOT_TOKEN -ErrorAction SilentlyContinue
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $secureToken.Dispose()
}

exit $exitCode
