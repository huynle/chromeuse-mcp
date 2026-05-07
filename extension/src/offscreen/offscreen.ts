/**
 * Offscreen Document — background processing.
 *
 * Used for operations that require DOM access but shouldn't run
 * in content scripts (e.g., GIF encoding, screenshot compositing).
 */

import { handleEncode, type EncodeRequest, type EncodeResponse } from './gifEncoder'

// --- Message Handler ---

chrome.runtime.onMessage.addListener(
  (
    message: EncodeRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: EncodeResponse) => void,
  ): boolean => {
    if (message.action !== 'encode') return false

    handleEncode(message)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    return true // Will respond asynchronously
  },
)

console.log('[ChromeUse] Offscreen document ready (GIF encoder loaded)')
