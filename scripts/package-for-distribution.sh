#!/bin/bash
# Package ChromeUse MCP for distribution
# This creates a minimal runtime package for end users

set -e

DIST_DIR="chromeuse-mcp-package"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Building ChromeUse MCP package..."

# Copy extension
echo "  - Copying extension..."
cp -r extension "$DIST_DIR/"

# Copy gateway runtime
echo "  - Copying gateway..."
mkdir -p "$DIST_DIR/gateway/dist"
cp -r gateway/dist/* "$DIST_DIR/gateway/dist/"
cp gateway/package.json "$DIST_DIR/gateway/"

# Copy shared runtime
echo "  - Copying shared modules..."
mkdir -p "$DIST_DIR/shared/dist"
cp -r shared/dist/* "$DIST_DIR/shared/dist/"
cp shared/package.json "$DIST_DIR/shared/"

# Copy root package files
echo "  - Copying documentation..."
cp package.json "$DIST_DIR/"
cp README.md "$DIST_DIR/"
cp LICENSE "$DIST_DIR/"

# Create installation guide
cat > "$DIST_DIR/INSTALL.md" << 'INSTALL'
# ChromeUse MCP Installation Guide

## Prerequisites
- Node.js 20 or newer
- A Chromium-based browser (Chrome, Brave, Arc, Edge, etc.)
- OpenCode or another MCP client

## Installation Steps

### 1. Load the Chrome Extension

1. Open `chrome://extensions` in your browser
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `extension/` directory from this package
5. Note the Extension ID shown on the card (you don't need to register it for WebSocket mode)

### 2. Configure OpenCode

Add this to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "chromeuse-mcp": {
      "type": "local",
      "enabled": true,
      "command": [
        "node",
        "/ABSOLUTE/PATH/TO/chromeuse-mcp-package/gateway/dist/index.js"
      ],
      "timeout": 15000
    }
  }
}
```

**Important:** Replace `/ABSOLUTE/PATH/TO/` with the actual path where you extracted this package.

For example:
- macOS/Linux: `/Users/alice/chromeuse-mcp-package/gateway/dist/index.js`
- The path must be absolute, not relative (don't use `~` or `./`)

### 3. Connect the Extension

1. Start OpenCode (it will launch the gateway automatically)
2. In your browser, open the ChromeUse MCP side panel (click the extension icon in the toolbar)
3. Click the "Connect" button
4. The panel should show "Connected to ws://127.0.0.1:8765"

### 4. Test the Connection

In OpenCode, try:
```
Can you call tabs_context to show me my open tabs?
```

You should see a list of your browser tabs with their IDs, titles, and URLs.

## How It Works

The ChromeUse MCP system has three components:

1. **Chrome Extension** - Runs in your browser, provides automation tools
2. **Gateway Server** - Local Node.js process that OpenCode talks to via stdio
3. **WebSocket Bridge** - Connects the gateway to the extension (port 8765)

When you start OpenCode:
- OpenCode launches the gateway via the MCP configuration
- The gateway starts a WebSocket server on `127.0.0.1:8765`
- You manually click "Connect" in the extension side panel
- The extension connects to the WebSocket bridge
- OpenCode can now send browser automation commands

Multiple OpenCode instances can share the same gateway (first one becomes the server, others become proxies).

## Troubleshooting

### Extension won't connect

**Symptoms:** Side panel shows "Disconnected" or "Connection failed"

**Solutions:**
- Make sure OpenCode is running (this starts the gateway and WebSocket server)
- Check that nothing else is using port 8765: `lsof -i :8765`
- Try restarting OpenCode to restart the gateway
- Look for errors in the browser console (F12 → Console tab)

### OpenCode can't find the gateway

**Symptoms:** OpenCode startup shows MCP server errors

**Solutions:**
- Verify the absolute path in `opencode.jsonc` is correct
- Make sure you're pointing to `gateway/dist/index.js`, not `mcp-server/dist/index.js`
- Check that Node.js 20+ is installed: `node --version`
- Try running the gateway manually to see errors: `node /path/to/gateway/dist/index.js`

### Tools return errors

**Symptoms:** OpenCode shows tool execution errors

**Solutions:**
- Open a regular web page in the browser (not `chrome://` URLs)
- Make sure the side panel shows "Connected"
- Try refreshing the web page
- Check that the extension is enabled in `chrome://extensions`

### Port already in use

**Symptoms:** Gateway fails to start with EADDRINUSE error

**Solutions:**
- Another OpenCode/ChromeUse instance is already running (this is normal in multi-instance mode)
- Or another program is using port 8765: `lsof -i :8765`
- Kill the conflicting process or change `CHROMEUSE_WS_PORT` in the MCP config

## Advanced Configuration

### Custom Ports

If port 8765 conflicts with another service, you can change it:

```jsonc
{
  "mcp": {
    "chromeuse-mcp": {
      "type": "local",
      "enabled": true,
      "command": [
        "node",
        "/path/to/gateway/dist/index.js"
      ],
      "timeout": 15000,
      "env": {
        "CHROMEUSE_WS_PORT": "9999"
      }
    }
  }
}
```

Then update the WebSocket URL in the extension side panel to `ws://127.0.0.1:9999`.

### Debug Logging

Set `CHROMEUSE_CLIENT_ID` to identify different OpenCode instances in logs:

```jsonc
"env": {
  "CHROMEUSE_CLIENT_ID": "main-session"
}
```

## Need Help?

- Full documentation: See README.md in this package
- Issues and discussions: https://github.com/huynle/chromeuse-mcp
- Troubleshooting guide: docs/TROUBLESHOOTING.md (if included)

## Uninstalling

1. Remove the MCP config from `~/.config/opencode/opencode.jsonc`
2. Remove the extension from `chrome://extensions`
3. Delete this package directory
INSTALL

# Create package archive
echo "  - Creating archive..."
tar -czf chromeuse-mcp-package.tar.gz "$DIST_DIR"

echo ""
echo "✅ Package created successfully!"
echo ""
echo "📦 Archive: chromeuse-mcp-package.tar.gz"
echo "📁 Directory: $DIST_DIR/"
echo ""
echo "To test the package:"
echo "  1. Extract: tar -xzf chromeuse-mcp-package.tar.gz"
echo "  2. Follow: $DIST_DIR/INSTALL.md"
echo ""
echo "To distribute:"
echo "  - Share chromeuse-mcp-package.tar.gz"
echo "  - Or zip the $DIST_DIR/ directory"
