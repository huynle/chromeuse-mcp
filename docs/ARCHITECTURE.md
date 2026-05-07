# Architecture

ChromeUse MCP is split into four workspaces plus helper scripts. The separation keeps browser-specific code in the extension, local process integration in the native host, MCP protocol handling in the MCP server, and shared wire types in one package.

## Components

### `mcp-server`

The MCP server is a Node.js stdio server. It registers the tool schemas exposed to MCP clients and forwards tool calls to the native host over a local Unix domain socket.

Key files:

- `mcp-server/src/index.ts`: stdio entry point.
- `mcp-server/src/server.ts`: MCP server factory and tool schemas.
- `mcp-server/src/socketClient.ts`: native host socket discovery and request forwarding.

### `native-host`

The native host is launched by Chromium through Native Messaging. It bridges Chrome's stdin/stdout native messaging channel to a Unix socket used by the MCP server.

Key files:

- `native-host/src/index.ts`: native host runtime entry point.
- `native-host/src/socketServer.ts`: Unix socket server for MCP server requests.
- `native-host/src/chromeNativeHost.ts`: Chrome native messaging integration.
- `native-host/src/install.ts`: native messaging manifest installer.

The installer writes `com.chromeuse.mcp_bridge.json` manifests into supported browser profile config directories and creates a wrapper script at `~/.chromeuse/native-host`.

### `extension`

The extension is a Manifest V3 Chromium extension. Its service worker receives tool requests from the native host and executes them using Chrome extension APIs, Chrome DevTools Protocol, injected content scripts, and an offscreen document.

Key files:

- `extension/src/service-worker/index.ts`: service worker startup.
- `extension/src/service-worker/messageRouter.ts`: tool request routing.
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

1. An MCP client starts `node mcp-server/dist/index.js` as a stdio process.
2. The MCP client calls a ChromeUse MCP tool.
3. The MCP server validates the tool name and connects to the native host socket if needed.
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
- The MCP server uses stdio, not a network listener.
- The native host socket is local to the machine.
- Most browser actions require explicit `tabId` targeting.

These boundaries do not make untrusted MCP clients safe. A trusted client can still read browser content, click authenticated pages, type text, upload specified files, and execute JavaScript in tabs.
