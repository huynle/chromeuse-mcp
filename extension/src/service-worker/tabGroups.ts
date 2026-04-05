/**
 * TabGroupManager - manages "OpenCode" tab groups with rotating colors.
 *
 * Each session gets its own tab group. Colors rotate through Chrome's
 * available tab group colors so concurrent sessions are visually distinct.
 */

/** Chrome tab group colors in rotation order */
const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

export class TabGroupManager {
  /** Maps session scope to tab group ID */
  private sessionGroups = new Map<string, number>();

  /** Index into GROUP_COLORS for next group created */
  private colorIndex = 0;

  /**
   * Add a tab to the OpenCode group for the given session.
   * Creates the group if it doesn't exist yet.
   *
   * @param tabId - The Chrome tab ID to add
   * @param sessionScope - Session identifier (groups tabs by session)
   * @returns The tab group ID
   */
  async addTabToGroup(tabId: number, sessionScope?: string): Promise<number> {
    const key = sessionScope ?? 'default';

    // Check if we already have a group for this session
    const existingGroupId = this.sessionGroups.get(key);
    if (existingGroupId !== undefined) {
      // Verify the group still exists (user may have ungrouped tabs)
      try {
        await chrome.tabGroups.get(existingGroupId);
        // Group exists - add tab to it
        await chrome.tabs.group({ tabIds: tabId, groupId: existingGroupId });
        return existingGroupId;
      } catch {
        // Group was removed - clean up and create a new one
        this.sessionGroups.delete(key);
      }
    }

    // Create a new group with this tab
    const groupId = await chrome.tabs.group({ tabIds: tabId });

    // Style the group
    const color = GROUP_COLORS[this.colorIndex % GROUP_COLORS.length];
    this.colorIndex++;

    await chrome.tabGroups.update(groupId, {
      title: 'OpenCode',
      color,
      collapsed: false,
    });

    this.sessionGroups.set(key, groupId);
    return groupId;
  }

  /**
   * Get the group ID for a session, if one exists.
   */
  getGroupId(sessionScope?: string): number | undefined {
    return this.sessionGroups.get(sessionScope ?? 'default');
  }

  /**
   * Remove a session's group tracking (does not delete the Chrome group).
   */
  removeSession(sessionScope?: string): void {
    this.sessionGroups.delete(sessionScope ?? 'default');
  }
}

/** Singleton instance */
export const tabGroupManager = new TabGroupManager();
