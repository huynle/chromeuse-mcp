import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeMessageListener = (
  message: { action?: string; tabId?: number },
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
  recoverFromActivity: vi.fn(() => Promise.resolve(false)),
  status: "disconnected",
};

vi.mock("./nativeMessaging.js", () => ({ nativeMessaging }));
vi.mock("./webSocketConnection.js", () => ({ webSocketConnection }));

const chromeStub = {
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
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
  sidePanel: {
    open: vi.fn(() => Promise.resolve()),
    setPanelBehavior: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    onRemoved: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
    update: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  },
  windows: {
    update: vi.fn(() => Promise.resolve()),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
};

Object.assign(globalThis, { chrome: chromeStub });

const {
  initSidePanelHandler,
  recordAutomationTab,
  setAutomationTabWorking,
  setConnectionStatus,
} = await import("./sidePanelHandler.js");

function sendRuntimeMessage(message: { action?: string; tabId?: number }) {
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
    webSocketConnection.recoverFromActivity.mockResolvedValue(false);
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

  it("stops automation without disconnecting an active WebSocket", () => {
    webSocketConnection.status = "connected";
    initSidePanelHandler();

    const stop = sendRuntimeMessage({ action: "sidepanel_stop_automation" });

    expect(stop.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(webSocketConnection.disconnect).not.toHaveBeenCalled();
    expect(nativeMessaging.disconnect).not.toHaveBeenCalled();
    expect(nativeMessaging.connect).not.toHaveBeenCalled();
  });

  it("stops automation without touching native messaging when no WebSocket session is active", () => {
    webSocketConnection.status = "disconnected";
    initSidePanelHandler();

    const stop = sendRuntimeMessage({ action: "sidepanel_stop_automation" });

    expect(stop.sendResponse).toHaveBeenCalledWith({ success: true });
    expect(webSocketConnection.disconnect).not.toHaveBeenCalled();
    expect(nativeMessaging.disconnect).not.toHaveBeenCalled();
    expect(nativeMessaging.connect).not.toHaveBeenCalled();
  });

  it("updates the action badge from the combined connection status", () => {
    setConnectionStatus("connected");

    expect(chromeStub.action.setBadgeText).toHaveBeenCalledWith({ text: "ON" });
    expect(chromeStub.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#10B981",
    });
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
      type: "connection_status_changed",
      status: "connected",
    });
  });

  it("probes WebSocket gateway health when side panel activity resumes", () => {
    webSocketConnection.status = "waiting";
    initSidePanelHandler();

    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });

    expect(state.sendResponse).toHaveBeenCalledOnce();
    expect(webSocketConnection.recoverFromActivity).toHaveBeenCalledOnce();
  });

  it("enables toolbar icon side panel toggling", () => {
    initSidePanelHandler();

    expect(chromeStub.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chromeStub.action.onClicked.addListener).not.toHaveBeenCalled();
  });

  it("includes automation-created tabs in side panel state", () => {
    recordAutomationTab({
      id: 123,
      title: "Example Domain",
      url: "https://example.com/",
      windowId: 456,
      active: false,
    });
    initSidePanelHandler();

    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });

    expect(state.sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        automationTabs: [
          {
            tabId: 123,
            title: "Example Domain",
            url: "https://example.com/",
            windowId: 456,
            active: false,
            isAutomating: false,
          },
        ],
      }),
    );
  });

  it("removes tracked automation tabs when Chrome reports the tab closed", () => {
    initSidePanelHandler();
    recordAutomationTab({ id: 123, title: "Example", url: "https://example.com/", windowId: 456, active: false });

    const listener = chromeStub.tabs.onRemoved.addListener.mock.calls[0][0] as (tabId: number) => void;
    listener(123);

    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });
    expect(state.sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ automationTabs: [] }),
    );
  });

  it("focuses the requested automation tab from the side panel", async () => {
    recordAutomationTab({ id: 123, title: "Example", url: "https://example.com/", windowId: 456, active: false });
    initSidePanelHandler();

    const focus = sendRuntimeMessage({ action: "sidepanel_focus_tab", tabId: 123 });

    expect(focus.handled).toBe(true);
    await vi.waitFor(() => {
      expect(chromeStub.tabs.update).toHaveBeenCalledWith(123, { active: true });
      expect(chromeStub.windows.update).toHaveBeenCalledWith(456, { focused: true });
      expect(focus.sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  it("marks tracked tabs that are actively being automated", () => {
    recordAutomationTab({ id: 123, title: "Example", url: "https://example.com/", windowId: 456, active: false });

    setAutomationTabWorking(123, true);
    initSidePanelHandler();

    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });
    expect(state.sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        automationTabs: [expect.objectContaining({ tabId: 123, isAutomating: true })],
      }),
    );
  });

  it("stops automation for a requested tracked tab", () => {
    webSocketConnection.status = "connected";
    recordAutomationTab({ id: 123, title: "Example", url: "https://example.com/", windowId: 456, active: false });
    setAutomationTabWorking(123, true);
    initSidePanelHandler();

    const stop = sendRuntimeMessage({ action: "sidepanel_stop_tab_automation", tabId: 123 });

    expect(stop.sendResponse).toHaveBeenCalledWith({ success: true, stopped: 0 });
    expect(webSocketConnection.disconnect).not.toHaveBeenCalled();
    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });
    expect(state.sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        automationTabs: [expect.objectContaining({ tabId: 123, isAutomating: false })],
      }),
    );
  });

  it("closes a requested tracked tab", async () => {
    recordAutomationTab({ id: 123, title: "Example", url: "https://example.com/", windowId: 456, active: false });
    initSidePanelHandler();

    const close = sendRuntimeMessage({ action: "sidepanel_close_tab", tabId: 123 });

    expect(close.handled).toBe(true);
    await vi.waitFor(() => {
      expect(chromeStub.tabs.remove).toHaveBeenCalledWith(123);
      expect(close.sendResponse).toHaveBeenCalledWith({ success: true });
    });
    const state = sendRuntimeMessage({ action: "sidepanel_get_state" });
    expect(state.sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ automationTabs: [] }),
    );
  });
});
