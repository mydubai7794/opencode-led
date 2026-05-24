@echo off
setlocal enabledelayedexpansion

:: AI LED - Claude Code Integration Installer (Windows)
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SETTINGS_FILE=%USERPROFILE%\.claude\settings.json"

echo === AI LED Claude Code Integration ===
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)
echo [OK] Node.js found

:: Install dependencies
echo [..] Installing dependencies...
cd /d "%SCRIPT_DIR%"
call npm install --production >nul 2>&1
echo [OK] Dependencies installed

:: Configure Claude Code hooks
echo [..] Configuring Claude Code hooks...
node "%SCRIPT_DIR%\install-hooks-helper.cjs"
if %ERRORLEVEL% equ 0 (
    echo [OK] Hooks configured in %SETTINGS_FILE%
) else (
    echo [WARN] Could not update settings.json automatically.
    echo        Please add hooks manually. See README for details.
)

echo.
echo === Installation Complete ===
echo.
echo Usage:
echo   1. The daemon starts automatically when you use Claude Code
echo   2. Or run manually:  node claude-led-daemon.mjs
echo   3. Check status:     npm run daemon:status
echo   4. Stop daemon:      npm run daemon:stop
echo.
pause
