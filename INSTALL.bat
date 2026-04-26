@echo off
REM One-click installer for Nick's Robot Buddy.
REM Pins the venv to Python 3.12. Auto-installs Python 3.12 via winget if missing.
REM 3.13/3.14 are explicitly avoided because pywebview's pythonnet dep has no
REM prebuilt wheels there yet and source builds break on Windows.

setlocal
cd /d "%~dp0"

echo ===================================================
echo  Installing Nick's Robot Buddy
echo ===================================================
echo.

REM ---- Find Python 3.12 specifically (pythonnet wheels not on 3.13+ yet) ----
set "PYTHON_EXE="

if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) else if exist "%ProgramFiles%\Python312\python.exe" (
    set "PYTHON_EXE=%ProgramFiles%\Python312\python.exe"
) else if exist "%ProgramFiles(x86)%\Python312\python.exe" (
    set "PYTHON_EXE=%ProgramFiles(x86)%\Python312\python.exe"
)

if not defined PYTHON_EXE (
    echo Python 3.12 not found. Installing via winget...
    echo (3.13 and 3.14 don't yet have prebuilt wheels for one of our deps.)
    echo This may take 1-2 minutes.
    echo.

    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo  ERROR: winget is not available.
        echo  Please install Python 3.12 manually from:
        echo    https://www.python.org/downloads/release/python-3127/
        echo  Make sure to CHECK "Add Python to PATH" during install.
        echo.
        pause
        exit /b 1
    )

    winget install --id Python.Python.3.12 -e --source winget --silent --accept-package-agreements --accept-source-agreements --scope user
    if errorlevel 1 (
        echo.
        echo  Python 3.12 install via winget failed.
        echo  Try installing manually from python.org.
        echo.
        pause
        exit /b 1
    )

    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    )
)

if not defined PYTHON_EXE (
    echo.
    echo  Python 3.12 installed but not found at expected location.
    echo  Close this window, open a new one, and run INSTALL.bat again.
    echo.
    pause
    exit /b 1
)

echo Using Python: %PYTHON_EXE%
"%PYTHON_EXE%" --version
echo.

REM ---- If venv exists with a different Python version, rebuild it ----
if exist .venv\Scripts\python.exe (
    "%PYTHON_EXE%" -c "import sys; sys.exit(0)" >nul 2>nul
    .venv\Scripts\python.exe -c "import sys; assert sys.version_info[:2] == (3, 12)" >nul 2>nul
    if errorlevel 1 (
        echo Existing virtual environment uses a different Python version. Rebuilding...
        rmdir /s /q .venv
    )
)

REM ---- Create venv ----
if not exist .venv (
    echo Creating virtual environment with Python 3.12...
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
