@echo off
REM One-click installer for Nick's Robot Buddy.
REM Auto-installs Python 3.12 via winget if needed, then sets up the venv.

setlocal
cd /d "%~dp0"

echo ===================================================
echo  Installing Nick's Robot Buddy
echo ===================================================
echo.

REM ---- Find Python ----
set "PYTHON_EXE="
for /f "delims=" %%i in ('where python 2^>nul') do (
    if not defined PYTHON_EXE set "PYTHON_EXE=%%i"
)

REM Reject the Microsoft Store stub (it's there even when real Python isn't)
if defined PYTHON_EXE (
    echo "%PYTHON_EXE%" | findstr /i "WindowsApps" >nul
    if not errorlevel 1 set "PYTHON_EXE="
)

if not defined PYTHON_EXE (
    REM Look in standard install locations
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
)

if not defined PYTHON_EXE (
    echo Python is not installed. Installing Python 3.12 via winget...
    echo This may take 1-2 minutes.
    echo.

    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo  ERROR: winget is not available.
        echo  Please install Python 3.12 manually from:
        echo    https://www.python.org/downloads/windows/
        echo  Make sure to CHECK "Add Python to PATH" during install.
        echo.
        pause
        exit /b 1
    )

    winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements --scope user
    if errorlevel 1 (
        echo.
        echo  Python install via winget failed.
        echo  Try installing manually from python.org.
        echo.
        pause
        exit /b 1
    )

    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else (
        echo.
        echo  Python installed but not found at expected location.
        echo  Close this window, open a new Command Prompt, and run INSTALL.bat again.
        echo.
        pause
        exit /b 1
    )
)

echo Using Python: %PYTHON_EXE%
"%PYTHON_EXE%" --version
echo.

REM ---- Create venv ----
if not exist .venv (
    echo Creating virtual environment...
    "%PYTHON_EXE%" -m venv .venv
    if errorlevel 1 (
        echo Failed to create virtual environment.
        pause
        exit /b 1
    )
)

REM ---- Install dependencies ----
echo Installing dependencies (anthropic, pywebview, pyserial)...
.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo.
    echo Failed to install dependencies. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo  Setup complete!
echo ===================================================
echo.
echo  To play right now in DEMO mode (no AI brain yet):
echo    Double-click RUN.bat
echo.
echo  To turn on Buddy's smart AI brain:
echo    1. Get an API key at console.anthropic.com (5 min)
echo    2. Open a new Command Prompt and run:
echo         setx ANTHROPIC_API_KEY "sk-ant-...your-key..."
echo    3. Close it, then double-click RUN.bat
echo.
echo  Connecting the robot:
echo    1. Pair the mBot in Windows Bluetooth settings
echo    2. In the app, click Drive the Robot, hit refresh,
echo       pick the mBot's COM port, and click Connect.
echo.
pause
