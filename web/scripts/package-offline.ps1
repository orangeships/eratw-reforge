[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$KojoBundle,

  [Parameter(Mandatory = $true)]
  [string]$TrainMessageBundle
)

$ErrorActionPreference = "Stop"

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$publicRoot = Join-Path $webRoot "public"
$kojoDestination = Join-Path $publicRoot "kojo.bundle.json"
$trainDestination = Join-Path $publicRoot "train-message.bundle.json"

$kojoSource = (Resolve-Path -LiteralPath $KojoBundle).Path
$trainSource = (Resolve-Path -LiteralPath $TrainMessageBundle).Path
foreach ($source in @($kojoSource, $trainSource)) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Offline package input does not exist: $source"
  }
}

New-Item -ItemType Directory -Force -Path $publicRoot | Out-Null
Copy-Item -LiteralPath $kojoSource -Destination $kojoDestination -Force
Copy-Item -LiteralPath $trainSource -Destination $trainDestination -Force

$env:VITE_OFFLINE_KOJO_BUNDLE = "1"
$exitCode = 1
try {
  Push-Location $webRoot
  & pnpm.cmd tauri build --config src-tauri/tauri.offline.conf.json
  $exitCode = $LASTEXITCODE
}
finally {
  Pop-Location
  Remove-Item -LiteralPath $kojoDestination, $trainDestination -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw "Tauri offline package build failed with exit code $exitCode"
}

Write-Host "Offline package created under src-tauri/target/release/bundle."
