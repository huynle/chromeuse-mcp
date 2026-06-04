/**
 * Content-script loader for axe-core.
 *
 * Injected on demand by the accessibility_audit tool via
 * chrome.scripting.executeScript({ files: [...] }). It bundles axe-core and
 * exposes it on the isolated-world `window` so a follow-up injected function
 * can call `window.axe.run(...)` against the page DOM.
 */

import axe from "axe-core";

(globalThis as unknown as { axe?: typeof axe }).axe = axe;
