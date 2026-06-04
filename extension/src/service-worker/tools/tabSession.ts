/**
 * tab_session tool - save and restore named sets of tabs (a "project").
 *
 * Actions:
 *   save     Snapshot a window's tabs (and group membership) under a name.
 *   restore  Open a saved session's tabs in a new window, recreating groups.
 *   list     List saved sessions with tab counts.
 *   delete   Remove a saved session.
 *
 * Sessions are stored in chrome.storage.local under a single key.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

const STORAGE_KEY = "chromeuse:sessions";

interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
  groupId: number;
}
interface SavedGroup {
  id: number;
  title?: string;
  color?: string;
}
interface SavedSession {
  name: string;
  savedAt: number;
  tabs: SavedTab[];
  groups: SavedGroup[];
}

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

async function loadSessions(): Promise<Record<string, SavedSession>> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return (res[STORAGE_KEY] as Record<string, SavedSession>) ?? {};
}
async function saveSessions(sessions: Record<string, SavedSession>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

export class TabSessionTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const action = args.action;
    if (action !== "save" && action !== "restore" && action !== "list" && action !== "delete") {
      return fail('Invalid "action": expected one of save, restore, list, delete');
    }

    try {
      if (action === "list") {
        const sessions = await loadSessions();
        return ok({
          sessions: Object.values(sessions).map((s) => ({ name: s.name, savedAt: s.savedAt, tabCount: s.tabs.length })),
        });
      }

      const name = typeof args.name === "string" ? args.name : undefined;
      if (!name) return fail(`"${action}" requires a "name"`);

      if (action === "delete") {
        const sessions = await loadSessions();
        const existed = name in sessions;
        delete sessions[name];
        await saveSessions(sessions);
        return ok({ deleted: existed, name });
      }

      if (action === "save") {
        const windowId = typeof args.windowId === "number" ? args.windowId : undefined;
        const win = windowId !== undefined
          ? await chrome.windows.get(windowId, { populate: true })
          : await chrome.windows.getLastFocused({ populate: true });
        const tabs = (win.tabs ?? []).filter((t) => t.url && !t.url.startsWith("chrome://"));

        const groupIds = new Set(tabs.map((t) => t.groupId).filter((g) => g !== undefined && g >= 0) as number[]);
        const groups: SavedGroup[] = [];
        for (const gid of groupIds) {
          try {
            const g = await chrome.tabGroups.get(gid);
            groups.push({ id: gid, title: g.title, color: g.color });
          } catch {
            // group may be gone
          }
        }

        const session: SavedSession = {
          name,
          savedAt: Date.now(),
          tabs: tabs.map((t) => ({ url: t.url!, title: t.title ?? t.url!, pinned: !!t.pinned, groupId: t.groupId ?? -1 })),
          groups,
        };
        const sessions = await loadSessions();
        sessions[name] = session;
        await saveSessions(sessions);
        return ok({ saved: name, tabCount: session.tabs.length, groupCount: groups.length });
      }

      // restore
      const sessions = await loadSessions();
      const session = sessions[name];
      if (!session) return fail(`No saved session named "${name}"`);
      if (session.tabs.length === 0) return fail(`Session "${name}" has no tabs`);

      const win = await chrome.windows.create({ url: session.tabs.map((t) => t.url) });
      const createdTabs = win.tabs ?? [];

      // Recreate groups by original groupId.
      const byGroup = new Map<number, number[]>();
      session.tabs.forEach((t, i) => {
        const created = createdTabs[i];
        if (created?.id === undefined) return;
        if (t.groupId >= 0) {
          const arr = byGroup.get(t.groupId) ?? [];
          arr.push(created.id);
          byGroup.set(t.groupId, arr);
        }
      });

      for (const [origGroupId, tabIds] of byGroup) {
        try {
          const newGroupId = await chrome.tabs.group({ tabIds });
          const meta = session.groups.find((g) => g.id === origGroupId);
          if (meta) {
            await chrome.tabGroups.update(newGroupId, {
              title: meta.title,
              color: meta.color as chrome.tabGroups.ColorEnum | undefined,
            });
          }
        } catch {
          // grouping is best-effort
        }
      }

      return ok({ restored: name, windowId: win.id, tabCount: session.tabs.length });
    } catch (error) {
      return fail(`tab_session failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
