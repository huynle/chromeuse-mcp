/**
 * tabs_context tool - returns information about all open browser tabs
 * and tab groups.
 *
 * Queries chrome.tabs and chrome.tabGroups APIs to provide a snapshot
 * of the current browsing state including tab IDs, titles, URLs, and
 * group membership.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

export class TabsContextTool implements ToolHandler {
  async execute(
    _args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const tabs = await chrome.tabs.query({});

      // Attempt to get tab groups (may not be available in all Chrome versions)
      let groups: chrome.tabGroups.TabGroup[] = [];
      try {
        groups = await chrome.tabGroups.query({});
      } catch {
        // tabGroups API may not be available
      }

      const tabInfo = tabs.map((tab) => ({
        id: tab.id,
        title: tab.title ?? "",
        url: tab.url ?? "",
        active: tab.active,
        groupId: tab.groupId,
        windowId: tab.windowId,
        pinned: tab.pinned,
        status: tab.status,
      }));

      const groupInfo = groups.map((g) => ({
        id: g.id,
        title: g.title ?? "",
        color: g.color,
        collapsed: g.collapsed,
      }));

      const summary = [
        `${tabInfo.length} tab(s) across ${new Set(tabInfo.map((t) => t.windowId)).size} window(s)`,
        groups.length > 0 ? `${groups.length} tab group(s)` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { summary, tabs: tabInfo, groups: groupInfo },
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
            text: `Failed to query tabs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
