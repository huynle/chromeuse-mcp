import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const startupListeners: Array<() => void> = [];

  return {
    startupListeners,
    nativeMessaging: {
      connect: vi.fn(),
      onConnectionStatusChange: vi.fn(),
      status: "disconnected",
    },
    webSocketConnection: {
      onConnectionStatusChange: vi.fn(),
      status: "disconnected",
    },
  };
});

vi.mock("./nativeMessaging.js", () => ({ nativeMessaging: mocks.nativeMessaging }));
vi.mock("./webSocketConnection.js", () => ({ webSocketConnection: mocks.webSocketConnection }));
vi.mock("./messageRouter.js", () => ({ messageRouter: {} }));
vi.mock("./badge.js", () => ({ updateBadge: vi.fn() }));
vi.mock("./cdp.js", () => ({ cdpManager: { initialize: vi.fn(() => Promise.resolve()) } }));
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
      onInstalled: { addListener: vi.fn() },
      onStartup: {
        addListener: vi.fn((listener: () => void) => {
          mocks.startupListeners.push(listener);
        }),
      },
    },
  },
});

describe("service worker startup", () => {
  it("does not connect browser transports until the user presses Connect", async () => {
    await import("./index.js");

    expect(mocks.nativeMessaging.connect).not.toHaveBeenCalled();

    for (const listener of mocks.startupListeners) listener();

    expect(mocks.nativeMessaging.connect).not.toHaveBeenCalled();
  });
});
