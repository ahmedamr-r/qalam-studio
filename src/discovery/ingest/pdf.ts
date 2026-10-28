import { cleanText } from "./text";

/*
 * A PDF's text, from pdf.js (the browser's build in a worker, or Node's legacy build in the core).
 * Pages are kept: each page's text in order, and where each starts, so a quote can say which page
 * it's on. A PDF with no text (a scan) says so: there's no OCR.
 */

type PdfJs = Pick<typeof import("pdfjs-dist"), "getDocument">;

export async function pdfText(pdfjs: PdfJs, data: ArrayBuffer): Promise<{ text: string; pages: number[]; title?: string }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    const pages: number[] = [];
    let at = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      page.cleanup();
      const text = cleanText(lines.join("\n"));
      // Pages are separated by a blank line; each records where it starts.
      if (parts.length) at += 2;
      pages.push(at);
      parts.push(text);
      at += text.length;
    }
    const text = parts.join("\n\n");
    if (!text.replace(/\s+/g, "").length) throw new Error("This PDF has no text to read (it may be scanned pages). Qalam can't read scans: export it with text, or paste what it says.");
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    return { text, pages, ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}) };
  } finally {
    void task.destroy();
  }
}
