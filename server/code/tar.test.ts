import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCodeFiles } from "./copy";
import { entryPath, keepPath, untarInto } from "./tar";

/** A ustar header and its content, padded to 512 bytes. */
function entry(name: string, body: string | Buffer, type = "0", link = ""): Buffer {
  const data = typeof body === "string" ? Buffer.from(body) : body;
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write(type, 156);
  h.write(link, 157);
  h.write("ustar\0", 257);
  h.write("00", 263);
  // The checksum, over the header with its own field as spaces.
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const pax = (records: Record<string, string>, type: "x" | "g") => {
  const body = Object.entries(records)
    .map(([k, v]) => {
      const rest = ` ${k}=${v}\n`;
      let len = rest.length + 2;
      if (String(len).length + rest.length !== len) len = String(len + 1).length + rest.length;
      return `${len}${rest}`;
    })
    .join("");
  return entry(type === "g" ? "pax_global_header" : "PaxHeader", body, type);
};
const tarball = (...parts: Buffer[]) => gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), "qalam-tar-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("a repository's tarball, unpacked safely", () => {
  it("keeps code under the top folder only: nothing outside it, no links, nothing vendored, built or binary", async () => {
    const tgz = tarball(
      pax({ comment: "abc1234def5678" }, "g"),
      entry("acme-basket-abc1234/app/page.tsx", 'export default function Home() { posthog.capture("home_viewed") }'),
      entry("acme-basket-abc1234/../../evil.ts", "pwned"),
      entry("/etc/passwd.ts", "pwned"),
      entry("acme-basket-abc1234/link.ts", "", "2", "/etc/passwd"),
      entry("acme-basket-abc1234/node_modules/x/index.js", "vendored"),
      entry("acme-basket-abc1234/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
      entry("acme-basket-abc1234/bin.ts", Buffer.from([0x41, 0, 0x42])),
      pax({ path: `acme-basket-abc1234/src/${"deep/".repeat(30)}long.ts` }, "x"),
      entry("acme-basket-abc1234/short-name-replaced.ts", "export const deep = 1"),
    );
    const got = await untarInto(Readable.from([tgz.subarray(0, 300), tgz.subarray(300)]), path.join(dir, "copy"));
    expect(got).toMatchObject({ files: 2, commit: "abc1234def5678" });
    const files = await readCodeFiles(path.join(dir, "copy"));
    expect(files.map((f) => f.path)).toEqual(["app/page.tsx", `src/${"deep/".repeat(30)}long.ts`]);
    expect(await readdir(dir)).toEqual(["copy"]);
    expect(await readFile(path.join(dir, "copy", "app", "page.tsx"), "utf8")).toContain("home_viewed");
  });

  it("reads an entry's path without its top folder, and refuses one that climbs out", () => {
    expect(entryPath("acme-basket-abc/app/page.tsx")).toBe("app/page.tsx");
    expect(entryPath("acme-basket-abc/./a/../b.ts")).toBeNull();
    expect(entryPath("top-only")).toBeNull();
    expect(entryPath("/etc/passwd.ts")).toBeNull();
    expect(entryPath("acme/C:/x.ts")).toBeNull();
    expect(keepPath("app/page.tsx")).toBe(true);
    expect(keepPath("dist/app.js")).toBe(false);
    expect(keepPath("pnpm-lock.yaml")).toBe(false);
    expect(keepPath("public/app.min.js")).toBe(false);
    expect(keepPath("assets/photo.jpg")).toBe(false);
  });
});
