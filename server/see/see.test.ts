import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { diagnose, type HealthFacts } from "@/health/doctor";
import { drawPdfPages, prepShot, readRegions, readShots, seeAvailable } from ".";

// A stand-in for native/see: answers check, and reads each file as one line named after it, or
// says it can't read one named "broken…". Each run's arguments go to FAKE_SEE_LOG.
const HELPER = `#!/usr/bin/env node
const fs = require("node:fs");
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const [cmd, ...files] = process.argv.slice(2);
if (process.env.FAKE_SEE_LOG) fs.appendFileSync(process.env.FAKE_SEE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (cmd === "check") { say({ ok: true, languages: ["en-US", "ar-SA"] }); process.exit(0); }
if (cmd === "read") {
  for (const file of files) {
    const name = require("node:path").basename(file);
    if (name.startsWith("broken")) say({ file, error: "This Mac can't open it as a picture." });
    else say({ file, w: 1179, h: 2556, dhash: "c080018b010000b4", lines: [{ text: name, box: [0.05, 0.03, 0.3, 0.03], conf: 1 }, { text: "سلة التسوق", box: [0.85, 0.24, 0.11, 0.02], conf: 1 }] });
  }
  process.exit(0);
}
if (cmd === "regions") {
  for (const box of files.slice(1)) say(box === "9,9,9,9" ? { box, error: "Not a box." } : { box: box.split(",").map(Number), lines: [{ text: "4.1%", box: [0.2, 0.3, 0.05, 0.01], conf: 1 }, { text: "unsure", box: "nope", conf: 1 }] });
  process.exit(0);
}
if (cmd === "pdf") {
  const [, out, , ...pages] = files;
  for (const page of pages) say(page === "9" ? { page: 9, error: "It has no such page." } : { page: Number(page), file: require("node:path").join(out, "page-" + page + ".png"), w: 10, h: 10 });
  process.exit(0);
}
process.stderr.write("usage\\n");
process.exit(2);
`;

let dir: string;
let org: string;
let bin: string;
let log: string;
const ICON = fileURLToPath(new URL("../../build/icon.png", import.meta.url));

/** The reader's runs since the test began. */
const runs = async () => (existsSync(log) ? (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-see-"));
  bin = path.join(dir, "qalam-see");
  await writeFile(bin, HELPER);
  await chmod(bin, 0o755);
  log = path.join(dir, "runs.jsonl");
  process.env.FAKE_SEE_LOG = log;
  process.env.QALAM_SEE_BIN = bin;
});

beforeEach(async () => {
  process.env.QALAM_SEE_BIN = bin;
  org = await mkdtemp(path.join(dir, "org-"));
  await rm(log, { force: true });
});

afterAll(async () => {
  delete process.env.QALAM_SEE_BIN;
  delete process.env.FAKE_SEE_LOG;
  await rm(dir, { recursive: true, force: true });
});

