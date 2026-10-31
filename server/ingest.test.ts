import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestError } from "@/discovery/ingest/core";
import { htmlText } from "@/discovery/ingest/text";
import { ingestPath } from "./ingest";

/** A one-page PDF with a line of text (Helvetica), with a correct cross-reference table. */
function tinyPdf(text: string, content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
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

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-ingest-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("reading files in the core", () => {
  it("reads a PDF's text with its pages, in this process", async () => {
    await writeFile(path.join(dir, "Call notes.pdf"), tinyPdf("Customers wait two hours for evening slots."));
    const r = await ingestPath(path.join(dir, "Call notes.pdf"));
    expect(r).toMatchObject({ kind: "pdf", title: "Call notes", origin: "Call notes.pdf", pages: [0] });
    expect(r.text).toBe("Customers wait two hours for evening slots.");
  });

  it("reads a PDF's shape as a converter to Markdown would: headings by size, list items, wrapped lines joined", async () => {
    const run = (size: number, y: number, words: string) => `BT /F1 ${size} Tf 72 ${y} Td (${words}) Tj ET`;
    const content = [
      run(22, 740, "What it promised"),
      run(11, 712, "Payouts in 190 countries, most of them settling in real time by bank, card or"),
      run(11, 698, "crypto, the same day."),
      run(11, 660, "- Where each payout is"),
      run(11, 646, "- When it lands"),
    ].join("\n");
    await writeFile(path.join(dir, "Promise.pdf"), tinyPdf("", content));
    const r = await ingestPath(path.join(dir, "Promise.pdf"));
    expect(r.text).toBe("What it promised\n\nPayouts in 190 countries, most of them settling in real time by bank, card or crypto, the same day.\n\nWhere each payout is\n\nWhen it lands");
    expect(r.blocks?.map((b) => [b.kind, r.text.slice(...b.span)])).toEqual([
      ["h1", "What it promised"],
      ["li", "Where each payout is"],
      ["li", "When it lands"],
    ]);
  });

  it("reads Markdown and text files as they are, and refuses what it can't read", async () => {
    await writeFile(path.join(dir, "notes.md"), "# Interview\n\n**Sara:** I rebuild my basket every *Sunday*.\n");
    expect(await ingestPath(path.join(dir, "notes.md"))).toMatchObject({ kind: "markdown", title: "notes", text: "Interview\n\nSara: I rebuild my basket every Sunday." });
    await writeFile(path.join(dir, "app.exe"), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    await expect(ingestPath(path.join(dir, "app.exe"))).rejects.toBeInstanceOf(IngestError);
  });

  it("reads a web page saved as a file, without what can't be read", () => {
    const r = htmlText(`<!doctype html><html><head><title>Ticket #42 &amp; more</title><script>alert(1)</script></head><body><nav>Home · About</nav><main><h1>Ticket 42</h1><p>The driver came at noon.</p><p>I&#39;d like a call first.</p><form><input></form></main><footer>© Basket</footer></body></html>`);
    expect(r).toEqual({ title: "Ticket #42 & more", text: "Ticket 42\n\nThe driver came at noon.\n\nI'd like a call first." });
  });
});
