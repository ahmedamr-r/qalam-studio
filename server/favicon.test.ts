import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hop, Transport } from "@/discovery/fetch-guard";
import { faviconFor } from "./favicon";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16, 9]);

/** A fake web: each address answers as listed, and every request is recorded. */
function web(routes: Record<string, { status?: number; type?: string; body: string | Uint8Array }>) {
  const asked: string[] = [];
  const transport: Transport = async (url) => {
    asked.push(url.href);
    const r = routes[url.href];
    if (!r) return { status: 404, headers: {}, body: (async function* () {})(), close() {} } satisfies Hop;
    const body = typeof r.body === "string" ? new TextEncoder().encode(r.body) : r.body;
    return {
      status: r.status ?? 200,
      headers: r.type ? { "content-type": r.type } : {},
      body: (async function* () {
        yield body;
      })(),
      close() {},
    } satisfies Hop;
  };
  return { transport, asked };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "favicons-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("faviconFor", () => {
  it("takes /favicon.ico by its bytes, whatever type it's sent as, and keeps it", async () => {
    const w = web({ "https://shop.example/favicon.ico": { type: "text/plain", body: ICO } });
    expect(await faviconFor("shop.example", { transport: w.transport, dir })).toEqual({ type: "image/x-icon", bytes: ICO });
    expect(new Uint8Array(await readFile(path.join(dir, "shop.example")))).toEqual(ICO);
    // Asked again, it comes from this computer.
    expect((await faviconFor("shop.example", { transport: w.transport, dir }))?.type).toBe("image/x-icon");
    expect(w.asked).toEqual(["https://shop.example/favicon.ico"]);
  });

  it("falls back on the icons the home page names, and never takes an SVG", async () => {
    const w = web({
      "https://news.example/favicon.ico": { type: "text/html", body: "<!doctype html><p>Not found</p>" },
      "https://news.example/": { type: "text/html", body: `<link rel="icon" href="/a.svg"><link rel="icon" sizes="32x32" href="/i/32.png">` },
      "https://news.example/i/32.png": { type: "image/png", body: PNG },
    });
    expect((await faviconFor("news.example", { transport: w.transport, dir }))?.type).toBe("image/png");
    expect(w.asked).not.toContain("https://news.example/a.svg");
  });

  it("remembers a site with no icon for a few days, then asks again", async () => {
    const w = web({});
    expect(await faviconFor("bare.example", { transport: w.transport, dir })).toBeNull();
    expect(await faviconFor("bare.example", { transport: w.transport, dir })).toBeNull();
    expect(w.asked).toEqual(["https://bare.example/favicon.ico", "https://bare.example/"]);
    const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await utimes(path.join(dir, "bare.example"), old, old);
    await faviconFor("bare.example", { transport: w.transport, dir });
    expect(w.asked).toHaveLength(4);
  });

  it("asks nothing for a name that isn't a site's", async () => {
    const w = web({});
    expect(await faviconFor("../secrets", { transport: w.transport, dir })).toBeNull();
    expect(await faviconFor("localhost", { transport: w.transport, dir })).toBeNull();
    expect(w.asked).toEqual([]);
  });
});
