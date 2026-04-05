/**
 * resize_window tool - resizes a browser window to specified dimensions.
 *
 * Uses chrome.windows.update to set the window size for the tab's window.
 * Useful for testing responsive layouts at specific viewport sizes.
 * Un-maximizes the window first to ensure dimensions are applied.
 *
 * Args:
 *   tabId (number, required): The tab whose window should be resized.
 *   width (number, required): Desired window width in pixels.
 *   height (number, required): Desired window height in pixels.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum window dimensions (Chrome enforces minimums) */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

/** Maximum reasonable window dimensions */
const MAX_WIDTH = 7680;
const MAX_HEIGHT = 4320;

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export class ResizeTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // Validate tabId
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      // Validate width
      const width = typeof args.width === "number" ? args.width : undefined;
      if (width === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: width (number)" },
          ],
        };
      }

      // Validate height
      const height = typeof args.height === "number" ? args.height : undefined;
      if (height === undefined) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "Missing required argument: height (number)",
            },
          ],
        };
      }

      // Validate ranges
      if (width < MIN_WIDTH || width > MAX_WIDTH) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Width must be between ${MIN_WIDTH} and ${MAX_WIDTH} pixels, got ${width}`,
            },
          ],
        };
      }

      if (height < MIN_HEIGHT || height > MAX_HEIGHT) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Height must be between ${MIN_HEIGHT} and ${MAX_HEIGHT} pixels, got ${height}`,
            },
          ],
        };
      }

      // Get the tab to find its window
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return {
          success: false,
          content: [{ type: "text", text: `Tab ${tabId} not found` }],
        };
      }

      if (!tab.windowId) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Tab ${tabId} has no associated window`,
            },
          ],
        };
      }

      // Resize the window — set state to 'normal' first to un-maximize
      const updatedWindow = await chrome.windows.update(tab.windowId, {
        width,
        height,
        state: "normal",
      });

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tabId,
                windowId: tab.windowId,
                width: updatedWindow.width,
                height: updatedWindow.height,
                state: updatedWindow.state,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to resize window: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
