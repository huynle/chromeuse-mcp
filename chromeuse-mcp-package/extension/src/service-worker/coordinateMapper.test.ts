import { describe, expect, it } from "vitest";
import {
  calculateScreenshotDimensions,
  estimateTokens,
  getScaleFactors,
  screenshotToViewport,
  viewportToScreenshot,
  clampCoordinate,
  type ViewportSize,
  type ScreenshotDimensions,
  type Coordinate,
} from "./coordinateMapper.js";

describe("calculateScreenshotDimensions", () => {
  describe("bug: dimensions exceeding Claude API 2000px limit", () => {
    it("MUST NOT exceed 2000px in either dimension with custom maxPx", () => {
      // The bug: if someone passes maxPx > 2000, or if MAX_TARGET_PX is changed,
      // the early return can produce dimensions > 2000px
      const viewport: ViewportSize = { width: 1800, height: 1800 };
      const devicePixelRatio = 1.3;
      const customMaxPx = 2500; // Dangerous custom value

      const dimensions = calculateScreenshotDimensions(viewport, devicePixelRatio, customMaxPx);

      // The absolute maximum for Claude API's many-image requests is 2000px
      // This should NEVER be exceeded, even with custom maxPx
      expect(dimensions.width).toBeLessThanOrEqual(2000);
      expect(dimensions.height).toBeLessThanOrEqual(2000);
    });

    it("MUST NOT exceed 2000px with very high maxPx", () => {
      const viewport: ViewportSize = { width: 2000, height: 2000 };
      const devicePixelRatio = 1.5;
      const customMaxPx = 5000; // Extreme custom value

      const dimensions = calculateScreenshotDimensions(viewport, devicePixelRatio, customMaxPx);

      expect(dimensions.width).toBeLessThanOrEqual(2000);
      expect(dimensions.height).toBeLessThanOrEqual(2000);
    });

    it("handles extreme devicePixelRatio values", () => {
      const viewport: ViewportSize = { width: 1200, height: 1200 };
      const devicePixelRatio = 2.0;

      const dimensions = calculateScreenshotDimensions(viewport, devicePixelRatio);

      expect(dimensions.width).toBeLessThanOrEqual(2000);
      expect(dimensions.height).toBeLessThanOrEqual(2000);
    });

    it("handles large viewport with modest devicePixelRatio", () => {
      const viewport: ViewportSize = { width: 1600, height: 1200 };
      const devicePixelRatio = 1.3;

      const dimensions = calculateScreenshotDimensions(viewport, devicePixelRatio);

      expect(dimensions.width).toBeLessThanOrEqual(2000);
      expect(dimensions.height).toBeLessThanOrEqual(2000);
    });

    it("enforces 2000px absolute maximum even if MAX_TARGET_PX were increased", () => {
      // Future-proofing: if someone changes MAX_TARGET_PX to 1800 or 2000,
      // ensure we still have hard limit protection
      const viewport: ViewportSize = { width: 1900, height: 1900 };
      const devicePixelRatio = 1.2;
      const hypotheticalMaxPx = 2200;

      const dimensions = calculateScreenshotDimensions(viewport, devicePixelRatio, hypotheticalMaxPx);

      expect(dimensions.width).toBeLessThanOrEqual(2000);
      expect(dimensions.height).toBeLessThanOrEqual(2000);
    });
  });

  describe("existing behavior", () => {
    it("returns actual dimensions when within budget", () => {
      const viewport: ViewportSize = { width: 800, height: 600 };
      const dimensions = calculateScreenshotDimensions(viewport, 1);

      expect(dimensions).toEqual({ width: 800, height: 600 });
    });

    it("scales down when viewport exceeds max", () => {
      const viewport: ViewportSize = { width: 2000, height: 1500 };
      const dimensions = calculateScreenshotDimensions(viewport, 1);

      // With new MAX_TARGET_PX = 1400, dimensions should fit within that
      expect(dimensions.width).toBeLessThanOrEqual(1400);
      expect(dimensions.height).toBeLessThanOrEqual(1400);
      expect(dimensions.width).toBe(1400); // longest edge scales to 1400
    });

    it("accounts for device pixel ratio", () => {
      const viewport: ViewportSize = { width: 800, height: 600 };
      const dimensions = calculateScreenshotDimensions(viewport, 2);

      // Actual: 1600x1200, but should scale to fit within 1400
      expect(dimensions.width).toBeLessThanOrEqual(1400);
      expect(dimensions.height).toBeLessThanOrEqual(1400);
    });

    it("maintains aspect ratio", () => {
      const viewport: ViewportSize = { width: 2000, height: 1000 };
      const dimensions = calculateScreenshotDimensions(viewport, 1);

      const aspectRatio = dimensions.width / dimensions.height;
      expect(aspectRatio).toBeCloseTo(2.0, 2);
    });

    it("respects minimum dimension", () => {
      const viewport: ViewportSize = { width: 50, height: 5000 };
      const dimensions = calculateScreenshotDimensions(viewport, 1);

      expect(dimensions.width).toBeGreaterThanOrEqual(100);
      expect(dimensions.height).toBeLessThanOrEqual(1400);
    });
  });
});

