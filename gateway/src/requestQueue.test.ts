import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";
import { describe, expect, it } from "vitest";
import { RequestQueueTransport } from "./requestQueue.js";

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: Error) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeBrowserTransport implements BrowserTransport {
  connected = true;
  readonly calls: Array<{ tool: string; args: Record<string, unknown>; timeoutMs?: number }> = [];
  readonly requests: Array<Deferred<ToolRequestResult>> = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ToolRequestResult> {
    this.calls.push({ tool, args, timeoutMs });
    const request = new Deferred<ToolRequestResult>();
    this.requests.push(request);
    return request.promise;
  }

  disconnect(): void {
    this.connected = false;
  }
}

describe("RequestQueueTransport", () => {
  it("serializes tool requests in FIFO order", async () => {
    const underlying = new FakeBrowserTransport();
    const queue = new RequestQueueTransport(underlying);

    const first = queue.sendToolRequest("first", { order: 1 }, 1000);
    const second = queue.sendToolRequest("second", { order: 2 }, 2000);
    const third = queue.sendToolRequest("third", { order: 3 }, 3000);

    await Promise.resolve();
    expect(underlying.calls.map((call) => call.tool)).toEqual(["first"]);

    underlying.requests[0].resolve({ content: [{ type: "text", text: "one" }] });
    await expect(first).resolves.toEqual({ content: [{ type: "text", text: "one" }] });
    await Promise.resolve();
    expect(underlying.calls.map((call) => call.tool)).toEqual(["first", "second"]);

    underlying.requests[1].resolve({ content: [{ type: "text", text: "two" }] });
    await expect(second).resolves.toEqual({ content: [{ type: "text", text: "two" }] });
    await Promise.resolve();
    expect(underlying.calls.map((call) => call.tool)).toEqual(["first", "second", "third"]);

    underlying.requests[2].resolve({ content: [{ type: "text", text: "three" }] });
    await expect(third).resolves.toEqual({ content: [{ type: "text", text: "three" }] });

    expect(underlying.calls).toEqual([
      { tool: "first", args: { order: 1 }, timeoutMs: 1000 },
      { tool: "second", args: { order: 2 }, timeoutMs: 2000 },
      { tool: "third", args: { order: 3 }, timeoutMs: 3000 },
    ]);
  });

  it("rejects cleanly when no extension is connected", async () => {
    const underlying = new FakeBrowserTransport();
    underlying.connected = false;
    const queue = new RequestQueueTransport(underlying);

    await expect(queue.sendToolRequest("tabs_context", {})).rejects.toThrow(
      "No extension connected"
    );
    expect(underlying.calls).toEqual([]);
  });

  it("rejects active and pending requests when disconnected", async () => {
    const underlying = new FakeBrowserTransport();
    const queue = new RequestQueueTransport(underlying);

    const active = queue.sendToolRequest("active", {});
    const pending = queue.sendToolRequest("pending", {});

    await Promise.resolve();
    expect(underlying.calls.map((call) => call.tool)).toEqual(["active"]);

    queue.disconnect();

    await expect(active).rejects.toThrow("Extension disconnected");
    await expect(pending).rejects.toThrow("Extension disconnected");
    expect(underlying.connected).toBe(false);
    expect(underlying.calls.map((call) => call.tool)).toEqual(["active"]);
  });
});
