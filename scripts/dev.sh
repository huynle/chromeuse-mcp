#!/bin/sh
# OpenCode Chrome Extension - Development Mode
#
# Builds shared and native-host once, then runs the extension esbuild
# in watch mode for rapid development.
#
# Usage:
#   ./scripts/dev.sh
#
# After making changes:
#   - Extension: Click the reload button on chrome://extensions
#   - Native host: Re-run this script (or manually: cd native-host && npm run build)
#   - Shared types: Re-run this script (shared must rebuild before dependents)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== OpenCode Chrome Extension - Dev Mode ==="
echo ""

# Ensure dependencies are installed
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  echo "--- Installing dependencies ---"
  (cd "$PROJECT_ROOT" && npm install)
  echo ""
fi

# Build shared types once (depended on by everything)
echo "--- Building shared ---"
(cd "$PROJECT_ROOT/shared" && npm run build)
echo ""

# Build native host once (no watch mode for tsc stdio host)
echo "--- Building native-host ---"
(cd "$PROJECT_ROOT/native-host" && npm run build)
echo ""

# Build mcp-server once
echo "--- Building mcp-server ---"
(cd "$PROJECT_ROOT/mcp-server" && npm run build)
echo ""

# Start extension build in watch mode
echo "--- Starting extension watch mode ---"
echo "Watching for changes... (Ctrl+C to stop)"
echo ""
(cd "$PROJECT_ROOT/extension" && npm run build:watch)