// Its stand-in is a script with a shebang, which Windows can't start.
describe.skipIf(process.platform === "win32")("reading the words on screenshots", () => {
  it("says whether this Mac has the reader", async () => {
    expect(await seeAvailable()).toBe(true);
    process.env.QALAM_SEE_BIN = path.join(dir, "nowhere");
    expect(await seeAvailable()).toBe(false);
  });

  it("reads what isn't kept yet in one run, keeps it, and reads it from what's kept after", async () => {
    const first = await readShots(org, [
      { hash: "aaa111", file: path.join(dir, "basket.png") },
      { hash: "bbb222", file: path.join(dir, "checkout.png") },
    ]);
    expect(first.get("aaa111")).toEqual({
      w: 1179,
      h: 2556,
      dhash: "c080018b010000b4",
      lines: [
        { text: "basket.png", box: [0.05, 0.03, 0.3, 0.03], conf: 1 },
        { text: "سلة التسوق", box: [0.85, 0.24, 0.11, 0.02], conf: 1 },
      ],
    });
    expect(first.get("bbb222")?.lines[0].text).toBe("checkout.png");
    expect(await runs()).toEqual([["read", path.join(dir, "basket.png"), path.join(dir, "checkout.png")]]);
    expect((await readdir(path.join(org, ".qalam", "seen", "text"))).sort()).toEqual(["aaa111.json", "bbb222.json"]);

    await rm(log);
    const again = await readShots(org, [
      { hash: "aaa111", file: path.join(dir, "basket.png") },
      { hash: "ccc333", file: path.join(dir, "address.png") },
      { hash: "aaa111", file: path.join(dir, "basket.png") },
    ]);
    expect(again.get("aaa111")).toEqual(first.get("aaa111"));
    expect(again.get("ccc333")?.lines[0].text).toBe("address.png");
    // Only what wasn't kept goes to the reader, once.
    expect(await runs()).toEqual([["read", path.join(dir, "address.png")]]);
  });

  it("reads again what an older reader kept", async () => {
    await readShots(org, [{ hash: "aaa111", file: path.join(dir, "basket.png") }]);
    const kept = path.join(org, ".qalam", "seen", "text", "aaa111.json");
    await writeFile(kept, JSON.stringify({ ...JSON.parse(await readFile(kept, "utf8")), v: 0, lines: [] }));
    await rm(log);
    expect((await readShots(org, [{ hash: "aaa111", file: path.join(dir, "basket.png") }])).get("aaa111")?.lines).toHaveLength(2);
    expect(await runs()).toHaveLength(1);
  });

  it("gives null for a file it can't read, and keeps nothing for it", async () => {
    const got = await readShots(org, [
      { hash: "bad999", file: path.join(dir, "broken.png") },
      { hash: "aaa111", file: path.join(dir, "basket.png") },
    ]);
    expect(got.get("bad999")).toBeNull();
    expect(got.get("aaa111")?.dhash).toBe("c080018b010000b4");
    expect(await readdir(path.join(org, ".qalam", "seen", "text"))).toEqual(["aaa111.json"]);
  });

  it("gives null for each when the reader isn't here, and nothing for a picture's name that climbs out", async () => {
    process.env.QALAM_SEE_BIN = path.join(dir, "nowhere");
    const got = await readShots(org, [{ hash: "aaa111", file: path.join(dir, "basket.png") }]);
    expect([...got]).toEqual([["aaa111", null]]);
    process.env.QALAM_SEE_BIN = bin;
    const odd = await readShots(org, [{ hash: "../../x", file: path.join(dir, "basket.png") }]);
    expect(odd.get("../../x")?.lines[0].text).toBe("basket.png");
    expect(existsSync(path.join(org, ".qalam", "seen", "text"))).toBe(false);
  });

  it("says in This Mac's health when the reader isn't here, and is quiet when it is", async () => {
    const fine: HealthFacts = { engine: { kind: "cli", ready: true, word: "Ready" }, search: { ok: true, node: "24.22.0" }, models: { status: "ready" }, inbox: null };
    expect(diagnose({ ...fine, see: { here: await seeAvailable() } })).toEqual([{ id: "all", dot: "ok", label: "This computer", word: "All good" }]);
    process.env.QALAM_SEE_BIN = path.join(dir, "nowhere");
    const [row] = diagnose({ ...fine, see: { here: await seeAvailable() } });
    expect(row).toMatchObject({ id: "see", dot: "off", label: "Reading words on screenshots", word: "Not on this Mac" });
    expect(row.detail).toContain("aren't checked");
  });
});

describe("a PDF's pages", () => {
  it("draws the pages it can, by page number", async () => {
    const got = await drawPdfPages(path.join(dir, "doc.pdf"), dir, 2200, [2, 9]);
    expect([...got.keys()]).toEqual([2]);
    expect(got.get(2)?.file).toBe(path.join(dir, "page-2.png"));
    const last = (await runs()).at(-1)!;
    expect(last.slice(0, 1).concat(last.slice(3))).toEqual(["pdf", "2200", "2", "9"]);
  });

  it("reads each box on its own, keeping only the lines it can use", async () => {
    const got = await readRegions(path.join(dir, "page.png"), [[0.1, 0.2, 0.3, 0.4], [9, 9, 9, 9]]);
    expect(got).toEqual([[{ text: "4.1%", box: [0.2, 0.3, 0.05, 0.01], conf: 1 }]]);
  });

  it("does nothing with no reader here", async () => {
    process.env.QALAM_SEE_BIN = path.join(dir, "nowhere");
    expect((await drawPdfPages("x.pdf", dir, 100, [1])).size).toBe(0);
    expect(await readRegions("x.png", [[0, 0, 1, 1]])).toEqual([]);
    process.env.QALAM_SEE_BIN = bin;
  });
});

