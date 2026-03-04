param(
  [string]$ExtensionId = "khcgmggnifgegehckhiaodlnackcnoop",
  [string]$SourceHostExePath = (Join-Path $PSScriptRoot "native-host\BridgeHost\bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe"),
  [string]$AppDataRoot = (Join-Path $env:LOCALAPPDATA "tsupasswd")
)

$ErrorActionPreference = "Stop"

$hostName = "com.tsupasswd.bridge"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

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
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding UTF8

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Native host installed successfully."
Write-Host "Manifest: $manifestPath"
Write-Host "Host exe: $installedExePath"
Write-Host "Registry: $registryPath"
