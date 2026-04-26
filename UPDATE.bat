@echo off
REM Pulls the latest changes from GitHub and re-runs INSTALL.bat to handle
REM any new Python or dependency requirements (cheap if nothing changed).

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
    winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements --scope user
    echo.
    echo Git installed. Close this window, open a new one, and run UPDATE.bat again.
    pause
    exit /b 0
)

if not exist .git (
    echo This folder isn't a git repo. Run INSTALL.bat directly instead.
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

echo.
echo Refreshing install (auto-rebuilds venv if Python version changed)...
echo.
call "%~dp0INSTALL.bat"
