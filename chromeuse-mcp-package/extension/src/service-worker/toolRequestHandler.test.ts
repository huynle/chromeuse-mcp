import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolRequest } from "@chromeuse/shared";

const messageRouter = vi.hoisted(() => ({
  route: vi.fn(),
}));
const sidePanelHandler = vi.hoisted(() => ({
  recordToolStart: vi.fn(() => 1),
  recordToolComplete: vi.fn(),
}));

vi.mock("./messageRouter.js", () => ({ messageRouter }));
vi.mock("./sidePanelHandler.js", () => sidePanelHandler);

const {
  clearUserStop,
  handleToolRequest,
  stopActiveToolRequests,
} = await import("./toolRequestHandler.js");

function makeRequest(tabId = 123, clientId = "client-a"): ToolRequest {
  return {
    type: "tool_request",
    method: "execute_tool",
    params: {
      request_id: "req-stop-test",
      tool: "computer",
      args: { action: "click", tabId },
      client_id: clientId,
    },
  } as ToolRequest;
}

describe("toolRequestHandler stop handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserStop();
  });

  it("sends an error response to active tab-targeted tool requests when stopped", async () => {
    let release: (() => void) | undefined;
    messageRouter.route.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ success: true, content: [{ type: "text", text: "late success" }] });
      }),
    );
    const sendResponse = vi.fn();

    const running = handleToolRequest(makeRequest(), sendResponse);
    await vi.waitFor(() => expect(sidePanelHandler.recordToolStart).toHaveBeenCalled());

    const stopped = stopActiveToolRequests(123);

    expect(stopped).toBe(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: "tool_response",
      request_id: "req-stop-test",
      error: {
        content: [{ type: "text", text: "ChromeUse automation stopped by user." }],
      },
    });
    expect(sidePanelHandler.recordToolComplete).toHaveBeenCalledWith(
      1,
      false,
      "ChromeUse automation stopped by user.",
    );

    release?.();
    await running;

    expect(sendResponse).toHaveBeenCalledTimes(1);
  });

  it("rejects later tool requests from the stopped client until cleared", async () => {
    let release: (() => void) | undefined;
    messageRouter.route.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ success: true, content: [{ type: "text", text: "late success" }] });
      }),
    );

    const firstSendResponse = vi.fn();
    const running = handleToolRequest(makeRequest(123, "client-a"), firstSendResponse);
    await vi.waitFor(() => expect(sidePanelHandler.recordToolStart).toHaveBeenCalled());

    stopActiveToolRequests(123);
    release?.();
    await running;

    messageRouter.route.mockClear();
    const sendResponse = vi.fn();

    await handleToolRequest(makeRequest(123, "client-a"), sendResponse);

    expect(messageRouter.route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: "tool_response",
      request_id: "req-stop-test",
      error: {
        content: [{ type: "text", text: "ChromeUse automation stopped by user." }],
      },
    });

    messageRouter.route.mockResolvedValueOnce({ success: true, content: [{ type: "text", text: "other client ok" }] });
    await handleToolRequest(makeRequest(123, "client-b"), sendResponse);

    expect(messageRouter.route).toHaveBeenCalledOnce();

    clearUserStop();
    messageRouter.route.mockResolvedValueOnce({ success: true, content: [{ type: "text", text: "ok" }] });

    await handleToolRequest(makeRequest(123, "client-a"), sendResponse);

    expect(messageRouter.route).toHaveBeenCalledTimes(2);
  });

  it("rejects later requests when stop happens during the post-action grace window", async () => {
    messageRouter.route.mockResolvedValueOnce({ success: true, content: [{ type: "text", text: "ok" }] });
    const firstSendResponse = vi.fn();

    await handleToolRequest(makeRequest(123, "client-a"), firstSendResponse);

    const stopped = stopActiveToolRequests(123);
    expect(stopped).toBe(1);

    messageRouter.route.mockClear();
    const sendResponse = vi.fn();
    await handleToolRequest(makeRequest(123, "client-a"), sendResponse);

    expect(messageRouter.route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: "tool_response",
      request_id: "req-stop-test",
      error: {
        content: [{ type: "text", text: "ChromeUse automation stopped by user." }],
      },
    });
  });
});
