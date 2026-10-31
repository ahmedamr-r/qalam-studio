import { pdfText } from "@/discovery/ingest/pdf";
import type { TextBlock } from "@/discovery/sources";

/* A PDF's text in the browser: pdf.js loaded only when a PDF comes in, its parsing in a worker. */

type PdfJs = typeof import("pdfjs-dist");

let lib: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  return (lib ??= import("pdfjs-dist").then((m) => {
    if (!m.GlobalWorkerOptions.workerPort) m.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    return m;
  }));
}

export async function readPdf(data: ArrayBuffer): Promise<{ text: string; pages: number[]; blocks?: TextBlock[]; title?: string }> {
  return pdfText(await pdfjs(), data);
}
