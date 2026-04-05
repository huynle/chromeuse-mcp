/**
 * navigate tool — navigates a browser tab by URL, or goes back/forward/reload.
 * Waits for the page to finish loading before returning.
 *
 * Args:
 *   tabId (number, optional): The tab to navigate. Defaults to active tab.
 *   action (string, required): One of "goto", "back", "forward", "reload".
 *   url (string, conditionally required): URL to navigate to. Required when action is "goto".
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time to wait for page load in milliseconds */
const PAGE_LOAD_TIMEOUT_MS = 30_000;

type NavigateAction = "goto" | "back" | "forward" | "reload";

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "goto",
  "back",
  "forward",
  "reload",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a tab to finish loading (status === 'complete').
 * Resolves with the updated tab, or resolves with current tab state on timeout.
 */
function waitForTabLoad(
  tabId: number,
  timeoutMs: number,
): Promise<chrome.tabs.Tab> {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      // Still return the tab even on timeout — it may be partially loaded
      chrome.tabs
        .get(tabId)
        .then(resolve)
        .catch(() => {
          reject(
            new Error(
              `Timed out waiting for tab ${tabId} to load (${timeoutMs}ms)`,
            ),
          );
        });
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Check if the tab is already complete (race condition guard)
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (!settled && tab.status === "complete") {
          settled = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error(`Tab ${tabId} not found`));
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export class NavigateTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // --- Validate action ---
      const actionArg =
        typeof args.action === "string" ? args.action : undefined;
      if (!actionArg || !VALID_ACTIONS.has(actionArg)) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Invalid or missing action: "${actionArg ?? ""}". Must be one of: goto, back, forward, reload`,
            },
          ],
        };
      }
      const action = actionArg as NavigateAction;

      // --- Validate url for goto ---
      const url = typeof args.url === "string" ? args.url : undefined;
      if (action === "goto" && !url) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: 'Missing required argument: url (string) when action is "goto"',
            },
          ],
        };
      }

      // --- Resolve tabId (optional — defaults to active tab) ---
      let tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab?.id) {
          return {
            success: false,
            content: [
              {
                type: "text",
                text: "No active tab found. Provide a tabId explicitly.",
              },
            ],
          };
        }
        tabId = activeTab.id;
      }

      // --- Verify tab exists ---
      try {
        await chrome.tabs.get(tabId);
      } catch {
        return {
          success: false,
          content: [{ type: "text", text: `Tab ${tabId} not found` }],
        };
      }

      // --- Execute the navigation action ---
      switch (action) {
        case "goto": {
          await chrome.tabs.update(tabId, { url: url! });
          break;
        }
        case "back": {
          await chrome.tabs.goBack(tabId);
          break;
        }
        case "forward": {
          await chrome.tabs.goForward(tabId);
          break;
        }
        case "reload": {
          await chrome.tabs.reload(tabId);
          break;
        }
      }

      // --- Wait for page load ---
      const tab = await waitForTabLoad(tabId, PAGE_LOAD_TIMEOUT_MS);

      const result = {
        tabId,
        action,
        url: tab.url ?? tab.pendingUrl ?? url ?? null,
        title: tab.title ?? null,
        status: tab.status ?? "unknown",
      };

      return {
        success: true,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to navigate: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
