/**
 * history_search tool - search browsing history via chrome.history.
 *
 * Args:
 *   query (string, optional): text to match (empty matches everything).
 *   maxResults (number, optional): default 50.
 *   days (number, optional): only results from the last N days.
 *
 * Requires the "history" permission.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class HistorySearchTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    if (!chrome.history) {
      return {
        success: false,
        content: [{ type: "text", text: 'The "history" permission is not available. Reload the extension after updating the manifest.' }],
      };
    }

    const query = typeof args.query === "string" ? args.query : "";
    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 50;
    const days = typeof args.days === "number" ? args.days : undefined;
    const startTime = days !== undefined ? Date.now() - days * DAY_MS : 0;

    try {
      const items = await chrome.history.search({ text: query, maxResults, startTime });
      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: items.length,
                results: items.map((h) => ({
                  title: h.title,
                  url: h.url,
                  lastVisitTime: h.lastVisitTime,
                  visitCount: h.visitCount,
                })),
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
        content: [{ type: "text", text: `history_search failed: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
}
