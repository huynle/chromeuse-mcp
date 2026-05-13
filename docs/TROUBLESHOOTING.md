# Troubleshooting

This guide covers the most common setup and runtime issues.

ChromeUse supports two local browser transports:

- Gateway WebSocket path: `gateway/dist/index.js` runs in automatic SERVER/PROXY mode by default. Normal OpenCode config needs only `node` plus an absolute `gateway/dist/index.js` path. The SERVER owns the HTTP gateway at `127.0.0.1:8766` and the WebSocket bridge at `ws://127.0.0.1:8765` by default.
- Direct native messaging fallback path: `mcp-server/dist/index.js` does not use gateway HTTP election. It can use Chrome native messaging after the extension ID is registered in the native messaging manifest.

The **Connect** button is only for the localhost WebSocket transport. It is not a native messaging bypass and does not change Chrome native messaging policy.

Gateway MVP browser traffic is WebSocket-only. Use direct `mcp-server/dist/index.js` if you need native messaging fallback.

Workspace and document features are part of the ChromeUse side panel. They are not a bundled Chrome Reader extension, and PDF/Office support is placeholder/extensible in this foundation phase.

## MCP Server Is Not Running

Symptoms:

- The side panel stays disconnected or switches to error after clicking **Connect**.
- MCP tool calls fail before reaching the browser.
- No process is running `gateway/dist/index.js` or `mcp-server/dist/index.js`.

Checks:

1. Restart your MCP client after adding the ChromeUse server config.
2. Confirm the config uses `node` with an absolute path to `gateway/dist/index.js` for normal OpenCode gateway mode. Do not set `CHROMEUSE_GATEWAY_MODE` unless you are debugging a non-default mode.
3. Confirm the repository has been built with `./scripts/build.sh`.

The WebSocket bridge is created by the gateway SERVER or direct MCP server process. Opening the extension side panel alone does not start either process.

For OpenCode gateway mode, the config should point to `gateway/dist/index.js` with no required environment variables:

```json
{
  "mcpServers": {
    "chromeuse": {
      "command": "node",
      "args": ["/absolute/path/to/chromeuse-mcp/gateway/dist/index.js"]
    }
  }
}
```

Set `CHROMEUSE_HTTP_PORT` only when multiple gateway groups need separate local HTTP ports. The default HTTP gateway port is `8766`, chosen instead of common app development ports such as `3000` so it sits next to the WebSocket bridge default, `8765`. Set `CHROMEUSE_WS_PORT` only when the extension side panel is configured to connect to the same WebSocket port. `CHROMEUSE_CLIENT_ID` is optional and can identify a client instance in logs or diagnostics.

## Side Panel Connect Does Not Connect

Symptoms:

- Clicking **Connect** leaves the side panel in `Connecting` or `Connection Error`.
- MCP errors mention `No extension connected`.

Checks:

1. Confirm your MCP client is running ChromeUse MCP.
2. Confirm the browser extension is loaded in the same browser where you opened the side panel.
3. Keep the side panel connection active while running tool calls.
4. If you changed the WebSocket port, make sure the extension and MCP server use the same URL. The extension default is `ws://127.0.0.1:8765`.

When using direct `mcp-server/dist/index.js`, ChromeUse may still work through native messaging even when the side panel is disconnected if native messaging is installed correctly. Gateway mode does not use native messaging fallback; its Connect flow is for the WebSocket path.

## WebSocket Port Is Already In Use

Symptoms:

- MCP tool calls fail with `WebSocket bridge port 8765 already in use on 127.0.0.1`.
- Another local process is already listening on port `8765`.

Fix:

The side panel Connect flow expects the ChromeUse WebSocket bridge on `127.0.0.1:8765` by default, so the simplest fix is to stop the other local process using port `8765`, then restart your MCP client.

Advanced setups can set a different WebSocket port in the MCP client server environment:

```json
{
  "mcpServers": {
    "chromeuse": {
      "command": "node",
      "args": ["/absolute/path/to/chromeuse-mcp/mcp-server/dist/index.js"],
      "env": {
        "CHROMEUSE_WS_PORT": "9876"
      }
    }
  }
}
```

Restart the MCP client after changing the port. The extension must connect to the same WebSocket URL, so use the default port unless you have an extension build or configuration that matches the custom port.

## Gateway HTTP Port Is Already In Use

Symptoms:

- The first OpenCode gateway instance fails to start before any SERVER is available.
- Logs mention failure to bind the local HTTP gateway port.
- A later gateway instance becomes PROXY when you expected it to own the browser connection.

Checks:

1. Use the same `CHROMEUSE_HTTP_PORT` for OpenCode instances that should share one ChromeUse extension connection.
2. Stop unrelated local processes using the gateway HTTP port, or choose another `CHROMEUSE_HTTP_PORT`.
3. If a ChromeUse gateway SERVER is already running on that port, later instances should become PROXY after a compatible `/health` probe.
4. If the `/health` probe is incompatible, stop the stale process or change the HTTP port.

