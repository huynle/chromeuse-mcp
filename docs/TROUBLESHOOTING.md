# Troubleshooting

This guide covers the most common setup and runtime issues.

## MCP Client Cannot Connect to the Native Host

Symptoms:

- Tool calls fail with `Failed to connect to native host`.
- The extension side panel shows disconnected.

Checks:

1. Confirm the extension is loaded in `chrome://extensions`.
2. Confirm you ran `./scripts/install.sh --extension-id=<your-extension-id>` after loading the unpacked extension.
3. Reload the extension in `chrome://extensions`.
4. Restart the browser.
5. Restart the MCP client.

The first install often runs before you know the extension ID. That creates native messaging manifests with an empty `allowed_origins` list. Re-running the installer with the extension ID is required.

## Wrong Extension ID Registered

The extension ID can change if you load a different extension directory or browser profile.

Fix:

```sh
./scripts/install.sh --extension-id=<current-extension-id>
```

Then reload the extension and restart the MCP client.

## MCP Client Config Uses a Relative Path

Use an absolute path to the built server file:

```json
{
  "mcpServers": {
    "chromeuse": {
      "command": "node",
      "args": ["/absolute/path/to/chromeuse-mcp/mcp-server/dist/index.js"]
    }
  }
}
```

After editing MCP client config, restart the client.

## Build Output Is Missing

Symptoms:

- `mcp-server/dist/index.js` does not exist.
- Extension files under `extension/dist/` do not exist.

Fix:

```sh
./scripts/build.sh
```

If dependencies are missing:

```sh
npm install
./scripts/build.sh
```

## Extension Changes Do Not Appear

After changing extension code, reload the unpacked extension in `chrome://extensions`. Manifest V3 service workers and content scripts do not automatically update in already-loaded extensions.

For development:

```sh
./scripts/dev.sh
```

Then reload the extension after each extension build.

## Browser Is Unsupported

The installer supports native messaging manifest paths for:

- Chrome
- Brave
- Arc on macOS
- Edge
- Chromium
- Vivaldi
- Opera

Windows is not currently supported. Linux support depends on the browser using the standard NativeMessagingHosts directory for that browser.

## Tool Requires `tabId`

Most tools require an explicit `tabId`. Call `tabs_context` first, then pass the returned ID to the tool.

`navigate` can default to the active tab, but explicit `tabId` is still recommended.

## `read_console_messages` or `read_network_requests` Is Empty

Console and network data is captured after the extension attaches through Chrome DevTools Protocol. Try:

1. Navigate or reload the page after starting the workflow.
2. Trigger the behavior again.
3. Call the read tool with a larger `limit`.
4. Avoid clearing results until after inspection.

## `find` Cannot Locate an Element

Try these alternatives:

- Call `read_page` with `format: "accessibility"` and inspect available refs.
- Use a more visible label in the `query`.
- Use `computer` screenshot and coordinate-based targeting.
- Scroll the page and retry if the element is lazy-loaded or off screen.

## Native Messaging Manifest Locations

The installer writes `com.chromeuse.mcp_bridge.json` to each supported browser's NativeMessagingHosts directory under your home directory.

On macOS, examples include:

- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`
- `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`

On Linux, examples include:

- `~/.config/google-chrome/NativeMessagingHosts/`
- `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/`
- `~/.config/chromium/NativeMessagingHosts/`

The wrapper script is written to:

```text
~/.chromeuse/native-host
```

## Collect Useful Diagnostics

When opening an issue, include:

- Operating system and version.
- Browser name and version.
- Node.js version from `node --version`.
- Whether `./scripts/build.sh` succeeds.
- Whether `npm test` succeeds.
- The MCP client being used.
- The exact error text from the MCP client or extension side panel.
