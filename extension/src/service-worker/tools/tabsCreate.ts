/**
 * tabs_create tool - opens a new browser tab and adds it to the
 * session's "ChromeUse" tab group.
 *
 * Args:
 *   url (string, optional): URL to open. Defaults to chrome://newtab.
 *   active (boolean, optional): Whether to focus the new tab. Defaults to true.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { tabGroupManager } from "../tabGroups.js";

export class TabsCreateTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const url = typeof args.url === "string" ? args.url : undefined;
      const active = typeof args.active === "boolean" ? args.active : true;

      const createProps: chrome.tabs.CreateProperties = { active };
      if (url) {
        createProps.url = url;
      }

      const tab = await chrome.tabs.create(createProps);

      if (tab.id === undefined) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "Failed to create tab: no tab ID returned",
            },
          ],
        };
      }

      // Add to ChromeUse tab group
      let groupId: number | undefined;
      try {
        groupId = await tabGroupManager.addTabToGroup(
          tab.id,
          context.sessionScope,
        );
      } catch {
        // Tab grouping is best-effort; don't fail the tool if it errors
      }

      const result = {
        tabId: tab.id,
        url: tab.url ?? tab.pendingUrl ?? url ?? "chrome://newtab",
        windowId: tab.windowId,
        active: tab.active,
        groupId: groupId ?? null,
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
            text: `Failed to create tab: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
