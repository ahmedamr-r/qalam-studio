import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchGuarded } from "@/discovery/fetch-guard";
import type { OrgStore } from "./org/store";

/*
 * Quick capture (the menu bar's ⌃⌥Space, or the capture page): a note, a customer's quote or a link
 * from any app, dropped into the organization's inbox folder as a file. The inbox takes it from
 * there (server/inbox.ts): kept, read, filed into the topic pages and placed on the boards, and it
 * waits there if Qalam AI isn't set up yet. Writing a file, not reading it now, means nothing is
 * lost if the window that sent it closes.
 */

export interface QuickCapture {
  kind: "note" | "quote" | "link";
  text: string;
  url?: string;
  /** Who said it (a quote). */
  speaker?: string;
}

const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();

/** A file name: when, then the first words (or the page's host). */
export function captureName(q: QuickCapture, now: Date): string {
  const when = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const words = clean(q.text).split(" ").slice(0, 8).join(" ").slice(0, 60);
  const host = (() => {
    try {
      return new URL(q.url ?? "").host;
    } catch {
      return "";
    }
  })();
  return `${when} ${words || host || (q.kind === "quote" ? "Quote" : "Note")}`.trim();
}

/** The file's words: a quote as a quote with who said it, a note as it was written. */
export function captureText(q: QuickCapture): string {
  const text = q.text.trim();
  if (q.kind === "quote") return `> ${text.replace(/\n/g, "\n> ")}${q.speaker?.trim() ? `\n\n— ${q.speaker.trim()}` : ""}\n`;
  return `${q.url ? `${q.url}\n\n` : ""}${text}\n`;
}

async function free(dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? "" : ` ${n}`}${ext}`;
    if (!(await stat(path.join(dir, name)).catch(() => null))) return name;
  }
}

/** Into the inbox. A link brings its page (fetched through the guard against private addresses); a page that can't be read leaves the link and the words. */
export async function quickCapture(store: OrgStore, q: QuickCapture, now = new Date()): Promise<{ file: string }> {
  const dir = path.join(store.dir, "inbox");
  await mkdir(dir, { recursive: true });
  const base = captureName(q, now);
  if (q.kind === "link" && q.url) {
    try {
      const page = await fetchGuarded(q.url, {});
      if (/html/i.test(page.contentType)) {
        const name = await free(dir, base, ".html");
        await writeFile(path.join(dir, name), page.body);
        return { file: name };
      }
    } catch {
      // Not readable from here: the link and the words still go in.
    }
  }
  const name = await free(dir, base, ".md");
  await writeFile(path.join(dir, name), captureText(q));
  return { file: name };
}
