import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const startupListeners: Array<() => void> = [];
  const installedListeners: Array<(details: { reason: string }) => void> = [];

  return {
    startupListeners,
    installedListeners,
    nativeMessaging: {
      connect: vi.fn(),
      onConnectionStatusChange: vi.fn(),
      status: "disconnected",
    },
    webSocketConnection: {
      connect: vi.fn(),
      onConnectionStatusChange: vi.fn(),
      status: "disconnected",
    },
    initAutoConnect: vi.fn(),
    ensureAutoConnect: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("./nativeMessaging.js", () => ({ nativeMessaging: mocks.nativeMessaging }));
vi.mock("./webSocketConnection.js", () => ({ webSocketConnection: mocks.webSocketConnection }));
vi.mock("./messageRouter.js", () => ({ messageRouter: {} }));
vi.mock("./badge.js", () => ({ updateBadge: vi.fn() }));
vi.mock("./cdp.js", () => ({ cdpManager: { initialize: vi.fn(() => Promise.resolve()) } }));
vi.mock("./autoConnect.js", () => ({
  initAutoConnect: mocks.initAutoConnect,
  ensureAutoConnect: mocks.ensureAutoConnect,
}));
vi.mock("./automationIndicator.js", () => ({ initAutomationIndicator: vi.fn() }));
vi.mock("./sidePanelHandler.js", () => ({
  initSidePanelHandler: vi.fn(),
  setConnectionStatus: vi.fn(),
}));
vi.mock("./tools/index.js", () => ({ registerTools: vi.fn() }));

Object.assign(globalThis, {
  chrome: {
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: {
        addListener: vi.fn((listener: (details: { reason: string }) => void) => {
          mocks.installedListeners.push(listener);
        }),
      },
      onStartup: {
        addListener: vi.fn((listener: () => void) => {
          mocks.startupListeners.push(listener);
        }),
      },
    },
  },
});

describe("service worker startup", () => {
  it("initializes background auto-connect on load and on lifecycle events", async () => {
    await import("./index.js");

    // Background auto-connect is wired up at load time so ChromeUse is ready
    // without a manual Connect click.
    expect(mocks.initAutoConnect).toHaveBeenCalledTimes(1);

    // It does NOT auto-start native messaging (gateway WebSocket is the path).
    expect(mocks.nativeMessaging.connect).not.toHaveBeenCalled();

    mocks.ensureAutoConnect.mockClear();
    for (const listener of mocks.startupListeners) listener();
    expect(mocks.ensureAutoConnect).toHaveBeenCalled();

    mocks.ensureAutoConnect.mockClear();
    for (const listener of mocks.installedListeners) listener({ reason: "install" });
    expect(mocks.ensureAutoConnect).toHaveBeenCalled();
    expect(mocks.nativeMessaging.connect).not.toHaveBeenCalled();
  });
});
