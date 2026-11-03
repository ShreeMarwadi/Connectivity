# Connectivity portable build
# Uses the trusted Electron binary instead of the renamed/packaged executable,
# so Windows Smart App Control does not block it.
#
# Usage (from repo root):  powershell -ExecutionPolicy Bypass -File .\make-portable.ps1

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist    = Join-Path $root 'dist-desktop'
$work    = Join-Path $root 'build-portable'
$out     = Join-Path $work 'Connectivity'
$version = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$zip     = Join-Path $dist "Connectivity-Portable-$version.zip"
$electron = Join-Path $root 'desktop\node_modules\electron\dist'
$packed  = Join-Path $dist 'win-unpacked\resources'

if (-not (Test-Path (Join-Path $packed 'app.asar'))) {
  throw "Pehle 'npm run dist' chalao (dist-desktop\win-unpacked\resources\app.asar nahi mila)."
}

# Only a copy running from build-portable locks those files; a normal install is left alone.
Get-Process Connectivity, SmartConnectLike -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($work, [System.StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force
Start-Sleep -Seconds 2

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Copy-Item (Join-Path $electron '*') $out -Recurse -Force
Copy-Item (Join-Path $packed 'app.asar') (Join-Path $out 'resources\app.asar') -Force
Copy-Item (Join-Path $packed 'app.asar.unpacked') (Join-Path $out 'resources\app.asar.unpacked') -Recurse -Force
if (Test-Path (Join-Path $packed 'vcam')) {
  Copy-Item (Join-Path $packed 'vcam') (Join-Path $out 'resources\vcam') -Recurse -Force
}
Remove-Item (Join-Path $out 'resources\default_app.asar') -ErrorAction SilentlyContinue
Rename-Item (Join-Path $out 'electron.exe') 'Connectivity.exe'

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel Optimal

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Portable build ready: $zip ($mb MB)"
Write-Host "Test: $out\Connectivity.exe"
