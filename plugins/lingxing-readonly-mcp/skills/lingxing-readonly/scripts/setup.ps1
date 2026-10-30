$ErrorActionPreference = 'Stop'

$url = Read-Host 'Paste the Lingxing MCP server URL'
if ([string]::IsNullOrWhiteSpace($url) -or -not $url.StartsWith('https://')) {
  throw 'The MCP server URL must begin with https://.'
}

$secureKey = Read-Host 'Paste the X-Mcp-Key (input is hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($key)) { throw 'X-Mcp-Key cannot be empty.' }
  [Environment]::SetEnvironmentVariable('LINGXING_MCP_URL', $url.Trim(), 'User')
  [Environment]::SetEnvironmentVariable('LINGXING_MCP_KEY', $key, 'User')
  $configureOpenApi = Read-Host 'Configure Lingxing OpenAPI for warehouse-level inventory now? (y/N)'
  if ($configureOpenApi -match '^[Yy]$') {
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
      if (-not [string]::IsNullOrWhiteSpace($baseUrl)) {
        if (-not $baseUrl.StartsWith('https://')) { throw 'OpenAPI base URL must begin with https://.' }
        [Environment]::SetEnvironmentVariable('LINGXING_OPENAPI_BASE_URL', $baseUrl.TrimEnd('/'), 'User')
      }
    } finally {
      if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
      Remove-Variable appSecret -ErrorAction SilentlyContinue
    }
  }
  Write-Host 'Saved to your Windows user environment. Restart Codex before using the connector.'
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Variable key -ErrorAction SilentlyContinue
}
