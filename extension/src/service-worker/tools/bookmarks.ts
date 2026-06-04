/**
 * bookmarks tool - search, list, and create bookmarks via chrome.bookmarks.
 *
 * Actions:
 *   search  Find bookmarks matching a query.
 *   list    List children of a folder (root when id omitted).
 *   create  Create a bookmark or folder.
 *
 * Requires the "bookmarks" permission.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

function summarize(node: chrome.bookmarks.BookmarkTreeNode): Record<string, unknown> {
  return {
    id: node.id,
    title: node.title,
    ...(node.url ? { url: node.url } : { folder: true }),
    parentId: node.parentId,
  };
}

export class BookmarksTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    if (!chrome.bookmarks) {
      return fail('The "bookmarks" permission is not available. Reload the extension after updating the manifest.');
    }

    const action = args.action;
    if (action !== "search" && action !== "list" && action !== "create") {
      return fail('Invalid "action": expected one of search, list, create');
    }

    try {
      if (action === "search") {
        const query = typeof args.query === "string" ? args.query : undefined;
        if (!query) return fail('"search" requires a "query"');
        const results = await chrome.bookmarks.search(query);
        return ok({ count: results.length, results: results.map(summarize) });
      }

      if (action === "list") {
        const id = typeof args.id === "string" ? args.id : undefined;
        const children = id
          ? await chrome.bookmarks.getChildren(id)
          : (await chrome.bookmarks.getTree())[0]?.children ?? [];
        return ok({ count: children.length, children: children.map(summarize) });
      }

      // create
      const title = typeof args.title === "string" ? args.title : undefined;
      const url = typeof args.url === "string" ? args.url : undefined;
      if (!title && !url) return fail('"create" requires a "title" (folder) or "url"');
      const node = await chrome.bookmarks.create({
        parentId: typeof args.parentId === "string" ? args.parentId : undefined,
        title,
        url,
      });
      return ok({ created: summarize(node) });
    } catch (error) {
      return fail(`bookmarks failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
