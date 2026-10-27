import { describe, expect, it } from "vitest";
import { checkRequest, localHost, tokenCookie, tokenLanding, type RequestFacts } from "./guard";

const cfg = { port: 3101 };
const get = (over: Partial<RequestFacts> = {}): RequestFacts => ({ method: "GET", host: "127.0.0.1:3101", origin: null, cookie: null, tokenHeader: null, ...over });

describe("local hosts", () => {
  it("accepts this machine on this port", () => {
    expect(localHost("127.0.0.1:3101", cfg)).toBe(true);
    expect(localHost("localhost:3101", cfg)).toBe(true);
    expect(localHost("[::1]:3101", cfg)).toBe(true);
  });

  it("refuses other names, other ports and rebinding hosts", () => {
    expect(localHost("evil.com:3101", cfg)).toBe(false);
    expect(localHost("127.0.0.1:3000", cfg)).toBe(false);
    expect(localHost("127.0.0.1", cfg)).toBe(false);
    expect(localHost("localhost.evil.com:3101", cfg)).toBe(false);
    expect(localHost(null, cfg)).toBe(false);
  });

  it("accepts *.localhost only when subdomains are on", () => {
    expect(localHost("org-test.localhost:3101", cfg)).toBe(false);
    expect(localHost("org-test.localhost:3101", { ...cfg, subdomains: true })).toBe(true);
    expect(localHost("evil.com.localhost:3101", { ...cfg, subdomains: true })).toBe(true);
    expect(localHost("localhost.evil.com:3101", { ...cfg, subdomains: true })).toBe(false);
  });
});

describe("checkRequest", () => {
  it("lets reads through from this machine", () => {
    expect(checkRequest(get(), cfg)).toEqual({ ok: true });
  });

  it("refuses writes from another origin, or with none", () => {
    expect(checkRequest(get({ method: "POST", origin: "http://127.0.0.1:3101" }), cfg)).toEqual({ ok: true });
    expect(checkRequest(get({ method: "POST", origin: "https://evil.com" }), cfg).ok).toBe(false);
    expect(checkRequest(get({ method: "POST", origin: null }), cfg).ok).toBe(false);
    // Same host, other port: still another origin.
    expect(checkRequest(get({ method: "PUT", origin: "http://127.0.0.1:3000" }), cfg).ok).toBe(false);
  });

  it("refuses a rebinding host even with a matching origin", () => {
    expect(checkRequest(get({ method: "POST", host: "evil.com:3101", origin: "http://evil.com:3101" }), cfg).ok).toBe(false);
  });

  it("asks for the launch token when one is set", () => {
    const t = { ...cfg, token: "s3cret" };
    expect(checkRequest(get(), t).ok).toBe(false);
    expect(checkRequest(get({ cookie: `other=1; ${tokenCookie(3101)}=s3cret` }), t)).toEqual({ ok: true });
    expect(checkRequest(get({ tokenHeader: "s3cret" }), t)).toEqual({ ok: true });
    expect(checkRequest(get({ cookie: `${tokenCookie(3000)}=s3cret` }), t).ok).toBe(false);
  });
});

describe("tokenLanding", () => {
  const t = { ...cfg, token: "s3cret" };

  it("keeps the token in a cookie and drops it from the address", () => {
    const landing = tokenLanding(new URL("http://127.0.0.1:3101/d/abc123?t=s3cret&card=x"), t);
    expect(landing?.location).toBe("/d/abc123?card=x");
    expect(landing?.setCookie).toMatch(/^qalam_t_3101=s3cret; Path=\/; HttpOnly; SameSite=Strict$/);
  });

  it("does nothing for a wrong token, or with no token set", () => {
    expect(tokenLanding(new URL("http://127.0.0.1:3101/?t=nope"), t)).toBeNull();
    expect(tokenLanding(new URL("http://127.0.0.1:3101/?t=s3cret"), cfg)).toBeNull();
  });
});