SERVER owns the HTTP listener on `127.0.0.1:8766` by default and the WebSocket bridge on `127.0.0.1:8765` by default. PROXY owns only its stdio MCP connection to its OpenCode process and forwards tool calls to SERVER over local HTTP.

## No Extension Connected

Symptoms:

- MCP tool calls fail with `No extension connected. Open the ChromeUse side panel and click Connect, or keep a native host session running for fallback.`

Checks:

1. For WebSocket, open the side panel and click **Connect** after the MCP client has started the server.
2. For native messaging fallback, confirm the native host manifest includes the current extension ID.
3. Reload the extension after rebuilding or reinstalling.
4. Restart the browser if Chrome has cached an old native messaging manifest.

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

If managed Chrome blocks native messaging, use the WebSocket Connect path when policy allows the extension to open `ws://127.0.0.1:8765`. Managed Chrome policy still controls the native messaging fallback path.

Gateway mode does not use native messaging fallback. If a managed browser blocks native messaging, configure OpenCode with `gateway/dist/index.js` and use the side panel Connect flow when WebSocket localhost connections are allowed.

## Managed Chrome Blocks Native Messaging

Symptoms:

- Native messaging works in an unmanaged Chromium browser but not in a managed Chrome profile.
- Chrome policy blocks or ignores the user-level native messaging manifest.
- Tool calls only work after using the side panel **Connect** button.

Checks:

1. Open `chrome://policy` and review native messaging policies for the managed profile.
2. Ask your administrator to allow the `com.chromeuse.mcp_bridge` native messaging host if the native path is required.
3. Confirm the extension ID in policy or the manifest matches the ID shown in `chrome://extensions`.

Managed Chrome policy applies to native messaging. The side panel **Connect** button uses a localhost WebSocket path instead, but it still requires the MCP server process to be running locally and does not grant native messaging access.

## Workspace Folder Access Is Lost

Symptoms:

- The workspace tree disappears or shows a permission error.
- Workspace MCP tools report that no workspace is selected or permission was denied.
- A previously selected folder no longer opens after browser restart, profile change, extension reload, or policy change.

Fix:

1. Open the ChromeUse side panel.
2. Reselect the workspace folder when prompted.
3. If prompted by the browser, grant read access again.
4. Retry the workspace or markdown tool call.

Chrome grants File System Access handles through explicit user gestures. Stored handles can help restore a workspace, but Chrome may still require a fresh permission grant. Incognito profiles, cleared site/extension data, browser profile changes, and enterprise policies can all invalidate access.

## File System Access API Is Unsupported

Symptoms:

- The side panel cannot show a folder picker.
- Workspace features report that File System Access is unavailable.

Checks:

1. Use a Chromium browser that supports directory picking through the File System Access API.
2. Confirm the extension is running in a normal profile where extension pages can use the API.
3. Try an unmanaged Chrome/Chromium profile if a managed browser disables the API.

Workspace features are browser-only in this foundation phase. If the browser cannot grant directory handles, ChromeUse cannot read arbitrary local folders until a future local companion mode exists.

## Enterprise Policy Blocks Workspace Access

Symptoms:

- Folder selection or restored handles work in an unmanaged browser but fail in a managed Chrome profile.
- Workspace tools consistently report denied access even after reselecting the folder.

Checks:

1. Open `chrome://policy` and review policies related to File System Access, extensions, native messaging, and local file access.
2. Ask your administrator whether extension pages are allowed to use File System Access.
3. Use an unmanaged Chromium browser for local workspace workflows when policy permits.

Enterprise policy can block native messaging, localhost WebSocket connections, extension installation, or browser file APIs independently. The side panel cannot bypass those policies.

## Workspace File Is Too Large or Binary

Symptoms:

- Opening a workspace file shows a large-file, binary-file, or unsupported-file placeholder.
- `markdown_render` or workspace read tools refuse to return content.

Explanation:

The browser extension foundation is optimized for text-like files and markdown previews. Large files, binary files, PDFs, Office documents, archives, media, and unknown formats may be intentionally blocked or routed to placeholder shells to avoid freezing the side panel or returning unusable binary data.

Fix:

1. Open smaller text or markdown files from the workspace.
2. Use external tools for heavyweight PDF, Office, archive, image, audio, or video processing.
3. Watch for future local companion support for conversion, indexing, and binary document handling.

## Wrong Extension ID Registered

The extension ID can change if you load a different extension directory or browser profile.

Fix:

```sh
./scripts/install.sh --extension-id=<current-extension-id>
```

Then reload the extension and restart the MCP client.

## MCP Client Config Uses a Relative Path

Use an absolute path to the built server file. For OpenCode gateway mode, point to `gateway/dist/index.js`:

```json
{
  "mcpServers": {
    "chromeuse": {
      "command": "node",
      "args": ["/absolute/path/to/chromeuse-mcp/gateway/dist/index.js"]
    }
  }
}
```

After editing MCP client config, restart the client.

Use `mcp-server/dist/index.js` instead only when you need the direct native messaging fallback path.

## Build Output Is Missing

Symptoms:

- `mcp-server/dist/index.js` does not exist.
- `gateway/dist/index.js` does not exist.
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
