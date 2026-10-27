import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetPath, contentSecurityPolicy, inlineScriptHashes, mimeOf } from "./assets";

const dist = path.resolve("/app/dist");
const files = new Set(["index.html", "assets/index-abc.js", "assets/canvaskit-x.wasm", "fonts/Inter-400.ttf"].map((f) => path.join(dist, f)));
const isFile = (p: string) => files.has(p);

describe("assetPath", () => {
  it("serves files in dist", () => {
    expect(assetPath(dist, "/assets/index-abc.js", isFile)).toBe(path.join(dist, "assets/index-abc.js"));
    expect(assetPath(dist, "/fonts/Inter-400.ttf", isFile)).toBe(path.join(dist, "fonts/Inter-400.ttf"));
  });

  it("serves the app for page addresses", () => {
    expect(assetPath(dist, "/", isFile)).toBe(path.join(dist, "index.html"));
    expect(assetPath(dist, "/d/abc123def0", isFile)).toBe(path.join(dist, "index.html"));
  });

  it("refuses missing assets and broken paths", () => {
    expect(assetPath(dist, "/assets/missing.js", isFile)).toBeNull();
    expect(assetPath(dist, "/%E0%A4%A", isFile)).toBeNull();
    expect(assetPath(dist, "/a%00.js", isFile)).toBeNull();
  });

  it("never serves anything outside dist", () => {
    const outside = new Set([path.resolve("/app/secret.txt"), path.resolve("/etc/passwd")]);
    const anyFile = (p: string) => files.has(p) || outside.has(p);
    for (const attempt of ["/../secret.txt", "/%2e%2e/secret.txt", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../secret.txt", "/..%2f..%2fetc%2fpasswd"]) {
      const file = assetPath(dist, attempt, anyFile);
      expect(file === null || file.startsWith(dist + path.sep), attempt).toBe(true);
    }
  });
});

describe("mimeOf", () => {
  it("names wasm exactly, so CanvasKit compiles while it downloads", () => {
    expect(mimeOf("x/canvaskit.wasm")).toBe("application/wasm");
    expect(mimeOf("x/index.html")).toMatch(/^text\/html/);
    expect(mimeOf("x/unknown.bin")).toBe("application/octet-stream");
  });
});

describe("content security policy", () => {
  it("allows exactly the page's inline scripts", () => {
    const boot = "try{document.documentElement.dataset.theme='dark'}catch(e){}";
    const html = `<head><script>${boot}</script><script type="module" src="/assets/index.js"></script></head>`;
    const hashes = inlineScriptHashes(html);
    expect(hashes).toEqual([`sha256-${createHash("sha256").update(boot).digest("base64")}`]);
    const csp = contentSecurityPolicy(hashes);
    expect(csp).toContain(`'${hashes[0]}'`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-inline' 'self'");
    expect(csp.split("; ").find((d) => d.startsWith("script-src"))).not.toContain("unsafe-inline");
  });
});
