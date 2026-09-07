[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$storesPath = Join-Path $pluginRoot 'stores.json'

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
        if ([string]::IsNullOrWhiteSpace($plain)) {
            Write-Host "$VariableName skipped."
            return
        }
        [Environment]::SetEnvironmentVariable($VariableName, $plain.Trim(), 'User')
        Write-Host "$VariableName saved."
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
Write-Host 'Shopify Multi Store Connector (read-only)'
Write-Host 'Configure UK, EU, and US. Press Enter on a domain to preserve or skip that profile.'

foreach ($profile in @('UK', 'EU', 'US')) {
    Write-Host ''
    $domainVariable = "SHOPIFY_${profile}_SHOP_DOMAIN"
    $clientIdVariable = "SHOPIFY_${profile}_CLIENT_ID"
    $clientSecretVariable = "SHOPIFY_${profile}_CLIENT_SECRET"
    $existingDomain = [Environment]::GetEnvironmentVariable($domainVariable, 'User')
    $domain = (Read-Host "$profile myshopify domain (example: store.myshopify.com)").Trim()
    if ($domain) {
        $domain = $domain -replace '^https?://', '' -replace '/$', ''
        [Environment]::SetEnvironmentVariable($domainVariable, $domain, 'User')
        Write-Host "$domainVariable saved."
        $clientId = (Read-Host "$profile Shopify Client ID").Trim()
        if ($clientId) {
            [Environment]::SetEnvironmentVariable($clientIdVariable, $clientId, 'User')
            Write-Host "$clientIdVariable saved."
        }
        Set-SecretValue "$profile Shopify Client Secret" $clientSecretVariable
    }
    elseif ($existingDomain) {
        Write-Host "$domainVariable preserved."
    }
    else {
        Write-Host "$profile skipped."
    }
}

[Environment]::SetEnvironmentVariable('SHOPIFY_STORES_FILE', $storesPath, 'User')
Write-Host ''
Write-Host 'Credential setup complete.'
Write-Host 'Next run scripts\oauth-setup.ps1 after adding the callback URL in Shopify Dev Dashboard.'
