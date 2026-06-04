# ChromeUse MCP Roadmap

This roadmap tracks new browser-automation capabilities being added to ChromeUse
MCP to make the extension more effective for **software development**,
**day-to-day automation**, and **general browser control**.

All items build on infrastructure that already exists in the extension:

- **Chrome DevTools Protocol (CDP)** access via `cdpManager` (`Page`, `Network`,
  `DOM`, `Runtime`, `Input`, `Emulation`, `Fetch`, `Performance`, ... domains).
- **Content scripts** for in-page work (accessibility tree, renderers, indicators).
- **Workspace File System Access** for reading/writing user-selected folders.
- **A generic MCP server** that forwards any registered tool to the extension,
  so adding a tool means: name (`shared/src/tools.ts`) + schema
  (`mcp-server/src/server.ts`) + handler (`extension/src/service-worker/tools/`)
  + registration (`tools/index.ts`) + tests.

Status legend: ✅ done · 🚧 in progress · ⏳ planned · 🔭 future (larger effort)

---

## Phase 1 — Synchronization primitives

Reliable multi-step automation needs to *wait for conditions* instead of
snapshotting. This is the highest-leverage addition: it makes every other
flow deterministic.

| Tool | Status | What it does |
| --- | --- | --- |
| `wait_for` | ✅ | Wait until a condition holds: CSS selector visible/hidden, page text present, network idle, a console message matches a pattern, or a fixed timeout. CDP-based, with an overall timeout and clear timeout errors. |

**Effort:** M · **Permissions:** none new.

---

## Phase 2 — Network interception & mocking

The existing network tools are read-only. Write-side control unlocks frontend
debugging: mock API responses, force error states, and block noisy requests.

| Tool | Status | What it does |
| --- | --- | --- |
| `network_intercept` | ✅ | Manage interception rules via the CDP `Fetch` domain: `mock` (return a canned status/body), `block` (fail matching requests), `list`, and `clear`. Rules match by URL substring/glob and optional method. |

**Effort:** M–L · **Permissions:** none new (CDP via debugger).

---

## Phase 3 — Cookies & storage

Inspect and mutate browser state for auth flows, logged-in/out testing, and
clean state between automation runs.

| Tool | Status | What it does |
| --- | --- | --- |
| `cookies` | ✅ | `get` / `set` / `delete` / `clear` cookies for a URL or domain (`chrome.cookies`). Useful for exporting an authenticated session or resetting state. |
| `storage` | ✅ | `get` / `set` / `remove` / `clear` `localStorage` and `sessionStorage` entries for a tab (via `Runtime.evaluate`). |

**Effort:** M · **Permissions:** `cookies` (storage needs none).

---

## Phase 4 — Device & condition emulation

Turn `resize_window` into real responsive / edge-case testing.

| Tool | Status | What it does |
| --- | --- | --- |
| `emulate` | ⏳ | Emulate device metrics + touch, user-agent override, geolocation, `prefers-color-scheme` (dark/light), and network/CPU throttling (offline, slow-3G). `reset` clears overrides. CDP `Emulation` + `Network.emulateNetworkConditions`. |

**Effort:** M · **Permissions:** none new.

---

## Phase 5 — Developer tools

| Tool | Status | What it does |
| --- | --- | --- |
| `performance_metrics` | ⏳ | Capture load timings + Core Web Vitals (LCP/CLS/FCP/TTFB) and key resource stats for a tab. CDP `Performance` + in-page Performance APIs. |
| `screenshot_element` | ⏳ | Screenshot a single element by selector (CDP `clip`), instead of the whole viewport — ideal for capturing one chart/component. |
| `print_to_pdf` | ⏳ | Render the page to PDF (`Page.printToPDF`) and save it to the workspace or Downloads. |
| `extract_structured` | ⏳ | Extract a table or repeated list into structured JSON (and optionally save as JSON/CSV to the workspace). |

**Effort:** S–M each · **Permissions:** none new.

---

## Phase 6 — Day-to-day automation

| Tool | Status | What it does |
| --- | --- | --- |
| `tab_session` | ⏳ | `save` the current window's tabs/groups as a named session and `restore` / `list` / `delete` later. Stored in `chrome.storage.local`. |
| `history_search` | ⏳ | Search browsing history by text/time (`chrome.history`) — "find the article I read last week." |
| `bookmarks` | ⏳ | Search / list / create bookmarks (`chrome.bookmarks`). |

**Effort:** S–M each · **Permissions:** `history`, `bookmarks`.

---

## Future (larger efforts, not yet scheduled)

- 🔭 **Interaction recorder → replayable macro.** Capture real user
  clicks/typing/navigations via a content script into a workspace script that
  can be replayed or scheduled. Needs in-page recording UI and a robust
  selector-generation strategy.
- 🔭 **Scheduled automations.** Run a saved tool sequence on a cron-like
  schedule (`chrome.alarms`), surfacing results in the side panel.
- 🔭 **Accessibility audit (axe-core).** Inject `axe-core` and return WCAG
  violations. Heavier because it bundles a large library.
- 🔭 **JS/CSS coverage.** Report unused JavaScript/CSS via CDP coverage APIs.
- 🔭 **Source-level debugging.** Set breakpoints and inspect scopes via the
  CDP `Debugger` domain.
- 🔭 **Clipboard read/write.** Cross-app glue; reliable clipboard access from an
  MV3 worker requires an offscreen document and user-gesture handling.

---

## Permissions summary

New manifest permissions introduced by this roadmap:

| Permission | Needed by |
| --- | --- |
| `cookies` | `cookies` |
| `history` | `history_search` |
| `bookmarks` | `bookmarks` |

Each is requested only for the feature that needs it, to keep the Web Store
review story clean.
