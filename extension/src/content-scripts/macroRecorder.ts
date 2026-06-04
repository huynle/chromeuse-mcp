/**
 * macroRecorder content script - capture user interactions during macro
 * recording and post each step to the service worker.
 *
 * Injected on demand by the macro tool (record_start). Captures click and
 * change events with a generated CSS selector for the target element.
 */

(() => {
  const w = window as unknown as { __chromeuseMacroRecording?: boolean };
  if (w.__chromeuseMacroRecording) return;
  w.__chromeuseMacroRecording = true;

  function cssPath(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let sel = node.tagName.toLowerCase();
      const cls = Array.from(node.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      sel += cls;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sameTag.length > 1) sel += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function post(step: Record<string, unknown>): void {
    try {
      chrome.runtime.sendMessage({ action: "macro-step", step });
    } catch {
      // service worker may be busy; drop the step
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      post({
        type: "click",
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 40),
      });
    },
    true,
  );

  document.addEventListener(
    "change",
    (e) => {
      const el = e.target as HTMLInputElement | null;
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
        post({
          type: "input",
          selector: cssPath(el),
          value: el.type === "checkbox" ? String(el.checked) : String(el.value),
        });
      }
    },
    true,
  );
})();
