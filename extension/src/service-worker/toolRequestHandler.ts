import type { ToolRequest, ToolResponse, ToolResult } from "@chromeuse/shared";
import { messageRouter } from "./messageRouter.js";
import {
  recordToolStart,
  recordToolComplete,
} from "./sidePanelHandler.js";

export type ToolResponseSender = (response: ToolResponse) => void;

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

  try {
    const result = await messageRouter.route({
      method: message.method,
      params: message.params,
    });
    recordToolComplete(entryId, result.success);
    sendResponse(createToolResponse(result, message.params.request_id));
  } catch (error) {
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
        message.params.request_id,
      ),
    );
  }
}
