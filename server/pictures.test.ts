import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShotLine } from "@/seen/shot";
import { ingestPath } from "./ingest";
import { OrgStore } from "./org/store";
import { NO_READER, readPdfPictures, type PictureDeps } from "./pictures";

/**
 * A PDF built by hand, whose pages are `content` streams over one small picture and Helvetica. A
 * page's `Do` draws the picture, stretched as its `cm` says.
 */
function pdf(contents: string[]): Buffer {
  const image = "\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff";
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const first = 5;
  const kids = contents.map((_, i) => `${first + i * 2} 0 R`).join(" ");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objs.push(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n${image}\nendstream`);
  contents.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${first + i * 2 + 1} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 4 0 R >> >> >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const text = (s: string, y = 720) => `BT /F1 12 Tf 72 ${y} Td (${s}) Tj ET`;
const picture = (w = 400, h = 300) => `q ${w} 0 0 ${h} 72 300 cm /Im0 Do Q`;
const fullPage = "q 612 0 0 792 0 0 cm /Im0 Do Q";
const LONG = "This page has plenty of words in its text, so it is no scan of any kind at all.";
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const line = (t: string, box: [number, number, number, number] = [0.1, 0.1, 0.2, 0.02]): ShotLine => ({ text: t, box, conf: 1 });

/** A chart's words, a scale down the side and one printed bar. */
const CHART = [line("Churn by month", [0.2, 0.27, 0.3, 0.02]), line("6%", [0.15, 0.3, 0.03, 0.01]), line("4%", [0.15, 0.35, 0.03, 0.01]), line("2%", [0.15, 0.4, 0.03, 0.01]), line("4.1%", [0.3, 0.33, 0.03, 0.01]), line("Jan", [0.3, 0.47, 0.03, 0.01]), line("Apr", [0.5, 0.47, 0.03, 0.01])];

let dir: string;
let store: OrgStore;
let call: ReturnType<typeof vi.fn>;

/** Stand-ins for the reader and the engine; `lines` is what each page prints, by page. */
function deps(lines: Record<number, ShotLine[]>, over: Partial<PictureDeps> = {}): PictureDeps {
  return {
    reader: async () => true,
    sees: () => true,
    draw: async (_file, out, _side, pages) => {
      const m = new Map<number, { file: string }>();
      for (const p of pages) {
        const file = path.join(out, `page-${p}.png`);
        await writeFile(file, `page ${p}`);
        m.set(p, { file });
      }
      return m;
    },
    words: async (_org, shots) => new Map(shots.map((s) => [s.hash, { w: 1000, h: 1400, dhash: "0000000000000000", lines: lines[Number(/page-(\d+)/.exec(s.file)?.[1])] ?? [] }])),
    regions: async () => [],
    prep: async (_org, _hash, file) => ({ file, type: "image/jpeg" }),
    call: call as unknown as PictureDeps["call"],
    ...over,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-pictures-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  store = await OrgStore.create(path.join(await mkdtemp(path.join(dir, "org-")), "Personal"), { id: "org1", name: "Personal", createdAt: 1 });
  call = vi.fn();
});
afterEach(() => {
  store.dispose();
});

describe("reading a PDF's pictures", () => {
  it("leaves a PDF with no pictures as it was, with no reader run and no call", async () => {
    const draw = vi.fn();
    const r = await readPdfPictures(store, buf(pdf([text(LONG)])), {}, deps({}, { draw }));
    expect(r.text).toBe(LONG);
    expect(r.pictures).toBeUndefined();
    expect(draw).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps a chart's printed numbers and leaves out the rest, joined at the end of its page", async () => {
    call.mockResolvedValue({
      data: {
        pages: [
          {
            id: "p1",
            figures: [
              {
                kind: "chart",
                title: "Churn by month",
                rows: [
                  { labels: [{ name: "", value: "Jan" }], numbers: [{ name: "", value: "4.1%" }], from_shape: false },
                  { labels: [{ name: "", value: "Apr" }], numbers: [{ name: "", value: "6%" }], from_shape: false },
                  { labels: [{ name: "", value: "Apr" }], numbers: [{ name: "", value: "4.7%" }], from_shape: true },
                ],
              },
            ],
          },
        ],
      },
    });
    const r = await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`, text("Second page.")])), {}, deps({ 1: CHART }));
    expect(r.text).toBe(`${LONG}\n\nChart on page 1: Churn by month\n\nChurn by month · Jan · 4.1%\n\nSecond page.`);
    expect(r.pages).toEqual([0, r.text.indexOf("Second page.")]);
    expect(r.pictures?.read).toHaveLength(1);
    expect(r.pictures?.read[0]).toMatchObject({ page: 1, kind: "chart" });
    expect(r.pictures?.read[0].left).toEqual([{ words: "6%", why: "scale" }, { words: "Apr · 4.7%", why: "shape" }]);
    // The page sent as a picture, its printed words beside it.
    const [{ content, kind }] = call.mock.calls[0] as [{ content: { type: string; text?: string }[]; kind: string }];
    expect(kind).toBe("pdf-pictures");
    expect(content.map((b) => b.type)).toEqual(["text", "image", "text", "text"]);
    expect(content[2].text).toContain("4.1%");
    // Its page kept to compare with.
    expect(store.getAsset(r.pictures!.read[0].asset!)).toBeTruthy();
  });

  it("costs nothing the second time: the reading is kept by the PDF's content", async () => {
    call.mockResolvedValue({ data: { pages: [{ id: "p1", figures: [] }] } });
    const file = buf(pdf([`${text(LONG)} ${picture()}`]));
    const d = deps({ 1: CHART });
    const first = await readPdfPictures(store, file.slice(0), {}, d);
    const second = await readPdfPictures(store, file.slice(0), {}, d);
    expect(second).toEqual(first);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("a photo that prints nothing is never sent", async () => {
    const r = await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), {}, deps({ 1: [] }));
    expect(call).not.toHaveBeenCalled();
    expect(r.text).toBe(LONG);
    expect(r.pictures).toBeUndefined();
  });

  it("reads a scan's words with no call, and its rows of numbers with one", async () => {
    const prose = [line("Exit survey", [0.1, 0.1, 0.3, 0.04]), line("214 customers answered, out of 560 who cancelled.", [0.1, 0.2, 0.8, 0.02])];
    const r = await readPdfPictures(store, buf(pdf([fullPage])), {}, deps({ 1: prose }));
    expect(call).not.toHaveBeenCalled();
    expect(r.text).toBe("Exit survey\n\n214 customers answered, out of 560 who cancelled.");
    expect(r.blocks).toEqual([{ span: [0, 11], kind: "h1" }]);
    expect(r.pictures?.read).toMatchObject([{ page: 1, kind: "scan", span: [0, r.text.length] }]);

    call.mockResolvedValue({ data: { pages: [{ id: "p1", figures: [{ kind: "table", title: "", rows: [{ labels: [{ name: "", value: "Price" }], numbers: [{ name: "", value: "81" }], from_shape: false }] }] }] } });
    const rows = [...prose, line("Price 81", [0.1, 0.3, 0.2, 0.02]), line("Setup 47", [0.1, 0.33, 0.2, 0.02]), line("Other 39", [0.1, 0.36, 0.2, 0.02])];
    const s = await readPdfPictures(store, buf(pdf([`${fullPage} `])), {}, deps({ 1: rows }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(s.text).toContain("Table on page 1\n\nPrice · 81");
  });

  it("with no reader here (off a Mac) it reads the text and says which pictures weren't read", async () => {
    const r = await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), {}, deps({}, { reader: async () => false }));
    expect(r.text).toBe(LONG);
    expect(r.pictures).toEqual({ read: [], unread: [{ pages: [1], why: "no-reader" }] });
    expect(call).not.toHaveBeenCalled();
  });

  it("with no reader here a scan is turned away, saying why", async () => {
    await expect(readPdfPictures(store, buf(pdf([fullPage])), {}, deps({}, { reader: async () => false }))).rejects.toThrow(NO_READER);
  });

  it("an engine that can't see gets no call: the picture's printed words stay, unpaired", async () => {
    const r = await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), {}, deps({ 1: CHART }, { sees: () => false }));
    expect(call).not.toHaveBeenCalled();
    expect(r.text).toContain("Printed in a picture on page 1\n\nChurn by month\n\n6%");
    expect(r.pictures?.unread).toEqual([{ pages: [1], why: "no-vision" }]);
  });

  it("a seal's words aren't kept when nothing paired them: only what holds a number is", async () => {
    const seal = [line("BOARD OF GOVERNORS OF THE RESERVE", [0.2, 0.3, 0.5, 0.03])];
    const r = await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), {}, deps({ 1: seal }, { sees: () => false }));
    expect(r.text).toBe(LONG);
  });

  it("an engine that turns a picture away stops being asked, and the document still reads", async () => {
    call.mockRejectedValue(new Error("llava can't read pictures. Pick a model that can, in Connections."));
    const pages = Array.from({ length: 6 }, () => `${text(LONG)} ${picture()}`);
    const r = await readPdfPictures(store, buf(pdf(pages)), {}, deps(Object.fromEntries(pages.map((_, i) => [i + 1, CHART]))));
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.pictures?.unread).toEqual([{ pages: [1, 2, 3, 4, 5, 6], why: "no-vision" }]);
  });

  it("a call that fails leaves the page's printed words, and isn't kept for next time", async () => {
    call.mockRejectedValueOnce(new Error("overloaded")).mockResolvedValue({ data: { pages: [{ id: "p1", figures: [] }] } });
    const file = buf(pdf([`${text(LONG)} ${picture()}`]));
    const r = await readPdfPictures(store, file.slice(0), {}, deps({ 1: CHART }));
    expect(r.pictures?.unread).toEqual([{ pages: [1], why: "failed" }]);
    expect(r.text).toContain("Printed in a picture on page 1");
    await readPdfPictures(store, file.slice(0), {}, deps({ 1: CHART }));
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("stopping stops it", async () => {
    const stop = new AbortController();
    call.mockImplementation(async () => {
      stop.abort();
      throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    });
    await expect(readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), { signal: stop.signal }, deps({ 1: CHART }))).rejects.toThrow("Stopped");
  });

  it("clears what it drew", async () => {
    await readPdfPictures(store, buf(pdf([`${text(LONG)} ${picture()}`])), {}, deps({ 1: [] }));
    const kept = path.join(store.dir, ".qalam", "pictures");
    expect(existsSync(kept) ? (await readdir(kept)).filter((f) => f.startsWith(".drawing")) : []).toEqual([]);
  });
});

describe("reading a file in the core", () => {
  it("with the lab off a scan is turned away as ever", async () => {
    const old = process.env.QALAM_LAB;
    process.env.QALAM_LAB = "voice";
    const file = path.join(dir, "Scan.pdf");
    await writeFile(file, pdf([fullPage]));
    await expect(ingestPath(file, "Scan.pdf", store)).rejects.toThrow(/no text/);
    if (old === undefined) delete process.env.QALAM_LAB;
    else process.env.QALAM_LAB = old;
  });
});
