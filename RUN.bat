@echo off
REM Launches Nick's Robot Buddy.

setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo The app isn't installed yet. Double-click INSTALL.bat first.
    pause
    exit /b 1
)

if "%ANTHROPIC_API_KEY%"=="" (
    echo.
    echo  Buddy is launching in DEMO mode.
    echo  To turn on real AI, set your API key:
    echo     setx ANTHROPIC_API_KEY "sk-ant-..."
    echo  Then close any cmd windows and run again.
    echo.
)

start "" "%~dp0.venv\Scripts\pythonw.exe" -m backend.main
