import { describe, expect, it } from "vitest";
import { getConnectionControlsState } from "./connectionControls.js";

describe("getConnectionControlsState", () => {
  it("allows cancelling a pending gateway connection", () => {
    expect(getConnectionControlsState("waiting")).toEqual({
      connectDisabled: true,
      disconnectDisabled: false,
      stopDisabled: true,
    });
  });
});
