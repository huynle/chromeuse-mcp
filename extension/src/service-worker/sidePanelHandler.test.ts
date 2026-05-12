import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeMessageListener = (
  message: { action?: string },
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const listeners: RuntimeMessageListener[] = [];
const nativeMessaging = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: "disconnected",
};
const webSocketConnection = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: "disconnected",
};

vi.mock("./nativeMessaging.js", () => ({ nativeMessaging }));
vi.mock("./webSocketConnection.js", () => ({ webSocketConnection }));

Object.assign(globalThis, {
  chrome: {
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
      onMessage: {
        addListener: vi.fn((listener: RuntimeMessageListener) => {
          listeners.push(listener);
        }),
      },
    },
    action: {
      onClicked: { addListener: vi.fn() },
    },
    sidePanel: {
      open: vi.fn(() => Promise.resolve()),
    },
  },
});

const { initSidePanelHandler } = await import("./sidePanelHandler.js");

function sendRuntimeMessage(message: { action?: string }) {
  const sendResponse = vi.fn();
  const handled = listeners.at(-1)?.(message, {}, sendResponse);
  return { handled, sendResponse };
}

describe("sidePanelHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    nativeMessaging.status = "disconnected";
    webSocketConnection.status = "disconnected";
  });

  it("handles side panel WebSocket connect and disconnect requests", () => {
    initSidePanelHandler();

    const connect = sendRuntimeMessage({ action: "sidepanel_connect" });
    const disconnect = sendRuntimeMessage({ action: "sidepanel_disconnect" });

    expect(connect.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(disconnect.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(webSocketConnection.connect).toHaveBeenCalledOnce();
    expect(webSocketConnection.disconnect).toHaveBeenCalledOnce();
    expect(nativeMessaging.connect).not.toHaveBeenCalled();
    expect(nativeMessaging.disconnect).not.toHaveBeenCalled();
  });

  it("routes stop automation to WebSocket when WebSocket is active", () => {
    webSocketConnection.status = "connected";
    initSidePanelHandler();

    const stop = sendRuntimeMessage({ action: "sidepanel_stop_automation" });

    expect(stop.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(webSocketConnection.disconnect).toHaveBeenCalledOnce();
    expect(nativeMessaging.disconnect).not.toHaveBeenCalled();
    expect(nativeMessaging.connect).not.toHaveBeenCalled();
  });
});
