import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const getAttachedTabs = vi.fn<() => number[]>();
const checkTabHealth = vi.fn<(tabId: number) => Promise<boolean>>();

vi.mock("../cdp.js", () => ({
  cdpManager: {
    getAttachedTabs,
    checkTabHealth,
  },
}));

const { HealthCheckTool } = await import("./healthCheck.js");

function resultText(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("Expected text result");
  return block.text;
}

describe("HealthCheckTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAttachedTabs.mockReturnValue([123]);
    checkTabHealth.mockResolvedValue(true);
  });

  it("returns healthy status when all systems operational", async () => {
    const tool = new HealthCheckTool();

    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const healthData = JSON.parse(resultText(result));
    expect(healthData.status).toBe("healthy");
    expect(healthData.cdp.attached).toBe(true);
    expect(healthData.cdp.tabsAttached).toEqual([123]);
    expect(healthData.cdp.keepaliveActive).toBe(true);
    expect(healthData.serviceWorker.state).toBe("active");
    expect(healthData.timestamp).toBeTypeOf("number");
    expect(healthData.responseTimeMs).toBeTypeOf("number");
  });

  it("returns degraded status when no tabs attached to CDP", async () => {
    getAttachedTabs.mockReturnValue([]);

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.status).toBe("degraded");
    expect(healthData.cdp.attached).toBe(false);
    expect(healthData.cdp.tabsAttached).toEqual([]);
    expect(healthData.lastError).toContain("No tabs attached to CDP");
  });

  it("returns degraded status when CDP keepalive is inactive", async () => {
    checkTabHealth.mockResolvedValue(false);

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.status).toBe("degraded");
    expect(healthData.cdp.attached).toBe(true);
    expect(healthData.cdp.keepaliveActive).toBe(false);
    expect(healthData.lastError).toContain("CDP keepalive inactive or unresponsive");
  });

  it("returns degraded status when CDP health check throws error", async () => {
    checkTabHealth.mockRejectedValue(new Error("Connection timeout"));

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.status).toBe("degraded");
    expect(healthData.cdp.keepaliveActive).toBe(false);
    // When checkTabHealth throws, the catch block sets lastError with the specific error
    expect(healthData.lastError).toBe("CDP health check failed: Connection timeout");
  });

  it("includes response time in milliseconds", async () => {
    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(healthData.responseTimeMs).toBeTypeOf("number");
  });

  it("includes timestamp in the response", async () => {
    const tool = new HealthCheckTool();
    const beforeCall = Date.now();
    const result = await tool.execute({}, {});
    const afterCall = Date.now();

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.timestamp).toBeGreaterThanOrEqual(beforeCall);
    expect(healthData.timestamp).toBeLessThanOrEqual(afterCall);
  });

  it("reports service worker as active when code is running", async () => {
    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.serviceWorker.state).toBe("active");
  });

  it("returns unhealthy status on unexpected errors", async () => {
    // Force an error by making getAttachedTabs throw
    getAttachedTabs.mockImplementation(() => {
      throw new Error("Unexpected CDP manager error");
    });

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(false);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.status).toBe("unhealthy");
    expect(healthData.cdp.attached).toBe(false);
    expect(healthData.cdp.tabsAttached).toEqual([]);
    expect(healthData.cdp.keepaliveActive).toBe(false);
    expect(healthData.serviceWorker.state).toBe("unknown");
    expect(healthData.lastError).toContain("Health check failed: Unexpected CDP manager error");
  });

  it("checks CDP attachment status correctly", async () => {
    getAttachedTabs.mockReturnValue([101, 102, 103]);
    checkTabHealth.mockResolvedValue(true);

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.cdp.attached).toBe(true);
    expect(healthData.cdp.tabsAttached).toEqual([101, 102, 103]);
    expect(checkTabHealth).toHaveBeenCalledWith(101); // Checks first tab
  });

  it("handles empty attached tabs array edge case", async () => {
    getAttachedTabs.mockReturnValue([]);

    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);

    const healthData = JSON.parse(resultText(result));
    expect(healthData.cdp.attached).toBe(false);
    expect(healthData.cdp.keepaliveActive).toBe(false);
    expect(checkTabHealth).not.toHaveBeenCalled(); // Should not attempt health check with no tabs
  });

  it("returns expected health check response format", async () => {
    const tool = new HealthCheckTool();
    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const healthData = JSON.parse(resultText(result));
    
    // Verify all required fields are present
    expect(healthData).toHaveProperty("status");
    expect(healthData).toHaveProperty("timestamp");
    expect(healthData).toHaveProperty("responseTimeMs");
    expect(healthData).toHaveProperty("cdp");
    expect(healthData.cdp).toHaveProperty("attached");
    expect(healthData.cdp).toHaveProperty("tabsAttached");
    expect(healthData.cdp).toHaveProperty("keepaliveActive");
    expect(healthData).toHaveProperty("serviceWorker");
    expect(healthData.serviceWorker).toHaveProperty("state");

    // Verify status is one of the valid values
    expect(["healthy", "degraded", "unhealthy"]).toContain(healthData.status);
  });
});
