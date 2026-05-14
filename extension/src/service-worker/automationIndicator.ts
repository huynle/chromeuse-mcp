const VISUAL_INDICATOR_SCRIPT = "dist/content-scripts/visualIndicator.js";

const automatedTabs = new Set<number>();
let initialized = false;

type IndicatorAction = "show_indicator" | "hide_indicator";

export function initAutomationIndicator(): void {
  if (initialized) return;
  initialized = true;

  chrome.tabs.onRemoved.addListener((tabId: number) => {
    automatedTabs.delete(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete" || !automatedTabs.has(tabId)) return;
    void showIndicator(tabId);
  });
}

export async function markAutomationTab(tabId: number): Promise<void> {
  automatedTabs.add(tabId);
  await showIndicator(tabId);
}

export async function clearAutomationIndicators(): Promise<void> {
  const tabs = Array.from(automatedTabs);
  automatedTabs.clear();
  await Promise.all(tabs.map((tabId) => hideIndicator(tabId)));
}

async function showIndicator(tabId: number): Promise<void> {
  await sendIndicatorMessage(tabId, "show_indicator", true);
}

async function hideIndicator(tabId: number): Promise<void> {
  await sendIndicatorMessage(tabId, "hide_indicator", false);
}

async function sendIndicatorMessage(
  tabId: number,
  action: IndicatorAction,
  injectOnFailure: boolean,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { action });
    return;
  } catch {
    // The content script may be absent on tabs opened before extension load.
  }

  if (!injectOnFailure) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [VISUAL_INDICATOR_SCRIPT],
    });
    await chrome.tabs.sendMessage(tabId, { action });
  } catch {
    // Restricted pages (chrome://, Web Store, etc.) cannot be marked.
  }
}
