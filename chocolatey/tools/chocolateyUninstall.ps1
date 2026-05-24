$ErrorActionPreference = 'Stop'

$packageName = 'desktoppet'
$appId = 'com.desktoppet.cat'

# Try HKCU first (per-user install)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId"
if (-not (Test-Path $regPath)) {
  # Try HKLM fallback
  $regPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId"
}
if (-not (Test-Path $regPath)) {
  Write-Warning "DesktopPet uninstall registry entry not found. It may already be uninstalled."
  return
}

$uninstallString = (Get-ItemProperty -Path $regPath).UninstallString
if (-not $uninstallString) {
  Write-Warning "UninstallString not found in registry."
  return
}

Write-Host "Running: $uninstallString /S"
Start-Process -FilePath $uninstallString -ArgumentList '/S' -Wait -NoNewWindow
