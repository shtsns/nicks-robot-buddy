@echo off
REM Packages Nick's Robot Buddy into a single zip for shipping to Nick's laptop.
REM Excludes: .venv (recreated by INSTALL.bat), __pycache__, .git, the zip itself.

setlocal
cd /d "%~dp0"

set "OUTPUT_DIR=%~dp0dist"
set "ZIP_NAME=NicksRobotBuddy.zip"
set "ZIP_PATH=%OUTPUT_DIR%\%ZIP_NAME%"

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if exist "%ZIP_PATH%" del "%ZIP_PATH%"

echo Packaging Nick's Robot Buddy...
echo Output: %ZIP_PATH%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; ^
   $src = '%~dp0'.TrimEnd('\\'); ^
   $dst = '%ZIP_PATH%'; ^
   $exclude = @('.venv', '__pycache__', '.git', 'dist', '.claude'); ^
   $tmp = Join-Path $env:TEMP ('buddy_pkg_' + [System.Guid]::NewGuid().ToString('N')); ^
   New-Item -ItemType Directory -Path $tmp ^| Out-Null; ^
   $stage = Join-Path $tmp 'NicksRobotBuddy'; ^
   New-Item -ItemType Directory -Path $stage ^| Out-Null; ^
   Get-ChildItem -Path $src -Force ^| Where-Object { $exclude -notcontains $_.Name } ^| ForEach-Object { ^
     if ($_.PSIsContainer) { ^
       robocopy $_.FullName (Join-Path $stage $_.Name) /E /XD __pycache__ .venv .git /NFL /NDL /NJH /NJS ^| Out-Null ^
     } else { ^
       Copy-Item -Path $_.FullName -Destination $stage -Force ^
     } ^
   }; ^
   Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $dst -Force; ^
   Remove-Item -Recurse -Force $tmp; ^
   $size = [Math]::Round(((Get-Item $dst).Length / 1MB), 2); ^
   Write-Host ('Done. ' + $dst + ' (' + $size + ' MB)')"

if errorlevel 1 (
    echo.
    echo Packaging failed.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo  Package ready!
echo ===================================================
echo.
echo  File: %ZIP_PATH%
echo.
echo  Send this zip to Nick's laptop. There:
echo    1. Right-click the zip -^> Extract All
echo    2. Open the extracted folder
echo    3. Double-click INSTALL.bat (auto-installs Python + deps)
echo    4. Double-click RUN.bat to play
echo.
pause
