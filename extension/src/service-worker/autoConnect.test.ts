import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webSocketConnection: {
    connect: vi.fn(),
    status: "disconnected" as string,
  },
}));

vi.mock("./webSocketConnection.js", () => ({
  webSocketConnection: mocks.webSocketConnection,
}));

import {
  AUTO_CONNECT_STORAGE_KEY,
  ensureAutoConnect,
  initAutoConnect,
  isAutoConnectEnabled,
  setAutoConnectEnabled,
  shouldAttemptAutoConnect,
} from "./autoConnect.js";

function stubStorage(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const store = { ...initial };
  const alarmListeners: Array<(alarm: { name: string }) => void> = [];
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
      },
      alarms: {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn((cb) => alarmListeners.push(cb)) },
      },
    },
  });
  (globalThis as { __alarmListeners?: typeof alarmListeners }).__alarmListeners = alarmListeners;
  return store;
}

describe("shouldAttemptAutoConnect", () => {
  it("never attempts when disabled", () => {
    expect(shouldAttemptAutoConnect(false, "disconnected")).toBe(false);
    expect(shouldAttemptAutoConnect(false, "waiting")).toBe(false);
  });

  it("attempts only when enabled and not already active", () => {
    expect(shouldAttemptAutoConnect(true, "disconnected")).toBe(true);
    expect(shouldAttemptAutoConnect(true, "waiting")).toBe(true);
    expect(shouldAttemptAutoConnect(true, "error")).toBe(true);
    expect(shouldAttemptAutoConnect(true, "connected")).toBe(false);
    expect(shouldAttemptAutoConnect(true, "connecting")).toBe(false);
  });
});

describe("auto-connect preference", () => {
  beforeEach(() => {
    mocks.webSocketConnection.connect.mockReset();
    mocks.webSocketConnection.status = "disconnected";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to enabled when no preference is stored", async () => {
    stubStorage();
    expect(await isAutoConnectEnabled()).toBe(true);
  });

  it("reflects a stored opt-out", async () => {
    stubStorage({ [AUTO_CONNECT_STORAGE_KEY]: false });
    expect(await isAutoConnectEnabled()).toBe(false);
  });

  it("defaults to enabled when storage throws", async () => {
    Object.assign(globalThis, {
      chrome: {
        storage: {
          local: {
            get: vi.fn(async () => {
              throw new Error("storage unavailable");
            }),
          },
        },
      },
    });
    expect(await isAutoConnectEnabled()).toBe(true);
  });

  it("persists the preference", async () => {
    const store = stubStorage();
    await setAutoConnectEnabled(false);
    expect(store[AUTO_CONNECT_STORAGE_KEY]).toBe(false);
    await setAutoConnectEnabled(true);
    expect(store[AUTO_CONNECT_STORAGE_KEY]).toBe(true);
  });
});

describe("ensureAutoConnect", () => {
  beforeEach(() => {
    mocks.webSocketConnection.connect.mockReset();
    mocks.webSocketConnection.status = "disconnected";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects when enabled and disconnected", async () => {
    stubStorage();
    await ensureAutoConnect();
    expect(mocks.webSocketConnection.connect).toHaveBeenCalledTimes(1);
  });

  it("does not connect when the user opted out", async () => {
    stubStorage({ [AUTO_CONNECT_STORAGE_KEY]: false });
    await ensureAutoConnect();
    expect(mocks.webSocketConnection.connect).not.toHaveBeenCalled();
  });

  it("does not reconnect when already connected", async () => {
    stubStorage();
    mocks.webSocketConnection.status = "connected";
    await ensureAutoConnect();
    expect(mocks.webSocketConnection.connect).not.toHaveBeenCalled();
  });
});

describe("initAutoConnect", () => {
  beforeEach(() => {
    mocks.webSocketConnection.connect.mockReset();
    mocks.webSocketConnection.status = "disconnected";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a keepalive alarm and connects immediately", async () => {
    stubStorage();
    initAutoConnect();

    expect(chrome.alarms.create).toHaveBeenCalled();
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();

    // The async ensureAutoConnect() inside initAutoConnect() connects once
    // its storage read settles.
    await vi.waitFor(() => {
      expect(mocks.webSocketConnection.connect).toHaveBeenCalled();
    });
  });
});
