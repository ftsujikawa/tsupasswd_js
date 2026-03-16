param(
  [string]$ExtensionId = "cmodllncabncibkbleljmljfkehgkopn",
  [string]$SourceHostExePath = (Join-Path $PSScriptRoot "native-host\BridgeHost\bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe"),
  [string]$VaultHostExePath = (Join-Path $PSScriptRoot "native-host\VaultHost\bin\Release\net8.0-windows\win-x64\publish\tsupasswd-vault-host.exe"),
  [string]$CoreExePath = "",
  [string]$AppDataRoot = (Join-Path $env:LOCALAPPDATA "tsupasswd")
)

$ErrorActionPreference = "Stop"

$allowedOrigins = @("chrome-extension://$ExtensionId/")

$hostName = "com.tsupasswd.bridge"
$vaultHostName = "dev.happyfactory.tsupasswd_core"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$vaultRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$vaultHostName"
$edgeRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
$edgeVaultRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$vaultHostName"

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw "LOCALAPPDATA is not available."
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  throw "ExtensionId is required."
}

$sourcePublishDir = Split-Path -Parent $SourceHostExePath
if (-not (Test-Path -LiteralPath $SourceHostExePath)) {
  throw "Native host EXE was not found: $SourceHostExePath"
}

$installDir = Join-Path $AppDataRoot "bridge-host"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

$filesToCopy = @(
  "tsupasswd-bridge-host.exe",
  "tsupasswd-bridge-host.dll",
  "tsupasswd-bridge-host.deps.json",
  "tsupasswd-bridge-host.runtimeconfig.json"
)

foreach ($file in $filesToCopy) {
  $src = Join-Path $sourcePublishDir $file
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Required file is missing: $src"
  }
  Copy-Item -LiteralPath $src -Destination (Join-Path $installDir $file) -Force
}

$installedExePath = Join-Path $installDir "tsupasswd-bridge-host.exe"
$manifestPath = Join-Path $AppDataRoot "$hostName.json"

$manifest = [ordered]@{
  name = $hostName
  description = "Bridge host for tsupasswd chrome extension"
  path = $installedExePath
  type = "stdio"
  allowed_origins = $allowedOrigins
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding UTF8

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
New-Item -Path $edgeRegistryPath -Force | Out-Null
Set-Item -Path $edgeRegistryPath -Value $manifestPath

if (-not (Test-Path -LiteralPath $VaultHostExePath)) {
  $legacyVaultHostExePath = (Join-Path $PSScriptRoot "native-host\VaultHost\bin\Release\net8.0\win-x64\publish\tsupasswd-vault-host.exe")
  if (Test-Path -LiteralPath $legacyVaultHostExePath) {
    $VaultHostExePath = $legacyVaultHostExePath
  }
  if ([string]::IsNullOrWhiteSpace($CoreExePath)) {
    throw "Vault host EXE was not found: $VaultHostExePath"
  }
}

if (-not [string]::IsNullOrWhiteSpace($CoreExePath)) {
  if (-not (Test-Path -LiteralPath $CoreExePath)) {
    throw "Core EXE was not found: $CoreExePath"
  }
  $installedVaultExePath = $CoreExePath
} else {
  $vaultSourcePublishDir = Split-Path -Parent $VaultHostExePath
  $vaultInstallDir = Join-Path $AppDataRoot "vault-host"
  New-Item -ItemType Directory -Path $vaultInstallDir -Force | Out-Null

  $vaultFilesToCopy = @(
    "tsupasswd-vault-host.exe",
    "tsupasswd-vault-host.dll",
    "tsupasswd-vault-host.deps.json",
    "tsupasswd-vault-host.runtimeconfig.json"
  )

  foreach ($file in $vaultFilesToCopy) {
    $src = Join-Path $vaultSourcePublishDir $file
    if (-not (Test-Path -LiteralPath $src)) {
      throw "Required vault host file is missing: $src"
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $vaultInstallDir $file) -Force
  }

  $installedVaultExePath = Join-Path $vaultInstallDir "tsupasswd-vault-host.exe"
}

$vaultManifestPath = Join-Path $AppDataRoot "$vaultHostName.json"
$vaultManifest = [ordered]@{
  name = $vaultHostName
  description = "Vault native host for tsupasswd chrome extension"
  path = $installedVaultExePath
  type = "stdio"
  allowed_origins = $allowedOrigins
}

$vaultManifestJson = $vaultManifest | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $vaultManifestPath -Value $vaultManifestJson -Encoding UTF8

New-Item -Path $vaultRegistryPath -Force | Out-Null
Set-Item -Path $vaultRegistryPath -Value $vaultManifestPath
New-Item -Path $edgeVaultRegistryPath -Force | Out-Null
Set-Item -Path $edgeVaultRegistryPath -Value $vaultManifestPath

Write-Host "Native host installed successfully."
Write-Host "Manifest: $manifestPath"
Write-Host "Host exe: $installedExePath"
Write-Host "Registry: $registryPath"
Write-Host "Edge Registry: $edgeRegistryPath"
Write-Host "Vault Manifest: $vaultManifestPath"
Write-Host "Vault Host exe: $installedVaultExePath"
Write-Host "Vault Registry: $vaultRegistryPath"
Write-Host "Edge Vault Registry: $edgeVaultRegistryPath"
