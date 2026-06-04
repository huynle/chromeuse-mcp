/**
 * cookies tool - inspect and mutate browser cookies via the chrome.cookies API.
 *
 * Useful for auth flows (export a logged-in session), testing logged-out
 * states, and resetting state between automation runs.
 *
 * Actions:
 *   get     List cookies for a url or domain.
 *   set     Create/update a cookie (url + name + value required).
 *   delete  Remove a cookie by url + name.
 *   clear   Remove all cookies for a url or domain.
 *
 * Requires the "cookies" permission plus host access (granted via <all_urls>).
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

type SameSite = "no_restriction" | "lax" | "strict";

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

function summarize(c: chrome.cookies.Cookie): Record<string, unknown> {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    session: c.session,
    ...(c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}),
  };
}

export class CookiesTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const action = args.action;
    if (action !== "get" && action !== "set" && action !== "delete" && action !== "clear") {
      return fail('Invalid "action": expected one of get, set, delete, clear');
    }

    if (!chrome.cookies) {
      return fail('The "cookies" permission is not available. Reload the extension after updating the manifest.');
    }

    const url = typeof args.url === "string" ? args.url : undefined;
    const domain = typeof args.domain === "string" ? args.domain : undefined;

    try {
      switch (action) {
        case "get": {
          if (!url && !domain) return fail('"get" requires "url" or "domain"');
          const cookies = await chrome.cookies.getAll(url ? { url } : { domain: domain! });
          return ok({ count: cookies.length, cookies: cookies.map(summarize) });
        }

        case "set": {
          if (!url) return fail('"set" requires a "url"');
          const name = typeof args.name === "string" ? args.name : undefined;
          if (!name) return fail('"set" requires a "name"');
          const details: chrome.cookies.SetDetails = {
            url,
            name,
            value: typeof args.value === "string" ? args.value : "",
          };
          if (typeof args.path === "string") details.path = args.path;
          if (typeof args.secure === "boolean") details.secure = args.secure;
          if (typeof args.httpOnly === "boolean") details.httpOnly = args.httpOnly;
          if (typeof args.expirationDate === "number") details.expirationDate = args.expirationDate;
          if (typeof args.sameSite === "string") details.sameSite = args.sameSite as SameSite;
          const cookie = await chrome.cookies.set(details);
          if (!cookie) return fail("Failed to set cookie (rejected by the browser)");
          return ok({ set: summarize(cookie) });
        }

        case "delete": {
          if (!url) return fail('"delete" requires a "url"');
          const name = typeof args.name === "string" ? args.name : undefined;
          if (!name) return fail('"delete" requires a "name"');
          const removed = await chrome.cookies.remove({ url, name });
          return ok({ deleted: removed !== null, name });
        }

        case "clear": {
          if (!url && !domain) return fail('"clear" requires "url" or "domain"');
          const cookies = await chrome.cookies.getAll(url ? { url } : { domain: domain! });
          let removed = 0;
          for (const c of cookies) {
            const cookieUrl = `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path}`;
            const res = await chrome.cookies.remove({ url: cookieUrl, name: c.name });
            if (res) removed++;
          }
          return ok({ cleared: removed, of: cookies.length });
        }
      }

      return fail(`Unsupported action: ${String(action)}`);
    } catch (error) {
      return fail(`cookies failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
