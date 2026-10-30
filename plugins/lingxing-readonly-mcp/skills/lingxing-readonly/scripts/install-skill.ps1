[CmdletBinding()]
param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceSkill = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
  $Destination = Join-Path (Join-Path $codexRoot 'skills') 'lingxing-readonly'
}
$targetSkill = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $targetSkill) { throw "Destination already exists; existing installation was preserved: $targetSkill" }
if (-not (Test-Path -LiteralPath (Join-Path $sourceSkill 'SKILL.md'))) { throw 'Cannot locate packaged SKILL.md.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $targetSkill) -Force | Out-Null
Copy-Item -LiteralPath $sourceSkill -Destination $targetSkill -Recurse
Write-Host "Installed Skill: $targetSkill"
Write-Host 'Configure credentials with setup.ps1 or setup-openapi.ps1. The skill is available in a new Codex turn.'
