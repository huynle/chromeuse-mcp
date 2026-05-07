#!/bin/sh
# ChromeUse MCP - Native Host Installer
#
# Installs native messaging host manifests for all Chromium browsers
# on macOS and Linux.
#
# Usage:
#   ./scripts/install-native-host.sh [--extension-id=<id>] ...
#
# Environment variables:
#   CHROMEUSE_EXTENSION_IDS  Comma-separated list of Chrome extension IDs
#
# Examples:
#   ./scripts/install-native-host.sh --extension-id=abcdefghijklmnop
#   CHROMEUSE_EXTENSION_IDS=id1,id2 ./scripts/install-native-host.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_HOST_DIR="$PROJECT_ROOT/native-host"

# Check that the native host is built
if [ ! -f "$NATIVE_HOST_DIR/dist/install.js" ]; then
  echo "Building native-host..."
  (cd "$NATIVE_HOST_DIR" && npm run build)
fi

# Run the installer
exec node "$NATIVE_HOST_DIR/dist/install.js" "$@"
