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

// --- Clipboard handler ---

interface ClipboardMessage {
  action: 'clipboard-write' | 'clipboard-read'
  text?: string
}

chrome.runtime.onMessage.addListener(
  (
    message: ClipboardMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; text?: string; error?: string }) => void,
  ): boolean => {
    if (message?.action === 'clipboard-write') {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = String(message.text ?? '')
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        sendResponse({ success: copied })
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
      return false // synchronous
    }

    if (message?.action === 'clipboard-read') {
      navigator.clipboard
        .readText()
        .then((text) => sendResponse({ success: true, text }))
        .catch((err) =>
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
        )
      return true // asynchronous
    }

    return false
  },
)

console.log('[ChromeUse] Offscreen document ready (GIF encoder + clipboard loaded)')
