# ChromeUse MCP

ChromeUse MCP gives AI assistants and other MCP clients direct, structured control of a real Chromium browser.

It combines a Chrome extension, a local native messaging host, and a stdio MCP server so tools can inspect pages, click elements, fill forms, capture screenshots, monitor console and network activity, run page JavaScript, manage tabs, and record GIFs from the browser you actually use.

## Why Use It

- Automate real browser workflows from any [Model Context Protocol](https://modelcontextprotocol.io) client.
- Test web apps in an actual Chromium session instead of a synthetic browser environment.
- Target elements by `ref` from the accessibility tree, by natural-language search, or by screenshot coordinates.
- Debug frontend behavior with console logs, network requests, screenshots, page text, and JavaScript evaluation.
- Keep multiple agents safer by requiring explicit `tabId` targeting for most tab-scoped tools.
- See connection status and recent tool activity in the extension side panel.

## Feature Overview

ChromeUse MCP exposes 15 MCP tools:

| Category | Tools | What You Can Do |
| --- | --- | --- |
| Browser control | `computer`, `navigate`, `resize_window` | Take screenshots, click, type, press keys, scroll, drag, move the pointer, navigate, reload, go back/forward, and resize windows. |
| Page understanding | `read_page`, `get_page_text`, `find` | Read accessibility trees, HTML, text, visible page text, and find elements by human-readable descriptions. |
| Form and file workflows | `form_input`, `file_upload` | Fill inputs, selects, checkboxes, radio buttons, contenteditable fields, and file inputs. |
| Debugging | `javascript_tool`, `read_console_messages`, `read_network_requests` | Run JavaScript through Chrome DevTools Protocol and inspect captured console/network activity. |
| Tab management | `tabs_context`, `tabs_create`, `tabs_close` | List tabs and tab groups, create tabs, and close one or more tabs by ID. |
| Recording | `gif_creator` | Capture browser workflows as animated GIFs. |

See [`docs/TOOLS.md`](docs/TOOLS.md) for detailed tool inputs, targeting rules, and example workflows.

## How It Works

```text
MCP client
    |  MCP protocol over stdio
    v
mcp-server
    |  length-prefixed JSON over Unix domain socket
    v
native-host
    |  Chrome Native Messaging over stdin/stdout
    v
Chrome extension
    |
    +-- service worker: tool dispatch, CDP, tabs, native messaging
    +-- content scripts: accessibility refs and automation indicator
    +-- side panel: connection status and tool history
    +-- offscreen document: GIF encoding
```

The extension asks Chrome to launch the native host. The native host opens a Unix socket at `/tmp/chromeuse-browser-bridge-{user}/{pid}.sock`. The MCP server connects to that socket when a client makes a tool call, then forwards requests to the extension.

For more implementation detail, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements

- Node.js 20 or newer
- macOS or Linux
- A Chromium-based browser: Chrome, Brave, Arc, Edge, Chromium, Vivaldi, or Opera
- An MCP client that can run a local stdio server

Windows is not currently supported because the native host and MCP server communicate over Unix domain sockets.

## Quick Start

### 1. Clone and Install

```sh
git clone https://github.com/huynle/chromeuse-mcp.git
cd chromeuse-mcp
./scripts/install.sh
```

The installer:

- Installs npm workspace dependencies.
- Builds `shared`, `native-host`, `extension`, and `mcp-server`.
- Installs native messaging host manifests for supported Chromium browsers.
- Prints the extension loading instructions.

### 2. Load the Extension

1. Open `chrome://extensions` in your Chromium browser.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repository.
5. Copy the extension ID shown on the extension card.

### 3. Register Your Extension ID

Chrome native messaging requires each extension ID to be explicitly allowed. Re-run the installer with the ID from `chrome://extensions`:

```sh
./scripts/install.sh --extension-id=<your-extension-id>
```

You can register multiple IDs in one run:

```sh
./scripts/install.sh --extension-id=<id-1> --extension-id=<id-2>
```

Or use an environment variable:

```sh
CHROMEUSE_EXTENSION_IDS=<id-1>,<id-2> ./scripts/install.sh
```

### 4. Configure Your MCP Client

Add ChromeUse MCP as a stdio server. Use an absolute path to `mcp-server/dist/index.js`.

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

Restart your MCP client after changing its config.

### 5. Verify the Connection

1. Open a normal web page in the browser where the extension is loaded.
2. Open the ChromeUse MCP side panel from the extension toolbar.
3. Ask your MCP client to call `tabs_context`.
4. Use one returned `tabId` with `read_page` or `computer` screenshot.

If the server cannot connect, see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Typical Workflows

### Inspect and Click an Element

1. Call `tabs_context` to get the target `tabId`.
2. Call `read_page` with `format: "accessibility"`.
3. Use a returned `ref_N` with `computer` action `click`, or call `find` with a natural-language query and click the returned ref.

### Fill a Form

1. Call `read_page` or `find` to locate form fields.
2. Use `form_input` with each field `ref` and desired value.
3. Use `computer` with a submit button `ref`, or press `Enter` with `computer` action `key`.

### Debug a Web App

1. Call `read_console_messages` to inspect browser logs.
2. Call `read_network_requests` to inspect recent requests.
3. Call `javascript_tool` for targeted page-state inspection.
4. Capture screenshots with `computer` to verify visual state.

### Record a GIF

1. Call `gif_creator` with `action: "start"` and a `tabId`.
2. Perform browser actions.
3. Call `gif_creator` with `action: "screenshot"` when you want to capture a frame.
4. Call `gif_creator` with `action: "stop"` to generate the GIF.

## Development

Run the development watcher:

```sh
./scripts/dev.sh
```

This builds `shared`, `native-host`, and `mcp-server` once, then starts the extension build in watch mode. After extension source changes, reload the unpacked extension in `chrome://extensions`. After changes to `shared` or `native-host`, re-run the script.

Build everything:

```sh
./scripts/build.sh
```

Run tests:

```sh
npm test
```

Clean generated output:

```sh
npm run clean
```

## Project Structure

```text
chromeuse-mcp/
├── shared/          # Wire protocol types, codecs, and tool name constants
├── extension/       # Chrome MV3 extension
│   ├── src/
│   │   ├── service-worker/   # Tool handlers, CDP, tab management, bridge logic
│   │   ├── content-scripts/  # Accessibility tree, refs, visual indicator
│   │   ├── offscreen/        # GIF encoder
│   │   └── sidepanel/        # Side panel UI
│   ├── sidepanel.html
│   └── manifest.json
├── native-host/     # Chrome Native Messaging host and manifest installer
├── mcp-server/      # MCP stdio server that bridges clients to the native host
├── scripts/         # Install, build, and development scripts
└── docs/            # User and maintainer documentation
```

## Security Notes

ChromeUse MCP intentionally gives local MCP clients powerful browser automation capabilities. Treat it like a local development tool, not a sandbox.

- Only configure MCP clients you trust.
- Tool calls can read page content, click buttons, type text, upload local files you specify, and execute JavaScript in pages.
- The extension requests broad host permissions because it is designed to automate arbitrary pages.
- Native messaging only allows registered extension IDs through Chrome's `allowed_origins` manifest field.
- The MCP server communicates locally over stdio and a Unix socket; it does not expose an HTTP server.

See [`SECURITY.md`](SECURITY.md) for reporting vulnerabilities and recommended safe usage.

## Troubleshooting

Common issues are documented in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md), including native host registration, extension IDs, browser reloads, and MCP client configuration.

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening issues or pull requests.

## License

MIT. See [`LICENSE`](LICENSE).
