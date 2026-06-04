/**
 * Shared helper for ensuring the single offscreen document exists.
 *
 * Only one offscreen document may exist per extension; multiple features
 * (GIF encoding, clipboard) share the same document URL and reuse it.
 */

const OFFSCREEN_URL = "dist/offscreen/offscreen.html";

let creating: Promise<void> | null = null;

export async function ensureOffscreenDocument(
  reason: chrome.offscreen.Reason,
  justification: string,
): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  // Guard against concurrent createDocument calls (Chrome rejects duplicates).
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: [reason], justification })
    .finally(() => {
      creating = null;
    });
  await creating;
}
