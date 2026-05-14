import { describe, expect, it } from "vitest";
import { resolveBrowserTransportStatus } from "./connectionStatus.js";

describe("resolveBrowserTransportStatus", () => {
  it("keeps an explicit WebSocket gateway wait from being hidden by native host connectivity", () => {
    expect(resolveBrowserTransportStatus("waiting", "connected")).toBe("waiting");
  });
});
