/**
 * Badge management for the extension action icon.
 * Shows connection status via badge text and color.
 */

import type { ConnectionStatus } from "../types/messages.js";
import { BADGE_COLORS, BADGE_TEXT } from "../types/messages.js";

/**
 * Update the extension action badge to reflect connection status.
 */
export function updateBadge(status: ConnectionStatus): void {
  chrome.action.setBadgeText({ text: BADGE_TEXT[status] });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[status] });
}