describe.skipIf(process.platform === "win32")("the copies Qalam AI is sent", () => {
  it("sends the original when sips can't read it", async () => {
    const notes = path.join(dir, "notes.txt");
    await writeFile(notes, "not a picture");
    expect(await prepShot(org, "ddd444", notes, 768, "jpeg")).toEqual({ file: notes, type: "application/octet-stream" });
    expect(existsSync(path.join(org, ".qalam", "seen", "prep", "ddd444-768.jpg"))).toBe(false);
  });

  it.runIf(process.platform === "darwin")("makes a smaller copy once, and sends a picture already small as it is", async () => {
    const shot = path.join(dir, "icon.png");
    await copyFile(ICON, shot);
    const small = await prepShot(org, "eee555", shot, 256, "jpeg");
    expect(small).toEqual({ file: path.join(org, ".qalam", "seen", "prep", "eee555-256.jpg"), type: "image/jpeg" });
    expect(execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "format", small.file], { encoding: "utf8" })).toMatch(/pixelWidth: 256[\s\S]*format: jpeg/);
    const made = (await stat(small.file)).mtimeMs;
    expect(await prepShot(org, "eee555", shot, 256, "jpeg")).toEqual(small);
    expect((await stat(small.file)).mtimeMs).toBe(made);
    // 1024 px is within 1568: as PNG it goes as it is, never enlarged.
    expect(await prepShot(org, "eee555", shot, 1568, "png")).toEqual({ file: shot, type: "image/png" });
    expect(await readdir(path.join(org, ".qalam", "seen", "prep"))).toEqual(["eee555-256.jpg"]);
  });
});

// The real reader, where this Mac built it (pnpm build:see).
const REAL = [fileURLToPath(new URL("../../native/see/.build/release/qalam-see", import.meta.url)), fileURLToPath(new URL("../../out/qalam-see", import.meta.url))].find((p) => existsSync(p));

describe.runIf(REAL)("this Mac's reader", () => {
  it("reads a picture's size and hash", async () => {
    process.env.QALAM_SEE_BIN = REAL;
    const read = (await readShots(org, [{ hash: "icon", file: ICON }])).get("icon");
    expect(read).toMatchObject({ w: 1024, h: 1024, dhash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(Array.isArray(read?.lines)).toBe(true);
  }, 60_000);

  it("draws a PDF's page, turned as it's meant to be read, and reads its words, whole and in a box", async () => {
    process.env.QALAM_SEE_BIN = REAL;
    const content = "BT /F1 40 Tf 72 700 Td (Churn rose) Tj ET";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let pdf = "%PDF-1.4\n";
    const at = objs.map((o, i) => {
      const here = pdf.length;
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
      return here;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = path.join(dir, "real.pdf");
    await writeFile(file, pdf, "latin1");
    const page = (await drawPdfPages(file, dir, 1200, [1, 2])).get(1)!;
    const read = (await readShots(org, [{ hash: "realpdf", file: page.file }])).get("realpdf");
    // Rotated a quarter turn: wider than it's tall, and its words upright.
    expect(read).toMatchObject({ w: 1200, h: expect.any(Number) });
    expect(read!.h).toBeLessThan(read!.w);
    expect(read!.lines.map((l) => l.text).join(" ")).toContain("Churn rose");
    const box = read!.lines[0].box;
    const [inBox] = await readRegions(page.file, [[Math.max(0, box[0] - 0.02), Math.max(0, box[1] - 0.02), box[2] + 0.04, box[3] + 0.04]]);
    expect(inBox[0].text).toContain("Churn");
    // Placed on the whole page, close to where the whole page's reading has it.
    expect(Math.abs(inBox[0].box[0] - box[0])).toBeLessThan(0.02);
  }, 60_000);
});
