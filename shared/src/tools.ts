/**
 * Tool name constants and types for ChromeUse MCP.
 *
 * These must match the tool schemas registered in the MCP server
 * and the tool handlers in the Chrome extension service worker.
 */

/** All tool names exposed through the MCP server */
export const TOOL_NAMES = {
  /** Take screenshots, click, type, scroll, drag in the browser */
  COMPUTER: "computer",
  /** Navigate to a URL, go back/forward, or reload */
  NAVIGATE: "navigate",
  /** Read the current page as an accessibility tree */
  READ_PAGE: "read_page",
  /** Find an element on the page using natural language description */
  FIND: "find",
  /** Set form field values by element reference */
  FORM_INPUT: "form_input",
  /** Extract all text content from the current page */
  GET_PAGE_TEXT: "get_page_text",
  /** Execute JavaScript in the page context */
  JAVASCRIPT: "javascript_tool",
  /** Upload a file to a file input element */
  FILE_UPLOAD: "file_upload",
  /** Read browser console messages */
  READ_CONSOLE: "read_console_messages",
  /** Read captured network requests */
  READ_NETWORK: "read_network_requests",
  /** Resize the browser window */
  RESIZE_WINDOW: "resize_window",
  /** Get information about open tabs and tab groups */
  TABS_CONTEXT: "tabs_context",
  /** Create a new tab */
  TABS_CREATE: "tabs_create",
  /** Close a tab by ID */
  TABS_CLOSE: "tabs_close",
  /** Record browser actions as a GIF */
  GIF_CREATOR: "gif_creator",
  /** Render markdown text or accessible workspace file content */
  MARKDOWN_RENDER: "markdown_render",
  /** List files and directories in the selected workspace */
  WORKSPACE_LIST_FILES: "workspace_list_files",
  /** Read text content from a file in the selected workspace */
  WORKSPACE_READ_FILE: "workspace_read_file",
  /** Write a file to the selected workspace using FileSystem Access API */
  WORKSPACE_WRITE_FILE: "workspace_write_file",
  /** Check health and connectivity of ChromeUse MCP server */
  HEALTH_CHECK: "health_check",
  /** Save a resource from a URL to local filesystem */
  SAVE_RESOURCE: "save_resource",
  /** Wait until a page condition holds (selector, text, network idle, console) */
  WAIT_FOR: "wait_for",
  /** Mock or block network requests via the CDP Fetch domain */
  NETWORK_INTERCEPT: "network_intercept",
  /** Inspect and mutate browser cookies */
  COOKIES: "cookies",
  /** Read/write a tab's localStorage or sessionStorage */
  STORAGE: "storage",
  /** Emulate device metrics, geolocation, color scheme, and network/CPU throttling */
  EMULATE: "emulate",
  /** Capture load timings, Core Web Vitals, and runtime metrics */
  PERFORMANCE_METRICS: "performance_metrics",
  /** Screenshot a single element by CSS selector */
  SCREENSHOT_ELEMENT: "screenshot_element",
  /** Render the page to PDF and save it */
  PRINT_TO_PDF: "print_to_pdf",
  /** Extract a table or repeated list into structured JSON */
  EXTRACT_STRUCTURED: "extract_structured",
  /** Save and restore named sets of tabs */
  TAB_SESSION: "tab_session",
  /** Search browsing history */
  HISTORY_SEARCH: "history_search",
  /** Search, list, and create bookmarks */
  BOOKMARKS: "bookmarks",
  /** Measure JavaScript and CSS coverage (unused code) */
  COVERAGE: "coverage",
  /** Run an axe-core accessibility audit and return WCAG violations */
  ACCESSIBILITY_AUDIT: "accessibility_audit",
} as const;

/** Union type of all valid tool name strings */
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Array of all tool names for iteration / validation */
export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);

/**
 * Result of a tool execution, returned by the extension to the native host.
 */
export interface ToolResult {
  readonly success: boolean;
  readonly content: readonly import("./messages.js").ContentBlock[];
}

/**
 * Context provided to tool handlers during execution.
 */
export interface ToolContext {
  readonly sessionScope?: string;
}
