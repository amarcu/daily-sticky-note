# One-liner installer for Windows. Downloads the latest prebuilt release and
# runs the installer - no toolchain required.
#
#   irm https://raw.githubusercontent.com/amarcu/daily-sticky-note/main/install.ps1 | iex
#
$ErrorActionPreference = 'Stop'
$repo = 'amarcu/daily-sticky-note'

Write-Host "Looking up the latest release of $repo..."
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" `
  -Headers @{ 'User-Agent' = 'daily-sticky-note-installer' }

# Prefer the NSIS .exe installer, fall back to the .msi.
$asset = $release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1
if (-not $asset) {
  $asset = $release.assets | Where-Object { $_.name -match '\.msi$' } | Select-Object -First 1
}
if (-not $asset) {
  throw "No .exe or .msi installer found in the latest release."
}

$out = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out

Write-Host "Launching the installer..."
Write-Host "(Windows SmartScreen may warn about an unknown publisher - choose 'More info' > 'Run anyway'.)"
Start-Process $out
