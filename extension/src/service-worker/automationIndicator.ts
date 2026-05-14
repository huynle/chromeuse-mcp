const VISUAL_INDICATOR_SCRIPT = "dist/content-scripts/visualIndicator.js";
const AUTOMATION_IDLE_HIDE_DELAY_MS = 3000;

const automatedTabs = new Map<number, number>();
const hideTimers = new Map<number, ReturnType<typeof setTimeout>>();
let initialized = false;

type IndicatorAction = "show_indicator" | "hide_indicator";

export function initAutomationIndicator(): void {
  if (initialized) return;
  initialized = true;

  chrome.tabs.onRemoved.addListener((tabId: number) => {
    automatedTabs.delete(tabId);
    clearHideTimer(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete" || !automatedTabs.has(tabId)) return;
    void showIndicator(tabId);
  });
}

export async function markAutomationTab(tabId: number): Promise<void> {
  clearHideTimer(tabId);
  const activeCount = automatedTabs.get(tabId) ?? 0;
  automatedTabs.set(tabId, activeCount + 1);
  if (activeCount === 0) await showIndicator(tabId);
}

export async function unmarkAutomationTab(tabId: number): Promise<void> {
  const activeCount = automatedTabs.get(tabId) ?? 0;
  if (activeCount === 0) return;
  if (activeCount <= 1) {
    automatedTabs.delete(tabId);
    scheduleHideIndicator(tabId);
    return;
  }

  automatedTabs.set(tabId, activeCount - 1);
}

export async function clearAutomationIndicators(): Promise<void> {
  const tabs = Array.from(automatedTabs.keys());
  automatedTabs.clear();
  for (const tabId of tabs) clearHideTimer(tabId);
  await Promise.all(tabs.map((tabId) => hideIndicator(tabId)));
}

function clearHideTimer(tabId: number): void {
  const timer = hideTimers.get(tabId);
  if (timer === undefined) return;

  clearTimeout(timer);
  hideTimers.delete(tabId);
}

function scheduleHideIndicator(tabId: number): void {
  clearHideTimer(tabId);
  hideTimers.set(
    tabId,
    setTimeout(() => {
      hideTimers.delete(tabId);
      void hideIndicator(tabId);
    }, AUTOMATION_IDLE_HIDE_DELAY_MS),
  );
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
