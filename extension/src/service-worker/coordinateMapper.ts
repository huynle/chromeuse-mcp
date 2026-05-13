/**
 * CoordinateMapper translates between screenshot image space and browser
 * viewport space.
 *
 * When we capture a screenshot (via CDP Page.captureScreenshot), the image
 * dimensions may differ from the actual viewport dimensions due to device
 * pixel ratio and our downscaling for token efficiency. Tools that accept
 * (x, y) coordinates in "screenshot space" need those mapped back to
 * viewport coordinates for Input.dispatchMouseEvent, and vice versa.
 *
 * Token budget sizing:
 * - pxPerToken = 28 (Claude's approximate pixels-per-token for images)
 * - absoluteMaxPx = 2000 (Claude API hard limit for many-image requests)
 * - maxTargetPx = 1400 (conservative target to stay within reasonable token budget)
 */

/** Pixels per token for Claude's vision model */
const PX_PER_TOKEN = 28;

/** Absolute maximum dimension enforced by Claude API for many-image requests */
const ABSOLUTE_MAX_PX = 2000;

/** Maximum target dimension in pixels for screenshot capture */
const MAX_TARGET_PX = 1400;

/** Minimum dimension to avoid degenerate screenshots */
const MIN_TARGET_PX = 100;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ScreenshotDimensions {
  width: number;
  height: number;
}

export interface Coordinate {
  x: number;
  y: number;
}

export interface ScaleFactors {
  scaleX: number;
  scaleY: number;
}

/**
 * Calculate the optimal screenshot dimensions for a given viewport,
 * keeping the image within token budget while preserving aspect ratio.
 *
 * The longest edge is capped at the minimum of maxPx and ABSOLUTE_MAX_PX (2000),
 * ensuring Claude API limits are never exceeded. The other edge is scaled
 * proportionally to maintain aspect ratio.
 *
 * @param viewport - The browser viewport dimensions
 * @param devicePixelRatio - Device pixel ratio (typically 1, 1.5, or 2)
 * @param maxPx - Maximum target dimension (defaults to MAX_TARGET_PX = 1400)
 * @returns Screenshot dimensions that respect all constraints
 */
export function calculateScreenshotDimensions(
  viewport: ViewportSize,
  devicePixelRatio = 1,
  maxPx = MAX_TARGET_PX
): ScreenshotDimensions {
  // Ensure maxPx never exceeds Claude API's absolute maximum
  const effectiveMaxPx = Math.min(maxPx, ABSOLUTE_MAX_PX);

  // Actual pixel dimensions (accounting for device pixel ratio)
  const actualWidth = viewport.width * devicePixelRatio;
  const actualHeight = viewport.height * devicePixelRatio;

  // If already within budget, use actual dimensions
  if (actualWidth <= effectiveMaxPx && actualHeight <= effectiveMaxPx) {
    return { width: actualWidth, height: actualHeight };
  }

  // Scale down so the longest edge fits within effectiveMaxPx
  const longestEdge = Math.max(actualWidth, actualHeight);
  const scale = effectiveMaxPx / longestEdge;

  return {
    width: Math.max(MIN_TARGET_PX, Math.round(actualWidth * scale)),
    height: Math.max(MIN_TARGET_PX, Math.round(actualHeight * scale)),
  };
}

/**
 * Estimate the token cost of an image with the given dimensions.
 */
export function estimateTokens(dimensions: ScreenshotDimensions): number {
  const totalPixels = dimensions.width * dimensions.height;
  return Math.ceil(totalPixels / (PX_PER_TOKEN * PX_PER_TOKEN));
}

/**
 * Compute scale factors between screenshot space and viewport space.
 */
export function getScaleFactors(
  viewport: ViewportSize,
  screenshot: ScreenshotDimensions
): ScaleFactors {
  return {
    scaleX: viewport.width / screenshot.width,
    scaleY: viewport.height / screenshot.height,
  };
}

/**
 * Convert a coordinate from screenshot image space to viewport space.
 *
 * Use this when a tool receives (x, y) from the user (referring to
 * positions in a screenshot image) and needs to dispatch a mouse event
 * at the corresponding viewport position.
 */
export function screenshotToViewport(
  coord: Coordinate,
  viewport: ViewportSize,
  screenshot: ScreenshotDimensions
): Coordinate {
  const { scaleX, scaleY } = getScaleFactors(viewport, screenshot);
  return {
    x: Math.round(coord.x * scaleX),
    y: Math.round(coord.y * scaleY),
  };
}

/**
 * Convert a coordinate from viewport space to screenshot image space.
 *
 * Use this when displaying element positions overlaid on a screenshot.
 */
export function viewportToScreenshot(
  coord: Coordinate,
  viewport: ViewportSize,
  screenshot: ScreenshotDimensions
): Coordinate {
  const { scaleX, scaleY } = getScaleFactors(viewport, screenshot);
  return {
    x: Math.round(coord.x / scaleX),
    y: Math.round(coord.y / scaleY),
  };
}

/**
 * Clamp a coordinate to be within the bounds of the given dimensions.
 */
export function clampCoordinate(
  coord: Coordinate,
  bounds: ScreenshotDimensions | ViewportSize
): Coordinate {
  return {
    x: Math.max(0, Math.min(coord.x, bounds.width - 1)),
    y: Math.max(0, Math.min(coord.y, bounds.height - 1)),
  };
}