describe("estimateTokens", () => {
  it("estimates token cost based on pixel area", () => {
    const dimensions: ScreenshotDimensions = { width: 1568, height: 1568 };
    const tokens = estimateTokens(dimensions);

    // ~1568² / 28² ≈ 3138 tokens
    expect(tokens).toBeGreaterThan(3000);
    expect(tokens).toBeLessThan(3200);
  });

  it("returns smaller token count for smaller images", () => {
    const small: ScreenshotDimensions = { width: 800, height: 600 };
    const large: ScreenshotDimensions = { width: 1568, height: 1568 };

    expect(estimateTokens(small)).toBeLessThan(estimateTokens(large));
  });
});

describe("getScaleFactors", () => {
  it("calculates correct scale factors", () => {
    const viewport: ViewportSize = { width: 1600, height: 1200 };
    const screenshot: ScreenshotDimensions = { width: 800, height: 600 };

    const factors = getScaleFactors(viewport, screenshot);

    expect(factors.scaleX).toBe(2);
    expect(factors.scaleY).toBe(2);
  });

  it("handles non-uniform scaling", () => {
    const viewport: ViewportSize = { width: 1600, height: 900 };
    const screenshot: ScreenshotDimensions = { width: 800, height: 600 };

    const factors = getScaleFactors(viewport, screenshot);

    expect(factors.scaleX).toBe(2);
    expect(factors.scaleY).toBe(1.5);
  });
});

describe("screenshotToViewport", () => {
  it("converts screenshot coordinates to viewport coordinates", () => {
    const viewport: ViewportSize = { width: 1600, height: 1200 };
    const screenshot: ScreenshotDimensions = { width: 800, height: 600 };
    const coord: Coordinate = { x: 400, y: 300 };

    const result = screenshotToViewport(coord, viewport, screenshot);

    expect(result.x).toBe(800);
    expect(result.y).toBe(600);
  });

  it("rounds to nearest integer", () => {
    const viewport: ViewportSize = { width: 1000, height: 1000 };
    const screenshot: ScreenshotDimensions = { width: 333, height: 333 };
    const coord: Coordinate = { x: 100, y: 100 };

    const result = screenshotToViewport(coord, viewport, screenshot);

    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
  });
});

describe("viewportToScreenshot", () => {
  it("converts viewport coordinates to screenshot coordinates", () => {
    const viewport: ViewportSize = { width: 1600, height: 1200 };
    const screenshot: ScreenshotDimensions = { width: 800, height: 600 };
    const coord: Coordinate = { x: 800, y: 600 };

    const result = viewportToScreenshot(coord, viewport, screenshot);

    expect(result.x).toBe(400);
    expect(result.y).toBe(300);
  });
});

describe("clampCoordinate", () => {
  it("clamps coordinates to bounds", () => {
    const bounds = { width: 800, height: 600 };

    expect(clampCoordinate({ x: -10, y: 50 }, bounds)).toEqual({ x: 0, y: 50 });
    expect(clampCoordinate({ x: 900, y: 50 }, bounds)).toEqual({ x: 799, y: 50 });
    expect(clampCoordinate({ x: 50, y: -10 }, bounds)).toEqual({ x: 50, y: 0 });
    expect(clampCoordinate({ x: 50, y: 700 }, bounds)).toEqual({ x: 50, y: 599 });
  });

  it("does not modify coordinates within bounds", () => {
    const bounds = { width: 800, height: 600 };
    const coord: Coordinate = { x: 400, y: 300 };

    expect(clampCoordinate(coord, bounds)).toEqual(coord);
  });
});
