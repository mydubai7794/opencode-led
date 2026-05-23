@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

set "PID_DIR=%TEMP%\ai-led"
set "BROKER_PID_FILE=%PID_DIR%\broker.pid"
set "SUB_PID_FILE=%PID_DIR%\subscriber.pid"

if exist "%BROKER_PID_FILE%" (
    set /p BROKER_PID=<"%BROKER_PID_FILE%"
    tasklist /FI "PID eq !BROKER_PID!" 2>nul | findstr /I "node" >nul && (
        taskkill /PID !BROKER_PID! /F >nul 2>&1
        echo Broker 已停止 ^(PID: !BROKER_PID!^)
    ) || echo Broker 未运行
) else (
    echo Broker 未运行
)

if exist "%SUB_PID_FILE%" (
    set /p SUB_PID=<"%SUB_PID_FILE%"
    tasklist /FI "PID eq !SUB_PID!" 2>nul | findstr /I "node" >nul && (
        taskkill /PID !SUB_PID! /F >nul 2>&1
        echo Subscriber 已停止 ^(PID: !SUB_PID!^)
    ) || echo Subscriber 未运行
) else (
    echo Subscriber 未运行
)

del /f /q "%BROKER_PID_FILE%" "%SUB_PID_FILE%" 2>nul
