@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

set "DIR=%~dp0"
set "PID_DIR=%TEMP%\ai-led"
set "BROKER_PID_FILE=%PID_DIR%\broker.pid"
set "SUB_PID_FILE=%PID_DIR%\subscriber.pid"

if not exist "%PID_DIR%" mkdir "%PID_DIR%"

set "BROKER_RUNNING=0"
set "SUB_RUNNING=0"

if exist "%BROKER_PID_FILE%" (
    set /p BROKER_PID=<"%BROKER_PID_FILE%"
    tasklist /FI "PID eq !BROKER_PID!" 2>nul | findstr /I "node" >nul && set "BROKER_RUNNING=1"
)

if "!BROKER_RUNNING!"=="1" (
    echo Broker 已在运行 ^(PID: !BROKER_PID!^)
) else (
    del /f /q "%BROKER_PID_FILE%" "%SUB_PID_FILE%" 2>nul
    start /b "" node "%DIR%broker.js" > "%PID_DIR%\broker.log" 2>&1
    timeout /t 2 /nobreak >nul
    for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST ^| findstr "PID" 2^>nul') do set "BROKER_PID=%%a"
    if defined BROKER_PID (
        echo !BROKER_PID!> "%BROKER_PID_FILE%"
        echo Broker 已启动 ^(PID: !BROKER_PID!^)
    ) else (
        echo Broker 启动中...
    )
)

if exist "%SUB_PID_FILE%" (
    set /p SUB_PID=<"%SUB_PID_FILE%"
    tasklist /FI "PID eq !SUB_PID!" 2>nul | findstr /I "node" >nul && set "SUB_RUNNING=1"
)

if "!SUB_RUNNING!"=="1" (
    echo Subscriber 已在运行 ^(PID: !SUB_PID!^)
) else (
    start /b "" node "%DIR%subscriber.js" > "%PID_DIR%\subscriber.log" 2>&1
    timeout /t 2 /nobreak >nul
    for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST ^| findstr "PID" 2^>nul') do set "SUB_PID=%%a"
    if defined SUB_PID (
        echo !SUB_PID!> "%SUB_PID_FILE%"
        echo Subscriber 已启动 ^(PID: !SUB_PID!^)
    ) else (
        echo Subscriber 启动中...
    )
)

echo.
echo === 服务就绪 ===
echo Broker log: %PID_DIR%\broker.log
echo Subscriber log: %PID_DIR%\subscriber.log
