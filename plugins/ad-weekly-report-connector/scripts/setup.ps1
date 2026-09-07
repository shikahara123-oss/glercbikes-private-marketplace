[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$accountsPath = Join-Path $pluginRoot 'accounts.json'

function ConvertTo-ProfileName([string]$Value) {
    $normalized = $Value.Trim().ToUpperInvariant() -replace '[^A-Z0-9_]', '_'
    if (-not $normalized) { throw 'Credential profile cannot be empty.' }
    return $normalized
}

function Set-SecretValue([string]$Prompt, [string]$VariableName) {
    $existing = [Environment]::GetEnvironmentVariable($VariableName, 'User')
    if ($existing) {
        $replace = Read-Host "$Prompt already exists. Replace it? (y/N)"
        if ($replace -notmatch '^(y|yes)$') {
            Write-Host "$VariableName preserved."
            return
        }
    }

    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plain) {
            [Environment]::SetEnvironmentVariable($VariableName, $plain, 'User')
            Write-Host "$VariableName saved."
        }
        else {
            Write-Host "$VariableName skipped."
        }
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
        $plain = $null
        $secure = $null
    }
}

Write-Host ''
Write-Host 'Advertising Weekly Report Connector'
Write-Host 'Multi-country credential setup (read-only)'
Write-Host 'Secrets are stored in Windows user environment variables.'
Write-Host 'Secrets are not written to accounts.json or PowerShell history.'
Write-Host ''

$accounts = [ordered]@{}
if (Test-Path -LiteralPath $accountsPath) {
    $current = Get-Content -Raw -LiteralPath $accountsPath | ConvertFrom-Json
    if ($current.accounts) {
        foreach ($property in $current.accounts.PSObject.Properties) {
            $accounts[$property.Name] = $property.Value
        }
    }
}

$profilesToConfigure = [ordered]@{}
do {
    Write-Host ''
    $name = (Read-Host 'Business name, for example Glercbikes-UK (press Enter to finish)').Trim()
    if (-not $name) { break }

    $suggestedProfile = (($name -split '-')[-1]).ToUpperInvariant()
    $profileInput = (Read-Host "Credential profile (press Enter to use $suggestedProfile)").Trim()
    if ($profileInput) {
        $profile = ConvertTo-ProfileName $profileInput
    }
    else {
        $profile = ConvertTo-ProfileName $suggestedProfile
    }

    $metaId = (Read-Host 'Meta Ad Account ID, with or without act_ (optional)').Trim()
    $googleId = (Read-Host 'Google Ads Customer ID (optional)').Replace('-', '').Trim()
    $loginId = (Read-Host 'Google MCC Customer ID (optional)').Replace('-', '').Trim()

    $entry = [ordered]@{ credentialProfile = $profile }
    if ($metaId) { $entry.metaAccountId = $metaId }
    if ($googleId) { $entry.googleCustomerId = $googleId }
    if ($loginId) { $entry.googleLoginCustomerId = $loginId }
    $accounts[$name] = $entry
    $profilesToConfigure[$profile] = $true
} while ($true)

$accountsJson = @{ accounts = $accounts } | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($accountsPath, $accountsJson, $utf8NoBom)
[Environment]::SetEnvironmentVariable('AD_ACCOUNTS_FILE', $accountsPath, 'User')

foreach ($profile in $profilesToConfigure.Keys) {
    Write-Host ''
    Write-Host "Configuring credential profile $profile. Preserve values that are already correct."
    $prefix = "AD_${profile}_"
    Set-SecretValue "$profile Meta System User Access Token (optional)" "${prefix}META_ACCESS_TOKEN"
    Set-SecretValue "$profile Google Ads Developer Token" "${prefix}GOOGLE_ADS_DEVELOPER_TOKEN"
    Set-SecretValue "$profile Google OAuth Client ID" "${prefix}GOOGLE_OAUTH_CLIENT_ID"
    Set-SecretValue "$profile Google OAuth Client Secret" "${prefix}GOOGLE_OAUTH_CLIENT_SECRET"
    Set-SecretValue "$profile Google OAuth Refresh Token" "${prefix}GOOGLE_ADS_REFRESH_TOKEN"
}

Write-Host ''
Write-Host "Setup complete. Account mapping: $accountsPath"
Write-Host 'Completely exit and restart Codex, then check connection status in a new task.'
