#!/bin/sh
# ChromeUse MCP - Build All Packages
#
# Builds packages in topological order:
#   1. shared (types/utils depended on by everything)
#   2. native-host (tsc, depends on shared)
#   3. extension (typecheck + esbuild, depends on shared)
#   4. mcp-server (tsc, depends on shared)
#
# Usage:
#   ./scripts/build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building ChromeUse MCP ==="
echo ""

# ── 1. Shared types/utilities ───────────────────────────────────────────────
echo "--- Building shared ---"
(cd "$PROJECT_ROOT/shared" && npm run build)
echo ""

# ── 2. Native Host ──────────────────────────────────────────────────────────
echo "--- Building native-host ---"
(cd "$PROJECT_ROOT/native-host" && npm run build)
echo ""

# ── 3. Chrome Extension ────────────────────────────────────────────────────
echo "--- Building extension ---"
(cd "$PROJECT_ROOT/extension" && npm run typecheck && npm run build)
echo ""

# ── 4. MCP Server ──────────────────────────────────────────────────────────
echo "--- Building mcp-server ---"
(cd "$PROJECT_ROOT/mcp-server" && npm run build)
echo ""

echo "=== Build complete ==="
echo ""
echo "Outputs:"
echo "  shared:      shared/dist/"
echo "  native-host: native-host/dist/"
echo "  extension:   extension/dist/"
echo "  mcp-server:  mcp-server/dist/"
echo ""
echo "To load the extension in Chrome:"
echo "  1. Open chrome://extensions"
echo "  2. Enable Developer Mode"
echo "  3. Click 'Load unpacked'"
echo "  4. Select the extension/ directory"
