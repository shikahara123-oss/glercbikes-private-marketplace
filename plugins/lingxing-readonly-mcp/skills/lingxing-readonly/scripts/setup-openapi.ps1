$ErrorActionPreference = 'Stop'

$appId = Read-Host 'Paste the Lingxing OpenAPI AppID'
if ([string]::IsNullOrWhiteSpace($appId)) { throw 'OpenAPI AppID cannot be empty.' }

$secureAppSecret = Read-Host 'Paste the Lingxing OpenAPI AppSecret (input is hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAppSecret)
try {
  $appSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($appSecret)) { throw 'OpenAPI AppSecret cannot be empty.' }
  [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_APP_ID', $appId.Trim(), 'User')
  [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_APP_SECRET', $appSecret, 'User')

  $baseUrl = Read-Host 'OpenAPI base URL (press Enter for https://openapi.lingxing.com; use your HTTPS relay URL if needed)'
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_BASE_URL', $null, 'User')
    [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_RELAY_TOKEN', $null, 'User')
  } else {
    if (-not $baseUrl.StartsWith('https://')) { throw 'OpenAPI base URL must begin with https://.' }
    [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_BASE_URL', $baseUrl.TrimEnd('/'), 'User')
    $secureRelayToken = Read-Host 'Optional relay bearer token (input is hidden; press Enter if the relay does not require one)' -AsSecureString
    $relayPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRelayToken)
    try {
      $relayToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($relayPointer)
      [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_RELAY_TOKEN', $(if ([string]::IsNullOrWhiteSpace($relayToken)) { $null } else { $relayToken }), 'User')
    } finally {
      if ($relayPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($relayPointer) }
      Remove-Variable relayToken -ErrorAction SilentlyContinue
    }
  }
  Write-Host 'Lingxing OpenAPI credentials saved to the Windows user environment. Restart Codex before testing.'
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  Remove-Variable appSecret -ErrorAction SilentlyContinue
}
