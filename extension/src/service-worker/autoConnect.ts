/**
 * Background auto-connect for the WebSocket gateway transport.
 *
 * The extension is the WebSocket *client*; it must initiate the connection to
 * the gateway bridge (ws://127.0.0.1:8765). To make ChromeUse "ready in the
 * background" without a manual Connect click, this module:
 *
 *   1. Connects on service-worker startup/install (unless the user opted out).
 *   2. Keeps a periodic alarm so that whenever the MV3 service worker wakes,
 *      the connection is re-established if it dropped (e.g. the gateway was
 *      restarted, or the worker was suspended while disconnected).
 *
 * User intent is respected: clicking Disconnect persists an opt-out so the
 * extension does not immediately reconnect behind the user's back. Clicking
 * Connect re-enables auto-connect. The preference lives in chrome.storage.local
 * so it survives browser restarts.
 */

import type { ConnectionStatus } from "../types/messages.js";
import { webSocketConnection } from "./webSocketConnection.js";

/** chrome.storage.local key holding the auto-connect opt-out preference. */
export const AUTO_CONNECT_STORAGE_KEY = "chromeuse:autoConnect";

/** Alarm that periodically re-ensures the background connection. */
const AUTO_CONNECT_ALARM = "chromeuse-ws-autoconnect";

/** How often to re-check the connection (Chrome clamps the minimum to ~1 min). */
const AUTO_CONNECT_INTERVAL_MINUTES = 1;

/** Statuses for which a (re)connect attempt should be skipped. */
const ACTIVE_STATUSES: ReadonlySet<ConnectionStatus> = new Set<ConnectionStatus>([
  "connected",
  "connecting",
]);

/**
 * Pure decision helper: should auto-connect attempt a connection right now?
 * Exported for unit testing.
 */
export function shouldAttemptAutoConnect(
  enabled: boolean,
  status: ConnectionStatus,
): boolean {
  if (!enabled) return false;
  return !ACTIVE_STATUSES.has(status);
}

/**
 * Read the persisted auto-connect preference. Defaults to enabled when unset
 * or when storage is unavailable, so a fresh install is ready immediately.
 */
export async function isAutoConnectEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(AUTO_CONNECT_STORAGE_KEY);
    const value = result[AUTO_CONNECT_STORAGE_KEY];
    return value === undefined ? true : value === true;
  } catch {
    return true;
  }
}

/** Persist the auto-connect preference (best-effort). */
export async function setAutoConnectEnabled(enabled: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [AUTO_CONNECT_STORAGE_KEY]: enabled });
  } catch (error) {
    console.warn("[AutoConnect] Failed to persist preference:", error);
  }
}

/**
 * Connect to the gateway if the user has not opted out and we are not already
 * connected or connecting. Safe to call repeatedly (e.g. from the alarm).
 */
export async function ensureAutoConnect(): Promise<void> {
  const enabled = await isAutoConnectEnabled();
  if (!shouldAttemptAutoConnect(enabled, webSocketConnection.status)) return;
  webSocketConnection.connect();
}

/**
 * Wire up background auto-connect: register the keepalive alarm + listener and
 * attempt an immediate connection. Call once during service-worker init.
 */
export function initAutoConnect(): void {
  chrome.alarms.create(AUTO_CONNECT_ALARM, {
    periodInMinutes: AUTO_CONNECT_INTERVAL_MINUTES,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_CONNECT_ALARM) return;
    void ensureAutoConnect();
  });

  void ensureAutoConnect();
}
