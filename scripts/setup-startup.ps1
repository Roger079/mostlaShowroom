# Setup script to register the signage display launcher in Windows Startup
$scriptDir = $PSScriptRoot
$rootDir = (Get-Item $scriptDir).Parent.FullName
$batPath = Join-Path $rootDir "start-display.bat"

if (-not (Test-Path $batPath)) {
    Write-Error "Could not find start-display.bat at $batPath"
    exit 1
}

$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "SignageDisplay.lnk"

Write-Host "Creating Windows Startup shortcut..." -ForegroundColor Cyan
Write-Host "Target : $batPath"
Write-Host "Shortcut Location : $shortcutPath"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $batPath
$shortcut.WorkingDirectory = $rootDir
$shortcut.Description = "Auto-start Signage Display Fullscreen Navigator"
$shortcut.IconLocation = "cmd.exe,0"
$shortcut.Save()

Write-Host "SUCCESS! Signage Display is now set to start automatically on Windows boot." -ForegroundColor Green
Write-Host "Shortcut created at: $shortcutPath" -ForegroundColor Yellow
