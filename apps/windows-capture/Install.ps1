[CmdletBinding()]
param([switch]$Rebuild)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this installer in Windows PowerShell on the PC running Discord.' }
if ([Environment]::OSVersion.Version.Build -lt 19041) { throw 'Windows 10 version 2004 or later is required.' }

# A development registration gives the app the identity required by the listener.
# No certificate installation, administrator shell, or execution-policy change is performed here.
$developerSettings = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if (-not $developerSettings -or $developerSettings.AllowDevelopmentWithoutDevLicense -ne 1) {
    throw 'Enable Developer Mode in Windows Settings (search for Developer Mode), then run Install.ps1 again. Windows requires it to register this unsigned local prototype.'
}

$packageDirectory = Join-Path $PSScriptRoot 'package'
$executable = Join-Path $packageDirectory 'Yoink.NotificationCapture.exe'
if ($Rebuild -or -not (Test-Path $executable)) {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw 'Building from source requires the .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0 . The prebuilt ZIP does not require an SDK.'
    }
    if (Get-Process -Name 'Yoink.NotificationCapture' -ErrorAction SilentlyContinue) {
        throw 'Close Yoink Notification Capture before rebuilding.'
    }
    $project = Join-Path $PSScriptRoot 'Yoink.NotificationCapture.csproj'
    if (-not (Test-Path $project)) { throw 'This ZIP contains a prebuilt app only. To rebuild, use apps/windows-capture in the repository.' }
    & dotnet publish $project -c Release -r win-x64 --self-contained true -o $packageDirectory
    if ($LASTEXITCODE -ne 0) { throw 'The capture app build failed; it has not been registered.' }
}

if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64') {
    throw 'This prototype package targets x64 Windows. Use an x64 Windows PC for the initial capture.'
}
Copy-Item (Join-Path $PSScriptRoot 'AppxManifest.xml') $packageDirectory -Force
Copy-Item (Join-Path $PSScriptRoot 'Assets') $packageDirectory -Recurse -Force
Add-AppxPackage -Register (Join-Path $packageDirectory 'AppxManifest.xml')
$package = Get-AppxPackage -Name 'Yoink.NotificationCapture'
if (-not $package) { throw 'Windows did not register the capture app.' }
Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $package.PackageFamilyName + '!Capture')
Write-Host 'Installed. In the capture window, choose Allow access and start.'
Write-Host ('Logs: ' + (Join-Path $env:USERPROFILE 'Yoink\notification-capture\logs'))
Write-Host 'Keep this extracted folder in place while the app is installed. Launch later from Start: Yoink Notification Capture.'
