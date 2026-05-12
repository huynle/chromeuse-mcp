# Architecture

ChromeUse MCP is split into four workspaces plus helper scripts. The separation keeps browser-specific code in the extension, local WebSocket and MCP protocol handling in the MCP server, optional native messaging integration in the native host, and shared wire types in one package.

## Components

### `mcp-server`

The MCP server is a Node.js stdio server. It registers the tool schemas exposed to MCP clients and forwards tool calls through a WebSocket-first browser transport. The preferred path is a localhost WebSocket bridge for extensions that click Connect in the side panel; native messaging remains available as fallback through a local Unix domain socket.

Key files:

- `mcp-server/src/index.ts`: stdio entry point.
- `mcp-server/src/server.ts`: MCP server factory and tool schemas.
- `mcp-server/src/webSocketBridge.ts`: localhost WebSocket bridge for side panel Connect sessions.
- `mcp-server/src/socketClient.ts`: native host socket discovery and request forwarding.

### `native-host`

The native host is launched by Chromium through Native Messaging when the fallback path is used. It bridges Chrome's stdin/stdout native messaging channel to a Unix socket used by the MCP server.

Key files:

- `native-host/src/index.ts`: native host runtime entry point.
- `native-host/src/socketServer.ts`: Unix socket server for MCP server requests.
- `native-host/src/chromeNativeHost.ts`: Chrome native messaging integration.
- `native-host/src/install.ts`: native messaging manifest installer.

The installer writes `com.chromeuse.mcp_bridge.json` manifests into supported browser profile config directories and creates a wrapper script at `~/.chromeuse/native-host`.

### `extension`

The extension is a Manifest V3 Chromium extension. Its service worker receives tool requests from either the localhost WebSocket connection or the native host and executes them using Chrome extension APIs, Chrome DevTools Protocol, injected content scripts, and an offscreen document.

Key files:

- `extension/src/service-worker/index.ts`: service worker startup.
- `extension/src/service-worker/messageRouter.ts`: tool request routing.
- `extension/src/service-worker/webSocketConnection.ts`: WebSocket client used by the side panel Connect flow.
- `extension/src/service-worker/tools/`: individual tool handlers.
- `extension/src/service-worker/cdp.ts`: Chrome DevTools Protocol helpers.
- `extension/src/content-scripts/accessibilityTree.ts`: accessibility extraction and element refs.
- `extension/src/content-scripts/visualIndicator.ts`: automation indicator and stop control.
- `extension/src/offscreen/`: GIF capture and encoding.
- `extension/src/sidepanel/`: side panel status and history UI.

### `shared`

The shared package defines cross-component constants, message shapes, and length-prefixed JSON helpers.

Key files:

- `shared/src/tools.ts`: tool name constants.
- `shared/src/messages.ts`: message contracts.
- `shared/src/lengthPrefixed.ts`: length-prefixed JSON codec.

## Request Flow

```text
MCP client
    |  MCP protocol over stdio
    v
mcp-server
    |\
    | \  preferred: ws://127.0.0.1:8765
    |  +-------------------------------> Chrome extension
    |
    |  fallback: Unix socket
    v
native-host
    |  Chrome Native Messaging
    v
Chrome extension
```

### WebSocket Connect Path

1. An MCP client starts `node mcp-server/dist/index.js` as a stdio process.
2. The MCP server starts a WebSocket bridge on `127.0.0.1:8765`, or on `CHROMEUSE_WS_PORT` when that environment variable is set.
3. The user opens the ChromeUse side panel and clicks **Connect**.
4. The extension service worker opens `ws://127.0.0.1:8765` and keeps reconnecting while Connect remains active.
5. Tool calls flow from the MCP client to the MCP server, over WebSocket to the extension, and back through the same path.

The Connect button only attaches the extension to the MCP server's localhost WebSocket bridge. It does not bypass native messaging policy for the native host path, and it cannot work unless the MCP server process is already running.

### Native Messaging Fallback Path

1. An MCP client starts `node mcp-server/dist/index.js` as a stdio process.
2. The MCP client calls a ChromeUse MCP tool.
3. The MCP server validates the tool name and uses native messaging when no WebSocket extension is connected.
4. The native host receives the length-prefixed JSON request and forwards it to the extension through Chrome Native Messaging.
5. The service worker dispatches the request to the relevant tool handler.
6. The handler uses Chrome APIs, CDP, content scripts, or the offscreen document to execute the action.
7. The result returns through the same path to the MCP client.

## Native Messaging Registration

Chromium only allows native messaging from explicitly listed extension origins. The installer supports this by accepting one or more extension IDs:

```sh
./scripts/install.sh --extension-id=<id>
```

The generated native messaging manifest contains:

- `name`: `com.chromeuse.mcp_bridge`
- `path`: wrapper script path
- `type`: `stdio`
- `allowed_origins`: `chrome-extension://<id>/` values

## Build Order

`scripts/build.sh` builds packages in dependency order:

1. `shared`
2. `native-host`
3. `extension`
4. `mcp-server`

The extension build uses esbuild. The TypeScript packages use `tsc`.

## Security Boundaries

ChromeUse MCP is designed for trusted local automation. The meaningful safety boundaries are:

- Chrome's native messaging `allowed_origins` list limits which extension IDs can launch the host.
- The WebSocket bridge binds to `127.0.0.1` and is intended for local MCP clients only.
- MCP clients connect over stdio; the only network listener is the localhost WebSocket bridge used by the extension Connect flow.
- The native host socket is local to the machine.
- Most browser actions require explicit `tabId` targeting.

These boundaries do not make untrusted MCP clients safe. A trusted client can still read browser content, click authenticated pages, type text, upload specified files, and execute JavaScript in tabs.
