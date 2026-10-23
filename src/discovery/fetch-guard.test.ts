import { describe, expect, it } from "vitest";
import type { LookupAddress } from "node:dns";
import { FetchRefused, fetchGuarded, guardedLookup, type Hop, type Transport } from "./fetch-guard";

/** A fake server: each URL answers as listed (a redirect, a page), and every request is recorded. */
function fake(routes: Record<string, { status: number; location?: string; type?: string; body?: string | Uint8Array[] }>) {
  const asked: string[] = [];
  let closed = 0;
  const transport: Transport = async (url) => {
    asked.push(url.href);
    const r = routes[url.href];
    if (!r) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const chunks = typeof r.body === "string" ? [new TextEncoder().encode(r.body)] : (r.body ?? []);
    const hop: Hop = {
      status: r.status,
      headers: { ...(r.location ? { location: r.location } : {}), ...(r.type ? { "content-type": r.type } : {}) },
      body: (async function* () {
        yield* chunks;
      })(),
      close: () => void closed++,
    };
    return hop;
  };
  return { transport, asked, closed: () => closed };
}

const refused = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof FetchRefused ? e.code : `other: ${(e as Error).message}`;
  }
  return "fetched";
};

describe("fetchGuarded", () => {
  it("follows redirects to public pages and says where it ended up", async () => {
    const f = fake({
      "https://short.example/x": { status: 301, location: "https://blog.example/post" },
      "https://blog.example/post": { status: 302, location: "/post/final" },
      "https://blog.example/post/final": { status: 200, type: "text/html; charset=utf-8", body: "<p>Hello</p>" },
    });
    const page = await fetchGuarded("https://short.example/x", { transport: f.transport });
    expect(page.url).toBe("https://blog.example/post/final");
    expect(new TextDecoder().decode(page.body)).toBe("<p>Hello</p>");
    expect(page.contentType).toBe("text/html; charset=utf-8");
    expect(f.asked).toHaveLength(3);
  });

  it("checks every redirect: never to a private address, a local name, another scheme or port", async () => {
    for (const location of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://localhost:3000/", "http://[::1]/", "file:///etc/passwd", "https://example.org:8443/", "http://10.0.0.5/"]) {
      const f = fake({ "https://public.example/": { status: 302, location } });
      expect(await refused(fetchGuarded("https://public.example/", { transport: f.transport })), location).toBe("blocked");
      // Refused before any request was made to it.
      expect(f.asked).toEqual(["https://public.example/"]);
    }
  });

  it("refuses a private address before asking anything", async () => {
    const f = fake({});
    expect(await refused(fetchGuarded("http://192.168.0.1/router", { transport: f.transport }))).toBe("blocked");
    expect(f.asked).toEqual([]);
  });

  it("stops after five redirects", async () => {
    const routes: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i < 8; i++) routes[`https://loop.example/${i}`] = { status: 302, location: `https://loop.example/${i + 1}` };
    expect(await refused(fetchGuarded("https://loop.example/0", { transport: fake(routes).transport }))).toBe("redirects");
  });

  it("reads at most the byte cap and says the rest was cut", async () => {
    const big = Array.from({ length: 5 }, () => new Uint8Array(1000).fill(97));
    const page = await fetchGuarded("https://big.example/", { transport: fake({ "https://big.example/": { status: 200, type: "text/plain", body: big } }).transport, limits: { bytes: 2500 } });
    expect(page.body.byteLength).toBe(2500);
    expect(page.truncated).toBe(true);
    const small = await fetchGuarded("https://big.example/", { transport: fake({ "https://big.example/": { status: 200, type: "text/plain", body: big.slice(0, 2) } }).transport, limits: { bytes: 2500 } });
    expect(small.truncated).toBe(false);
  });

  it("refuses error pages, media, and a Google Doc that asks to sign in", async () => {
    expect(await refused(fetchGuarded("https://x.example/", { transport: fake({ "https://x.example/": { status: 404 } }).transport }))).toBe("http");
    expect(await refused(fetchGuarded("https://x.example/", { transport: fake({ "https://x.example/": { status: 200, type: "video/mp4" } }).transport }))).toBe("unsupported");
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const f = fake({ [`https://docs.google.com/document/d/${id}/export?format=txt`]: { status: 302, location: "https://accounts.google.com/ServiceLogin?continue=x" } });
    expect(await refused(fetchGuarded(`https://docs.google.com/document/d/${id}/edit`, { transport: f.transport }))).toBe("private_doc");
    expect(f.asked[0]).toBe(`https://docs.google.com/document/d/${id}/export?format=txt`);
  });

  it("says when a page can't be reached", async () => {
    expect(await refused(fetchGuarded("https://nowhere.example/", { transport: fake({}).transport }))).toBe("unreachable");
  });
});

describe("guardedLookup", () => {
  const resolver = (addresses: LookupAddress[]) => (_host: string, _o: { all: true }, cb: (err: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) => cb(null, addresses);
  const lookup = (addresses: LookupAddress[], options: { all?: boolean; family?: number } = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      guardedLookup(resolver(addresses))("site.example", options as never, (err, address, family) => resolve({ err, address, family })),
    );

  it("lets a socket connect to public addresses only", async () => {
    const pub = await lookup([{ address: "93.184.216.34", family: 4 }]);
    expect(pub.err).toBeNull();
    expect(pub.address).toBe("93.184.216.34");
    const all = await lookup([{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }], { all: true });
    expect(all.address).toHaveLength(2);
  });

  it("refuses a name that resolves to a private address, even alongside a public one (DNS rebinding)", async () => {
    expect((await lookup([{ address: "127.0.0.1", family: 4 }])).err?.code).toBe("EBLOCKED");
    expect((await lookup([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.2", family: 4 }])).err?.code).toBe("EBLOCKED");
    expect((await lookup([{ address: "::ffff:169.254.169.254", family: 6 }])).err?.code).toBe("EBLOCKED");
    expect((await lookup([])).err?.code).toBe("EBLOCKED");
  });

  it("answers in the family the socket asked for", async () => {
    const v6 = await lookup([{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }], { family: 6 });
    expect(v6.address).toBe("2606:2800:220:1::1");
    expect(v6.family).toBe(6);
  });
});
