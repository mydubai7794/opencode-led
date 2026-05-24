#!/usr/bin/env bash
set -euo pipefail

# AI LED - Claude Code Integration Installer (Linux/macOS)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "=== AI LED Claude Code Integration ==="
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Please install Node.js first."
    exit 1
fi
echo "[OK] Node.js found"

# Install dependencies
echo "[..] Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --production --silent 2>/dev/null
echo "[OK] Dependencies installed"

# Configure Claude Code hooks
echo "[..] Configuring Claude Code hooks..."
if node "$SCRIPT_DIR/install-hooks-helper.cjs"; then
    echo "[OK] Hooks configured in $SETTINGS_FILE"
else
    echo "[WARN] Could not update $SETTINGS_FILE automatically."
    echo "       Please add hooks manually. See README for details."
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Usage:"
echo "  1. The daemon starts automatically when you use Claude Code"
echo "  2. Or run manually:  node claude-led-daemon.mjs"
echo "  3. Check status:     npm run daemon:status"
echo "  4. Stop daemon:      npm run daemon:stop"
