import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";
import { CookiesTool } from "./cookies.js";

const getAll = vi.fn();
const set = vi.fn();
const remove = vi.fn();

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}

function cookie(name: string, overrides: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie {
  return {
    name,
    value: "v",
    domain: "example.com",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "lax",
    session: false,
    hostOnly: true,
    storeId: "0",
    ...overrides,
  } as chrome.cookies.Cookie;
}

describe("CookiesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", { cookies: { getAll, set, remove } });
  });

  it("rejects an invalid action", async () => {
    const r = await new CookiesTool().execute({ action: "nope" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("Invalid");
  });

  it("gets cookies for a url", async () => {
    getAll.mockResolvedValue([cookie("sid"), cookie("theme")]);
    const r = await new CookiesTool().execute({ action: "get", url: "https://example.com" }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.count).toBe(2);
    expect(payload.cookies[0].name).toBe("sid");
    expect(getAll).toHaveBeenCalledWith({ url: "https://example.com" });
  });

  it("requires url or domain for get", async () => {
    const r = await new CookiesTool().execute({ action: "get" }, {});
    expect(r.success).toBe(false);
  });

  it("sets a cookie", async () => {
    set.mockResolvedValue(cookie("sid", { value: "abc" }));
    const r = await new CookiesTool().execute(
      { action: "set", url: "https://example.com", name: "sid", value: "abc", secure: true },
      {},
    );
    expect(r.success).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com", name: "sid", value: "abc", secure: true }));
    expect(JSON.parse(text(r)).set.value).toBe("abc");
  });

  it("deletes a cookie", async () => {
    remove.mockResolvedValue({ url: "https://example.com", name: "sid" });
    const r = await new CookiesTool().execute({ action: "delete", url: "https://example.com", name: "sid" }, {});
    expect(JSON.parse(text(r)).deleted).toBe(true);
    expect(remove).toHaveBeenCalledWith({ url: "https://example.com", name: "sid" });
  });

  it("clears all cookies for a domain", async () => {
    getAll.mockResolvedValue([cookie("a"), cookie("b", { path: "/app" })]);
    remove.mockResolvedValue({});
    const r = await new CookiesTool().execute({ action: "clear", domain: "example.com" }, {});
    expect(JSON.parse(text(r)).cleared).toBe(2);
    expect(remove).toHaveBeenCalledWith({ url: "https://example.com/", name: "a" });
    expect(remove).toHaveBeenCalledWith({ url: "https://example.com/app", name: "b" });
  });
});
