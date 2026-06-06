@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

set "DIR=%~dp0"
set "OPENCODE_DIR=%USERPROFILE%\.config\opencode"
set "PLUGINS_DIR=%OPENCODE_DIR%\plugins"

if not exist "%OPENCODE_DIR%" mkdir "%OPENCODE_DIR%"

if not exist "%OPENCODE_DIR%\opencode.json" if not exist "%OPENCODE_DIR%\opencode.jsonc" (
    echo 警告: 未找到 opencode 配置文件，将创建最小配置
    echo {} > "%OPENCODE_DIR%\opencode.json"
)

if not exist "%OPENCODE_DIR%\package.json" (
    echo {"type": "module"} > "%OPENCODE_DIR%\package.json"
    echo 已创建 %OPENCODE_DIR%\package.json
)

echo 安装 MQTT 依赖到 %OPENCODE_DIR% ...
call npm install --prefix "%OPENCODE_DIR%" aedes mqtt

if not exist "%PLUGINS_DIR%" mkdir "%PLUGINS_DIR%"
copy /Y "%DIR%opencode-plugin.js" "%PLUGINS_DIR%\ai-led.js" >nul
echo 已复制插件到 %PLUGINS_DIR%\ai-led.js

if exist "%DIR%mqtt-config.json" (
    copy /Y "%DIR%mqtt-config.json" "%PLUGINS_DIR%\mqtt-config.json" >nul
    echo 已复制配置到 %PLUGINS_DIR%\mqtt-config.json
) else (
    if not exist "%PLUGINS_DIR%\mqtt-config.json" (
        copy /Y "%DIR%mqtt-config.json.example" "%PLUGINS_DIR%\mqtt-config.json" >nul
        echo 已创建默认配置 %PLUGINS_DIR%\mqtt-config.json（请编辑填入实际连接信息）
    )
)

echo.
echo === 安装完成 ===
echo 重启 opencode 即可使用，LED 指示灯将自动工作
