# Creates a desktop shortcut for Nick's Robot Buddy with the cute puppy icon.
# Idempotent: re-running just refreshes the shortcut.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runBat = Join-Path $projectRoot "RUN.bat"
$iconPath = Join-Path $projectRoot "assets\buddy.ico"

if (-not (Test-Path $runBat)) {
    Write-Error "RUN.bat not found at $runBat"
    exit 1
}
if (-not (Test-Path $iconPath)) {
    Write-Error "buddy.ico not found at $iconPath"
    exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Nick & Biscuit.lnk"
# Remove the old "Nick's Robot Buddy" shortcut if it exists from a prior install
$oldShortcut = Join-Path $desktop "Nick's Robot Buddy.lnk"
if (Test-Path $oldShortcut) { Remove-Item $oldShortcut -Force -ErrorAction SilentlyContinue }

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $runBat
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Talk to Biscuit and drive Nick's robot!"
$shortcut.WindowStyle = 7  # Minimized — RUN.bat itself launches a windowless pythonw
$shortcut.Save()

# Pin Save() doesn't always pick up the icon immediately on Win11; touch the
# shortcut file so Explorer rebuilds the thumbnail cache for it.
(Get-Item $shortcutPath).LastWriteTime = Get-Date

Write-Output "Created shortcut: $shortcutPath"
