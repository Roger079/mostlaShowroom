# PowerShell script to auto-start Fullscreen Navigator for Signage Displays
param (
    [switch]$Reset,
    [string]$DisplayName,
    [string]$ServerUrl
)

# Determine path for configuration file
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
$configFile = Join-Path $scriptDir "display-config.json"

# Function to prompt user using Windows GUI dialog with console fallback
function Get-UserInput {
    param (
        [string]$Title,
        [string]$Prompt,
        [string]$DefaultValue
    )

    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $result = [Microsoft.VisualBasic.Interaction]::InputBox($Prompt, $Title, $DefaultValue)
        if ([string]::IsNullOrWhiteSpace($result)) {
            return $DefaultValue
        }
        return $result.Trim()
    }
    catch {
        Write-Host "$Prompt [$DefaultValue]: " -NoNewline
        $inputVal = Read-Host
        if ([string]::IsNullOrWhiteSpace($inputVal)) {
            return $DefaultValue
        }
        return $inputVal.Trim()
    }
}

# Prompt setup if first run or reset requested
if ($Reset -or -not (Test-Path $configFile)) {
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "    SIGNAGE DISPLAY INITIAL SETUP           " -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "Configuring this machine for signage display..."

    if (-not $DisplayName) {
        $DisplayName = Get-UserInput -Title "Display Configuration" `
                                     -Prompt "Enter a Display Name for this screen (e.g. screen1, entrance, display-1):" `
                                     -DefaultValue "screen1"
    }

    if (-not $ServerUrl) {
        $ServerUrl = Get-UserInput -Title "Server Configuration" `
                                   -Prompt "Enter the Hub Server URL:" `
                                   -DefaultValue "http://localhost:3000"
    }

    # Normalize Server URL
    if (-not ($ServerUrl.StartsWith("http://") -or $ServerUrl.StartsWith("https://"))) {
        $ServerUrl = "http://" + $ServerUrl
    }
    $ServerUrl = $ServerUrl.TrimEnd('/')

    $configData = @{
        displayName = $DisplayName
        serverUrl   = $ServerUrl
        configuredAt = (Get-Date).ToString("o")
    }

    $configData | ConvertTo-Json | Set-Content -Path $configFile -Encoding UTF8
    Write-Host "Configuration saved to: $configFile" -ForegroundColor Green
} else {
    $configJson = Get-Content -Path $configFile -Raw | ConvertFrom-Json
    $DisplayName = $configJson.displayName
    $ServerUrl = $configJson.serverUrl
}

Write-Host "Starting Signage Display..." -ForegroundColor Green
Write-Host "Display Name : $DisplayName" -ForegroundColor Yellow
Write-Host "Server URL   : $ServerUrl" -ForegroundColor Yellow

# Build full target URL
$targetUrl = "$ServerUrl/display.html?displayId=$([Uri]::EscapeDataString($DisplayName))&screen=$([Uri]::EscapeDataString($DisplayName))"
Write-Host "Target URL   : $targetUrl" -ForegroundColor Gray

# Browser binary discovery paths
$browserPaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
    "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
)

$foundBrowser = $null
foreach ($path in $browserPaths) {
    if (Test-Path $path) {
        $foundBrowser = $path
        break
    }
}

if ($foundBrowser) {
    Write-Host "Launching fullscreen browser: $foundBrowser" -ForegroundColor Green
    if ($foundBrowser -like "*firefox.exe") {
        Start-Process -FilePath $foundBrowser -ArgumentList "--kiosk", "`"$targetUrl`""
    } else {
        # Chromium flags (Chrome, Edge, Brave)
        $arguments = @(
            "--kiosk",
            "`"$targetUrl`"",
            "--noerrdialogs",
            "--disable-infobars",
            "--no-first-run",
            "--check-for-update-interval=31536000",
            "--autoplay-policy=no-user-gesture-required"
        ) -join " "
        Start-Process -FilePath $foundBrowser -ArgumentList $arguments
    }
} else {
    Write-Host "No standard Chromium/Firefox binary found. Launching default browser..." -ForegroundColor Yellow
    Start-Process $targetUrl
}
