$ErrorActionPreference = 'Stop'

$packageName = 'desktoppet'
$version = '1.0.0'
$repo = 'yangr8640-eng/desktop-pet'

$baseUrl = "https://github.com/$repo/releases/download/v$version"

# Detect architecture and pick the right installer
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($arch -eq 'Arm64') {
  $installerName = "DesktopPet-Setup-$version-arm64.exe"
} else {
  $installerName = "DesktopPet-Setup-$version.exe"
}

$url = "$baseUrl/$installerName"

$packageArgs = @{
  packageName   = $packageName
  fileType      = 'EXE'
  url           = $url
  softwareName  = 'DesktopPet*'
  silentArgs    = '/S'
  validExitCodes= @(0)
}

Install-ChocolateyPackage @packageArgs
