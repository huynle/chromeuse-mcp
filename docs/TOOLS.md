# Tool Reference

ChromeUse MCP exposes these tools through the MCP server. Most page-level tools require a `tabId` so agents do not accidentally operate on the wrong browser tab.

Start most workflows with `tabs_context`, then pass the returned `tabId` to follow-up tools.

## Targeting Model

- `tabs_context` has no inputs and returns open tabs, URLs, titles, and tab group details.
- Most tools require `tabId`.
- `navigate` accepts an optional `tabId`; if omitted, it uses the active tab in the current window.
- `tabs_create` creates a new tab and accepts `active` to control whether it is foregrounded.
- `tabs_close` accepts either `tabId` or `tabIds`.
- `read_page` and `find` can return `ref_N` element references for ref-based actions.
- `computer` coordinates use screenshot pixel space when using coordinate actions.

## Tools

### `tabs_context`

Lists all open tabs and tab groups.

Inputs: none.

Use it to discover tab IDs before calling tab-scoped tools.

### `tabs_create`

Creates a new browser tab.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | URL to open. |
| `active` | boolean | no | Whether to make the new tab active. Defaults to `true`. |

### `tabs_close`

Closes one or more browser tabs.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | no | Single tab ID to close. |
| `tabIds` | number[] | no | Multiple tab IDs to close. Takes precedence over `tabId`. |

### `navigate`

Navigates a tab, goes back/forward, or reloads.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `goto`, `back`, `forward`, `reload` | yes | Navigation action. |
| `url` | string | for `goto` | Destination URL. |
| `tabId` | number | no | Target tab ID. Defaults to the active tab. |

### `computer`

Performs low-level browser interactions and captures screenshots.

Actions:

| Action | Description |
| --- | --- |
| `screenshot` | Capture a screenshot of the target tab. |
| `click` | Left-click by coordinates or `ref`. |
| `double_click` | Double-click by coordinates or `ref`. |
| `right_click` | Right-click by coordinates or `ref`. |
| `type` | Type text into the focused element. |
| `key` | Press a key or shortcut such as `Enter` or `ctrl+a`. |
| `scroll` | Scroll in a direction by a pixel amount. |
| `drag` | Drag from one coordinate to another. |
| `move` | Move the pointer. |

Common inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | string | yes | One of the supported actions. |
| `tabId` | number | yes | Target tab ID. |
| `x`, `y` | number | action-dependent | Coordinates in screenshot pixel space. |
| `ref` | string | action-dependent | Element reference from `read_page` or `find`. |
| `text` | string | for `type` | Text to type. |
| `key` | string | for `key` | Key name or shortcut. |
| `direction` | `up`, `down`, `left`, `right` | for `scroll` | Scroll direction. |
| `amount` | number | for `scroll` | Scroll distance in pixels. |
| `startX`, `startY`, `endX`, `endY` | number | for `drag` | Drag coordinates. |

### `read_page`

Reads page content.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `format` | `accessibility`, `html`, `text` | no | Output format. Defaults to `accessibility`. |

The accessibility format includes `ref_N` references for many page elements. Use these refs with `computer`, `find`, and `form_input` where supported.

### `find`

Searches for elements using a natural-language description.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `query` | string | yes | Description such as `email input` or `submit button`. |
| `maxResults` | number | no | Maximum matches to return. Defaults to 5. |

Returns element refs and bounding rectangles.

### `form_input`

Sets a form field value by ref.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `ref` | string | yes | Element reference such as `ref_42`. |
| `value` | string | yes | Value to set. |

Supports text inputs, textareas, selects, checkboxes, radio buttons, and contenteditable elements.

### `get_page_text`

Extracts visible page text without markup.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `maxLength` | number | no | Maximum characters to return. Defaults to 100000 and caps at 500000. |

### `javascript_tool`

Executes JavaScript in the page context through Chrome DevTools Protocol.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `code` | string | yes | JavaScript code to evaluate. |
| `awaitPromise` | boolean | no | Await Promise results. Defaults to `true`. |
| `timeout` | number | no | Evaluation timeout in milliseconds. Defaults to 30000. |

The result of the evaluated expression is returned when serializable.

### `file_upload`

Uploads files to a file input.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `selector` | string | yes | CSS selector for the file input. |
| `files` | string[] | yes | Absolute local file paths. |

### `read_console_messages`

Reads console messages captured through Chrome DevTools Protocol.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `clear` | boolean | no | Clear stored messages after returning them. Defaults to `false`. |
| `level` | `log`, `debug`, `info`, `warning`, `error` | no | Optional level filter. |
| `limit` | number | no | Maximum messages to return, newest first. Defaults to 100. |

### `read_network_requests`

Reads network requests captured through Chrome DevTools Protocol.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `clear` | boolean | no | Clear stored requests after returning them. Defaults to `false`. |
| `urlPattern` | string | no | Filter by URL substring. |
| `method` | string | no | Filter by HTTP method, case-insensitive. |
| `limit` | number | no | Maximum requests to return, newest first. Defaults to 100. |

### `resize_window`

Resizes the browser window containing the target tab.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tabId` | number | yes | Target tab ID. |
| `width` | number | yes | Window width in pixels. |
| `height` | number | yes | Window height in pixels. |

### `gif_creator`

Records browser actions as an animated GIF.

Inputs:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `start`, `screenshot`, `stop` | yes | Recording action. |
| `tabId` | number | yes | Target tab ID. |
| `delay` | number | no | Frame delay in centiseconds for `stop`. Defaults to 50. |

Use `start` before the workflow, `screenshot` whenever a frame should be captured, and `stop` to finish and return the GIF.

## Example Workflows

### Open a Page and Read It

1. Call `tabs_create` with `url: "https://example.com"`.
2. Call `tabs_context` and find the created tab ID.
3. Call `read_page` with `format: "accessibility"`.

### Find and Click a Button

1. Call `find` with `query: "submit button"`.
2. Use the returned `ref` with `computer` action `click`.

### Fill and Submit a Login Form

1. Call `find` for `email input` and `password input`.
2. Call `form_input` for each returned field ref.
3. Call `find` for `sign in button`.
4. Call `computer` action `click` on the returned button ref.

## Safety Guidance

- Confirm the target `tabId` before destructive actions.
- Use `read_page` or screenshots before clicking unfamiliar UI.
- Avoid running arbitrary JavaScript from untrusted sources.
- Be careful with authenticated pages, payment flows, admin dashboards, and production systems.
- Only use `file_upload` with files you explicitly intend to expose to the page.
