import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
const executeScript = vi.fn();
const getTab = vi.fn();
const onRemovedAddListener = vi.fn();
const onUpdatedAddListener = vi.fn();

vi.stubGlobal("chrome", {
  tabs: {
    sendMessage,
    get: getTab,
    onRemoved: { addListener: onRemovedAddListener },
    onUpdated: { addListener: onUpdatedAddListener },
  },
  scripting: {
    executeScript,
  },
});

const {
  clearAutomationIndicators,
  initAutomationIndicator,
  markAutomationTab,
} = await import("./automationIndicator.js");

describe("automationIndicator", () => {
  beforeEach(async () => {
    sendMessage.mockResolvedValue({ success: true });
    executeScript.mockResolvedValue([]);
    getTab.mockResolvedValue({ id: 123 });
    await clearAutomationIndicators();
    vi.clearAllMocks();
    sendMessage.mockResolvedValue({ success: true });
    executeScript.mockResolvedValue([]);
    getTab.mockResolvedValue({ id: 123 });
  });

  it("shows the automation indicator on a targeted tab", async () => {
    await markAutomationTab(123);

    expect(sendMessage).toHaveBeenCalledWith(123, {
      action: "show_indicator",
    });
  });

  it("injects the visual indicator content script when messaging fails", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("No receiving end"))
      .mockResolvedValueOnce({ success: true });

    await markAutomationTab(123);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 123 },
      files: ["dist/content-scripts/visualIndicator.js"],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("restores the indicator after a tracked tab finishes navigation", async () => {
    initAutomationIndicator();
    await markAutomationTab(123);
    sendMessage.mockClear();

    const listener = onUpdatedAddListener.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => void;

    listener(123, { status: "complete" });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(123, {
        action: "show_indicator",
      });
    });
  });

  it("hides indicators when automation is cleared", async () => {
    await markAutomationTab(123);
    sendMessage.mockClear();

    await clearAutomationIndicators();

    expect(sendMessage).toHaveBeenCalledWith(123, {
      action: "hide_indicator",
    });
  });
});
