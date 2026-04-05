/**
 * Service Worker — Chrome MV3 background script.
 *
 * This is the main entry point for the extension's background logic.
 * It handles native messaging, tab management, and command routing.
 */

import { TOOL_NAMES } from "@opencode-chrome/shared";
import { messageRouter } from "./messageRouter.js";
import { FindTool } from "./tools/find.js";
import { FormInputTool } from "./tools/formInput.js";

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

messageRouter.register(TOOL_NAMES.FIND, new FindTool());
messageRouter.register(TOOL_NAMES.FORM_INPUT, new FormInputTool());

console.log('[OpenCode] Service worker loaded')
