[CmdletBinding()]
param(
    [ValidateSet('UK', 'EU', 'US')]
    [string[]]$Profiles = @('UK', 'EU', 'US')
)

$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'oauth-flow.mjs'
$nodeCandidates = @(
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'C:\Users\1\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Node.js was not found.' }

foreach ($profile in $Profiles) {
    foreach ($suffix in @('SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET')) {
        $name = "SHOPIFY_${profile}_${suffix}"
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Process') }
        if (-not $value) { throw "$name is missing. Run setup.ps1 first." }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }

    Write-Host ''
    Write-Host "Starting Shopify OAuth with inventory write access for $profile."
    $resultText = & $node --use-system-ca $helper $profile
    if ($LASTEXITCODE -ne 0) { throw "$profile OAuth helper failed." }
    $result = $resultText | ConvertFrom-Json
    if (-not $result.accessToken) { throw "$profile OAuth did not return an access token." }
    $requiredScopes = @(
        'read_orders',
        'read_reports',
        'read_analytics',
        'read_customers',
        'read_products',
        'read_inventory',
        'write_inventory',
        'read_locations',
        'read_discounts',
        'read_marketing_events',
        'read_themes'
    )
    $grantedScopes = @($result.scope -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $missingScopes = @($requiredScopes | Where-Object { $_ -notin $grantedScopes })
    if ($missingScopes.Count) { throw "$profile OAuth token is missing required scopes: $($missingScopes -join ', ')." }

    $tokenVariable = "SHOPIFY_${profile}_ADMIN_ACCESS_TOKEN"
    [Environment]::SetEnvironmentVariable($tokenVariable, $result.accessToken, 'User')
    Write-Host "$profile inventory-write OAuth token saved."
    $result = $null
    $resultText = $null
}

Write-Host ''
Write-Host 'All requested Shopify stores are authorized. Completely exit and restart Codex.'
