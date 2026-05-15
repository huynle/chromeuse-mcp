import { describe, expect, it, vi } from "vitest";

const automationIndicator = vi.hoisted(() => ({
  markAutomationTab: vi.fn(() => Promise.resolve()),
  unmarkAutomationTab: vi.fn(() => Promise.resolve()),
}));
const sidePanelHandler = vi.hoisted(() => ({
  finishAutomationTabWorking: vi.fn(),
  recordAutomationTab: vi.fn(),
  setAutomationTabWorking: vi.fn(),
}));

vi.mock("./automationIndicator.js", () => automationIndicator);
vi.mock("./sidePanelHandler.js", () => sidePanelHandler);

import { MessageRouter } from "./messageRouter.js";
import type { ToolRequest } from "./messageRouter.js";
import type { ToolHandler, ToolResult } from "../types/messages.js";

/** Helper to create a ToolRequest */
function makeRequest(
  tool: string,
  args: Record<string, unknown> = {},
  sessionScope?: string,
): ToolRequest {
  return {
    method: "execute_tool",
    params: { request_id: "req-router-test", tool, args, session_scope: sessionScope },
  };
}

/** Helper to create a simple handler that returns a text result */
function makeHandler(text: string): ToolHandler {
  return {
    async execute() {
      return {
        success: true,
        content: [{ type: "text", text }],
      };
    },
  };
}

describe("MessageRouter", () => {
  describe("register and getRegisteredTools", () => {
    it("starts with no registered tools", () => {
      const router = new MessageRouter();
      expect(router.getRegisteredTools()).toEqual([]);
    });

    it("returns names of registered tools", () => {
      const router = new MessageRouter();
      router.register("tool_a", makeHandler("a"));
      router.register("tool_b", makeHandler("b"));
      expect(router.getRegisteredTools()).toEqual(["tool_a", "tool_b"]);
    });
  });

  describe("route", () => {
    it("dispatches to the correct handler", async () => {
      const router = new MessageRouter();
      router.register("greet", makeHandler("hello"));
      router.register("farewell", makeHandler("goodbye"));

      const result = await router.route(makeRequest("greet"));
      expect(result).toEqual({
        success: true,
        content: [{ type: "text", text: "hello" }],
      });
    });

    it("passes args and context to the handler", async () => {
      const router = new MessageRouter();
      let receivedArgs: Record<string, unknown> = {};
      let receivedScope: string | undefined;

      router.register("echo", {
        async execute(args, context) {
          receivedArgs = args;
          receivedScope = context.sessionScope;
          return { success: true, content: [{ type: "text", text: "ok" }] };
        },
      });

      await router.route(makeRequest("echo", { foo: "bar" }, "my-scope"));
      expect(receivedArgs).toEqual({ foo: "bar" });
      expect(receivedScope).toBe("my-scope");
    });

    it("returns error result for unknown tool", async () => {
      const router = new MessageRouter();
      router.register("known", makeHandler("ok"));

      const result = await router.route(makeRequest("unknown_tool"));
      expect(result.success).toBe(false);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Unknown tool: unknown_tool. Available tools: known",
      });
    });

    it("returns error result when handler throws", async () => {
      const router = new MessageRouter();
      router.register("failing", {
        async execute() {
          throw new Error("something broke");
        },
      });

      const result = await router.route(makeRequest("failing"));
      expect(result.success).toBe(false);
      expect(result.content[0]).toEqual({
        type: "text",
        text: 'Tool "failing" failed: something broke',
      });
    });

    it("handles non-Error throws gracefully", async () => {
      const router = new MessageRouter();
      router.register("bad", {
        async execute() {
          throw "string error"; // eslint-disable-line no-throw-literal
        },
      });

      const result = await router.route(makeRequest("bad"));
      expect(result.success).toBe(false);
      expect(result.content[0]).toEqual({
        type: "text",
        text: 'Tool "bad" failed: string error',
      });
    });

    it("shows automation controls only while a tab-targeted tool is running", async () => {
      const router = new MessageRouter();
      let release: (() => void) | undefined;
      router.register("slow", {
        async execute() {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { success: true, content: [{ type: "text", text: "ok" }] };
        },
      });

      const result = router.route(makeRequest("slow", { tabId: 123 }));

      await vi.waitFor(() => {
        expect(automationIndicator.markAutomationTab).toHaveBeenCalledWith(123);
      });
      expect(sidePanelHandler.setAutomationTabWorking).toHaveBeenCalledWith(123, true);
      expect(automationIndicator.unmarkAutomationTab).not.toHaveBeenCalled();

      release?.();
      await result;

      expect(automationIndicator.unmarkAutomationTab).toHaveBeenCalledWith(123);
      expect(sidePanelHandler.finishAutomationTabWorking).toHaveBeenCalledWith(123);
    });

    it("serializes concurrent tool requests", async () => {
      const router = new MessageRouter();
      const events: string[] = [];
      let releaseFirst: (() => void) | undefined;

      router.register("slow", {
        async execute(args) {
          const id = args.id as string;
          events.push(`start:${id}`);
          if (id === "first") {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
          events.push(`finish:${id}`);
          return { success: true, content: [{ type: "text", text: id }] };
        },
      });

      const first = router.route(makeRequest("slow", { id: "first" }));
      const second = router.route(makeRequest("slow", { id: "second" }));

      await vi.waitFor(() => {
        expect(events).toEqual(["start:first"]);
      });

      releaseFirst?.();

      await Promise.all([first, second]);

      expect(events).toEqual([
        "start:first",
        "finish:first",
        "start:second",
        "finish:second",
      ]);
    });
  });
});
