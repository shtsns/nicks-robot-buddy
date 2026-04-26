@echo off
REM Pulls the latest changes from GitHub and reinstalls any new dependencies.
REM Use this on Nick's laptop instead of moving files manually.

setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo Git is not installed. Installing via winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo winget unavailable. Install Git from https://git-scm.com/download/win
        pause
        exit /b 1
    )
    winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements --scope user
    echo.
    echo Git installed. Close this window, open a new one, and run UPDATE.bat again.
    pause
    exit /b 0
)

if not exist .git (
    echo This folder isn't a git repo yet. Run INSTALL.bat first.
    pause
    exit /b 1
)

echo Pulling latest changes from GitHub...
git pull --ff-only
if errorlevel 1 (
    echo.
    echo Pull failed. If you have local edits, this script doesn't merge them.
    echo Tell a grown-up (or Claude) and they'll sort it out.
    pause
    exit /b 1
)

if exist .venv\Scripts\python.exe (
    echo Updating dependencies...
    .venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
)

echo.
echo ===================================================
echo  Update complete! Double-click RUN.bat to play.
echo ===================================================
echo.
pause
