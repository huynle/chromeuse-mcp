# opencode-chrome

A Chrome extension that exposes browser automation as [MCP](https://modelcontextprotocol.io) tools, enabling AI coding assistants like [OpenCode](https://opencode.ai) to directly control a real Chrome browser.

## What it does

OpenCode (or any MCP client) can take screenshots, click, type, navigate, read page content, monitor console/network traffic, record GIFs, and more — all through structured MCP tool calls against a live Chrome session.

## Architecture

```
OpenCode (AI)
    │  MCP protocol (stdio)
    ▼
mcp-server          — stdio MCP server exposing 15 browser tools
    │  length-prefixed JSON over Unix domain socket
    ▼
native-host         — Node.js process launched by Chrome via Native Messaging
    │  Chrome Native Messaging (stdin/stdout)
    ▼
Chrome Extension    — service worker dispatches tool calls via Chrome APIs & CDP
    │
    ├── content scripts   — accessibility tree, ref-based targeting, visual indicator
    ├── side panel UI     — connection status and live tool history
    └── offscreen doc     — GIF encoder (pure-JS, no deps)
```

The MCP server connects to the native host over a Unix socket at `/tmp/opencode-browser-bridge-{user}/{pid}.sock`. The native host is launched automatically by Chrome when the extension first connects.

## Tools

| Tool | Description |
|------|-------------|
| `computer` | Screenshots, click, double-click, right-click, type, key combos, scroll, drag |
| `navigate` | Navigate to URL, go back/forward, reload |
| `read_page` | Page as accessibility tree (with `ref_N` IDs), plain text, or HTML |
| `find` | Natural language element search returning refs and bounding rects |
| `form_input` | Set form field values by ref (inputs, selects, checkboxes, contenteditable) |
| `get_page_text` | Extract all visible text from the page |
| `javascript_tool` | Execute arbitrary JS in page context via CDP |
| `file_upload` | Upload a file to a `<input type=file>` element by ref |
| `read_console_messages` | Read CDP-captured console messages |
| `read_network_requests` | Read CDP-captured network requests |
| `resize_window` | Resize the browser window |
| `tabs_context` | List all open tabs and tab groups |
| `tabs_create` | Open a new tab |
| `tabs_close` | Close a tab by ID |
| `gif_creator` | Record browser actions as an animated GIF (start → screenshot → stop) |

## Requirements

- Node.js ≥ 20.0.0
- macOS or Linux
- Chrome, Brave, Arc, Edge, Chromium, Vivaldi, or Opera

## Installation

### 1. Clone and install

```sh
git clone https://github.com/YOUR_USERNAME/opencode-chrome.git
cd opencode-chrome
./scripts/install.sh
```

This installs npm dependencies, builds all packages, installs the native messaging host manifests, and prints instructions for loading the extension.

### 2. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` directory
5. Copy the **Extension ID** shown on the card

### 3. Register the extension ID

```sh
./scripts/install.sh --extension-id=<your-extension-id>
```

This registers the ID in the native messaging manifest so Chrome allows the extension to communicate with the native host. You only need to do this once (or whenever the ID changes).

### 4. Configure OpenCode

Add to your OpenCode config (or any MCP client):

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["/path/to/opencode-chrome/mcp-server/dist/index.js"]
    }
  }
}
```

## Development

```sh
./scripts/dev.sh
```

Builds `shared`, `native-host`, and `mcp-server` once, then runs the extension's esbuild in watch mode. After changing extension code, click the reload button in `chrome://extensions`. After changing `shared` or `native-host`, re-run the script.

### Build

```sh
./scripts/build.sh
# or
npm run build
```

Build outputs:
- `shared/dist/` — wire protocol types and codec
- `native-host/dist/` — `index.js` (host binary), `install.js` (manifest installer)
- `extension/dist/` — bundled service worker, content scripts, offscreen, side panel
- `mcp-server/dist/` — `index.js` (stdio MCP server)

### Test

```sh
npm test
```

Each package uses [Vitest](https://vitest.dev).

## Project structure

```
opencode-chrome/
├── shared/          # Wire protocol types, codec, tool name constants
├── extension/       # Chrome MV3 extension
│   ├── src/
│   │   ├── service-worker/   # Background service worker + tool handlers
│   │   ├── content-scripts/  # Accessibility tree, visual indicator
│   │   └── offscreen/        # GIF encoder
│   ├── sidepanel.html        # Side panel UI
│   └── manifest.json
├── native-host/     # Chrome Native Messaging host (bridges extension ↔ socket)
├── mcp-server/      # MCP stdio server (bridges OpenCode ↔ socket)
└── scripts/         # Build, install, and dev scripts
```

## Distributing to another machine

This extension requires the native host to be installed on every machine. To set up on a new machine:

1. Clone the repo
2. Run `./scripts/install.sh`
3. Load the unpacked extension in Chrome
4. Re-run `./scripts/install.sh --extension-id=<id>`

See [Chrome Web Store distribution](https://developer.chrome.com/docs/extensions/how-to/distribute/publish-to-chrome-webstore) if you want to publish publicly. Note that users would still need to run the native host installer separately, as the store only distributes the extension JS.

## License

MIT
