/**
 * Tool argument types for the MCP server tool schemas.
 *
 * These define the expected input parameters for each tool that the
 * Chrome extension implements. The MCP server validates incoming
 * arguments against these schemas before forwarding to the native host.
 */

// ---------------------------------------------------------------------------
// Computer tool
// ---------------------------------------------------------------------------

export type ComputerAction =
  | "screenshot"
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "key"
  | "scroll"
  | "drag"
  | "move";

export interface ComputerArgs {
  readonly action: ComputerAction;
  /** [x, y] coordinates in screenshot space */
  readonly coordinate?: readonly [number, number];
  /** Text to type (for "type" action) */
  readonly text?: string;
  /** Key name or combo like "Enter", "ctrl+a" (for "key" action) */
  readonly key?: string;
  /** Scroll direction (for "scroll" action) */
  readonly scroll_direction?: "up" | "down" | "left" | "right";
  /** Scroll distance in pixels (for "scroll" action) */
  readonly scroll_amount?: number;
  /** Start coordinate for "drag" action */
  readonly start_coordinate?: readonly [number, number];
  /** End coordinate for "drag" action */
  readonly end_coordinate?: readonly [number, number];
}

// ---------------------------------------------------------------------------
// Navigate tool
// ---------------------------------------------------------------------------

export interface NavigateArgs {
  readonly action: "goto" | "back" | "forward" | "reload";
  /** URL to navigate to (required for "goto" action) */
  readonly url?: string;
  /** Target tab ID (optional, defaults to active tab) */
  readonly tabId?: number;
}

// ---------------------------------------------------------------------------
// Read page tool
// ---------------------------------------------------------------------------

export interface ReadPageArgs {
  /** Output format */
  readonly format?: "a11y_tree" | "html" | "text";
}

// ---------------------------------------------------------------------------
// Find tool
// ---------------------------------------------------------------------------

export interface FindArgs {
  /** Natural language description of the element to find */
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Form input tool
// ---------------------------------------------------------------------------

export interface FormInputArgs {
  /** Element reference from accessibility tree */
  readonly ref: string;
  /** Value to set */
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Get page text tool
// ---------------------------------------------------------------------------

export type GetPageTextArgs = Record<string, never>;

// ---------------------------------------------------------------------------
// JavaScript tool
// ---------------------------------------------------------------------------

export interface JavaScriptArgs {
  /** JavaScript code to execute in the page context */
  readonly code: string;
}

// ---------------------------------------------------------------------------
// File upload tool
// ---------------------------------------------------------------------------

export interface FileUploadArgs {
  /** Element reference for the file input */
  readonly ref: string;
  /** Path to the file to upload */
  readonly filePath: string;
}

// ---------------------------------------------------------------------------
// Console messages tool
// ---------------------------------------------------------------------------

export interface ReadConsoleArgs {
  /** Maximum number of messages to return */
  readonly limit?: number;
  /** Filter by message type */
  readonly filter?: "log" | "warn" | "error" | "info";
}

// ---------------------------------------------------------------------------
// Network requests tool
// ---------------------------------------------------------------------------

export interface ReadNetworkArgs {
  /** Maximum number of requests to return */
  readonly limit?: number;
  /** URL substring filter */
  readonly filter?: string;
}

// ---------------------------------------------------------------------------
// Resize window tool
// ---------------------------------------------------------------------------

export interface ResizeWindowArgs {
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Tabs context tool
// ---------------------------------------------------------------------------

export type TabsContextArgs = Record<string, never>;

// ---------------------------------------------------------------------------
// Tabs create tool
// ---------------------------------------------------------------------------

export interface TabsCreateArgs {
  readonly url: string;
  readonly active?: boolean;
}

// ---------------------------------------------------------------------------
// Tabs close tool
// ---------------------------------------------------------------------------

export interface TabsCloseArgs {
  readonly tabId: number;
}

// ---------------------------------------------------------------------------
// GIF creator tool
// ---------------------------------------------------------------------------

export interface GifCreatorArgs {
  readonly action: "start" | "screenshot" | "stop";
}

// ---------------------------------------------------------------------------
// Union of all tool args
// ---------------------------------------------------------------------------

export type ToolArgs =
  | ComputerArgs
  | NavigateArgs
  | ReadPageArgs
  | FindArgs
  | FormInputArgs
  | GetPageTextArgs
  | JavaScriptArgs
  | FileUploadArgs
  | ReadConsoleArgs
  | ReadNetworkArgs
  | ResizeWindowArgs
  | TabsContextArgs
  | TabsCreateArgs
  | TabsCloseArgs
  | GifCreatorArgs;
