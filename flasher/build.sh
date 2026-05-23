#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$DIR/.." && pwd)"
BUILD_DIR="/tmp/esp8266-build"
FIRMWARE_DIR="$DIR/firmware/esp8266"
FQBN="esp8266:esp8266:generic"
SKETCH="$PROJECT_ROOT/firmware/ai-led-firmware-esp8266/ai-led-firmware-esp8266.ino"

echo "=== 编译 ESP8266 固件 ==="
echo "芯片: $FQBN"
echo "源码: $SKETCH"
echo ""

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$FIRMWARE_DIR"

arduino-cli compile \
  --fqbn "$FQBN" \
  --board-options eesz=4M1M \
  --build-path "$BUILD_DIR" \
  "$SKETCH"

cp "$BUILD_DIR/ai-led-firmware-esp8266.ino.bin" "$FIRMWARE_DIR/ai-led-firmware.bin"

SIZE=$(ls -lh "$FIRMWARE_DIR/ai-led-firmware.bin" | awk '{print $5}')
echo ""
echo "=== 编译完成 ==="
echo "固件: $FIRMWARE_DIR/ai-led-firmware.bin ($SIZE)"
echo ""
echo "运行以下命令启动烧录服务器："
echo "  node $DIR/server.mjs"
