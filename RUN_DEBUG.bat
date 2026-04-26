@echo off
REM Launches Nick's Robot Buddy with WebView2 dev tools enabled.
REM Right-click in the app -> Inspect to see console logs and the DOM.

setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo The app isn't installed yet. Double-click INSTALL.bat first.
    pause
    exit /b 1
)

set BUDDY_DEBUG=1
.venv\Scripts\python.exe -m backend.main
