#!/bin/sh
# OpenCode Chrome Extension - Full Setup
#
# Performs a complete installation:
#   1. Install npm dependencies for all workspaces
#   2. Build all packages in topological order
#   3. Install native messaging host manifests
#   4. Print extension loading instructions
#
# Usage:
#   ./scripts/install.sh [--extension-id=<id>] ...
#
# Environment variables:
#   OPENCODE_EXTENSION_IDS  Comma-separated list of Chrome extension IDs
#
# Examples:
#   ./scripts/install.sh
#   ./scripts/install.sh --extension-id=abcdefghijklmnop

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== OpenCode Chrome Extension - Full Setup ==="
echo ""

# ── 1. Install dependencies ────────────────────────────────────────────────
echo "--- Installing dependencies ---"
(cd "$PROJECT_ROOT" && npm install)
echo ""

# ── 2. Build all packages ──────────────────────────────────────────────────
echo "--- Building all packages ---"
"$SCRIPT_DIR/build.sh"
echo ""

# ── 3. Install native messaging host manifests ─────────────────────────────
echo "--- Installing native messaging host ---"
"$SCRIPT_DIR/install-native-host.sh" "$@"
echo ""

# ── 4. Print instructions ──────────────────────────────────────────────────
echo "=== Setup Complete ==="
echo ""
echo "To load the extension in Chrome:"
echo "  1. Open chrome://extensions"
echo "  2. Enable Developer Mode (toggle in top-right)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $PROJECT_ROOT/extension"
echo ""
echo "After loading, copy the extension ID from chrome://extensions"
echo "and re-run with:"
echo "  ./scripts/install.sh --extension-id=<your-extension-id>"
echo ""
echo "This registers the extension ID in the native messaging manifest"
echo "so Chrome allows the extension to communicate with the native host."
