#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="$HOME/.config/opencode"
PLUGINS_DIR="$OPENCODE_DIR/plugins"

if [ ! -d "$OPENCODE_DIR" ]; then
  echo "错误: 未找到 OpenCode 配置目录 ($OPENCODE_DIR)"
  echo "请先安装并运行一次 opencode"
  exit 1
fi

if [ ! -f "$OPENCODE_DIR/package.json" ]; then
  echo '{"type": "module"}' > "$OPENCODE_DIR/package.json"
  echo "已创建 $OPENCODE_DIR/package.json"
fi

echo "安装 MQTT 依赖到 $OPENCODE_DIR ..."
npm install --prefix "$OPENCODE_DIR" aedes mqtt

mkdir -p "$PLUGINS_DIR"
cp "$DIR/opencode-plugin.js" "$PLUGINS_DIR/ai-led.js"
echo "已复制插件到 $PLUGINS_DIR/ai-led.js"

if [ -f "$DIR/mqtt-config.json" ]; then
  cp "$DIR/mqtt-config.json" "$PLUGINS_DIR/mqtt-config.json"
  echo "已复制配置到 $PLUGINS_DIR/mqtt-config.json"
elif [ ! -f "$PLUGINS_DIR/mqtt-config.json" ]; then
  cp "$DIR/mqtt-config.json.example" "$PLUGINS_DIR/mqtt-config.json"
  echo "已创建默认配置 $PLUGINS_DIR/mqtt-config.json（请编辑填入实际连接信息）"
fi

echo ""
echo "=== 安装完成 ==="
echo "重启 opencode 即可使用，LED 指示灯将自动工作"
