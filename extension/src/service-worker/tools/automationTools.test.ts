import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";
import { TabSessionTool } from "./tabSession.js";
import { HistorySearchTool } from "./historySearch.js";
import { BookmarksTool } from "./bookmarks.js";

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}

describe("TabSessionTool", () => {
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
        },
      },
      windows: {
        getLastFocused: vi.fn(async () => ({
          id: 1,
          tabs: [
            { url: "https://a.test", title: "A", pinned: false, groupId: -1 },
            { url: "https://b.test", title: "B", pinned: true, groupId: 5 },
            { url: "chrome://settings", title: "S", pinned: false, groupId: -1 },
          ],
        })),
        create: vi.fn(async () => ({ id: 9, tabs: [{ id: 91 }, { id: 92 }] })),
      },
      tabGroups: { get: vi.fn(async () => ({ title: "Work", color: "blue" })), update: vi.fn(async () => ({})) },
      tabs: { group: vi.fn(async () => 77) },
    });
  });

  it("saves the current window's web tabs (skipping chrome:// urls)", async () => {
    const r = await new TabSessionTool().execute({ action: "save", name: "proj" }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.tabCount).toBe(2); // chrome://settings excluded
    expect(payload.groupCount).toBe(1);
  });

  it("lists and restores a saved session", async () => {
    await new TabSessionTool().execute({ action: "save", name: "proj" }, {});

    const listed = await new TabSessionTool().execute({ action: "list" }, {});
    expect(JSON.parse(text(listed)).sessions[0].name).toBe("proj");

    const restored = await new TabSessionTool().execute({ action: "restore", name: "proj" }, {});
    expect(restored.success).toBe(true);
    expect(JSON.parse(text(restored)).restored).toBe("proj");
    expect(chrome.windows.create).toHaveBeenCalledWith({ url: ["https://a.test", "https://b.test"] });
    expect(chrome.tabs.group).toHaveBeenCalled(); // grouped the tab that had groupId 5
  });

  it("deletes a session and errors on unknown restore", async () => {
    await new TabSessionTool().execute({ action: "save", name: "proj" }, {});
    const del = await new TabSessionTool().execute({ action: "delete", name: "proj" }, {});
    expect(JSON.parse(text(del)).deleted).toBe(true);
    const missing = await new TabSessionTool().execute({ action: "restore", name: "proj" }, {});
    expect(missing.success).toBe(false);
  });
});

describe("HistorySearchTool", () => {
  it("reports when permission is missing", async () => {
    vi.stubGlobal("chrome", {});
    const r = await new HistorySearchTool().execute({ query: "x" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("history");
  });

  it("searches history with a time window", async () => {
    const search = vi.fn(async (_q: { text: string; maxResults: number; startTime: number }) => [
      { title: "Doc", url: "https://d.test", lastVisitTime: 1, visitCount: 3 },
    ]);
    vi.stubGlobal("chrome", { history: { search } });
    const r = await new HistorySearchTool().execute({ query: "doc", days: 7, maxResults: 10 }, {});
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).results[0].url).toBe("https://d.test");
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ text: "doc", maxResults: 10 }));
    expect(search.mock.calls[0][0].startTime).toBeGreaterThan(0);
  });
});

describe("BookmarksTool", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      bookmarks: {
        search: vi.fn(async () => [{ id: "1", title: "T", url: "https://t.test", parentId: "0" }]),
        getChildren: vi.fn(async () => [{ id: "2", title: "Folder", parentId: "0" }]),
        getTree: vi.fn(async () => [{ id: "0", title: "", children: [{ id: "1", title: "Bar", parentId: "0" }] }]),
        create: vi.fn(async (d: { title?: string; url?: string }) => ({ id: "9", title: d.title, url: d.url, parentId: "0" })),
      },
    });
  });

  it("searches bookmarks", async () => {
    const r = await new BookmarksTool().execute({ action: "search", query: "t" }, {});
    expect(JSON.parse(text(r)).results[0].url).toBe("https://t.test");
  });

  it("lists root children when no id", async () => {
    const r = await new BookmarksTool().execute({ action: "list" }, {});
    expect(JSON.parse(text(r)).children[0].title).toBe("Bar");
  });

  it("creates a bookmark", async () => {
    const r = await new BookmarksTool().execute({ action: "create", title: "New", url: "https://n.test" }, {});
    expect(JSON.parse(text(r)).created.url).toBe("https://n.test");
  });

  it("rejects create with neither title nor url", async () => {
    const r = await new BookmarksTool().execute({ action: "create" }, {});
    expect(r.success).toBe(false);
  });
});
