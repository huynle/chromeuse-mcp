import type { ToolRequest, ToolResponse, ToolResult } from "@chromeuse/shared";
import { messageRouter } from "./messageRouter.js";
import {
  recordToolStart,
  recordToolComplete,
} from "./sidePanelHandler.js";

export type ToolResponseSender = (response: ToolResponse) => void;

const STOPPED_BY_USER_MESSAGE = "ChromeUse automation stopped by user.";
const LEGACY_STOP_SCOPE = "__legacy__";

interface ActiveToolRequest {
  readonly entryId: number;
  readonly requestId: string;
  readonly stopScope: string;
  readonly tabId?: number;
  readonly sendResponse: ToolResponseSender;
  completed: boolean;
}

const activeRequests = new Map<string, ActiveToolRequest>();
const stoppedScopes = new Set<string>();
const lastStopScopeByTab = new Map<number, string>();

export function createToolResponse(
  result: ToolResult,
  requestId: string,
): ToolResponse {
  if (result.success) {
    return {
      type: "tool_response",
      request_id: requestId,
      result: { content: result.content },
    };
  }

  return {
    type: "tool_response",
    request_id: requestId,
    error: { content: result.content },
  };
}

export async function handleToolRequest(
  message: ToolRequest,
  sendResponse: ToolResponseSender,
): Promise<void> {
  const entryId = recordToolStart(message.params.tool);
  const requestId = message.params.request_id;
  const stopScope = getStopScope(message);

  if (stoppedScopes.has(stopScope)) {
    recordToolComplete(entryId, false, STOPPED_BY_USER_MESSAGE);
    sendResponse(createStoppedResponse(requestId));
    return;
  }

  const active: ActiveToolRequest = {
    entryId,
    requestId,
    stopScope,
    tabId: typeof message.params.args.tabId === "number" ? message.params.args.tabId : undefined,
    sendResponse,
    completed: false,
  };
  if (active.tabId !== undefined) lastStopScopeByTab.set(active.tabId, stopScope);
  activeRequests.set(requestId, active);

  try {
    const result = await messageRouter.route({
      method: message.method,
      params: message.params,
    });
    if (active.completed) return;
    active.completed = true;
    recordToolComplete(entryId, result.success);
    sendResponse(createToolResponse(result, requestId));
  } catch (error) {
    if (active.completed) return;
    active.completed = true;
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordToolComplete(entryId, false, errorMsg);
    sendResponse(
      createToolResponse(
        {
          success: false,
          content: [
            {
              type: "text",
              text: `Internal error: ${errorMsg}`,
            },
          ],
        },
        requestId,
      ),
    );
  } finally {
    activeRequests.delete(requestId);
  }
}

export function stopActiveToolRequests(tabId?: number): number {
  let stopped = 0;

  for (const active of activeRequests.values()) {
    if (active.completed) continue;
    if (tabId !== undefined && active.tabId !== tabId) continue;

    stoppedScopes.add(active.stopScope);
    active.completed = true;
    stopped++;
    recordToolComplete(active.entryId, false, STOPPED_BY_USER_MESSAGE);
    active.sendResponse(createStoppedResponse(active.requestId));
  }

  if (stopped === 0 && tabId !== undefined) {
    const scope = lastStopScopeByTab.get(tabId);
    if (scope && !stoppedScopes.has(scope)) {
      stoppedScopes.add(scope);
      stopped = 1;
    }
  }

  return stopped;
}

export function clearUserStop(): void {
  stoppedScopes.clear();
  lastStopScopeByTab.clear();
}

function getStopScope(message: ToolRequest): string {
  return message.params.client_id ?? message.params.session_scope ?? LEGACY_STOP_SCOPE;
}

function createStoppedResponse(requestId: string): ToolResponse {
  return createToolResponse(
    {
      success: false,
      content: [{ type: "text", text: STOPPED_BY_USER_MESSAGE }],
    },
    requestId,
  );
}
