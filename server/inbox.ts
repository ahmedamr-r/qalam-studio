import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiConfigured } from "@/ai/server";
import { captureSource } from "./capture";
import { ingestPath } from "./ingest";
import type { OrgStore } from "./org/store";

/**
 * The organization's inbox folder (<org>/inbox): drop files there (from Finder, an export, a
 * script) and Qalam takes them in while it runs, whatever its window shows, one at a time: each
 * becomes a source of the organization's, read, filed into the topic pages and placed on the boards
 * (server/capture.ts), then moves to inbox/added. A file Qalam can't read moves to inbox/not-read
 * with a note saying why. Nothing is deleted. Only while Qalam AI is set up: until then files wait
 * where they are. Watched while the organization's store is open: the one opened last opens when
 * Qalam starts (openLastOrg), any other once it's opened.
 */

const SETTLE_MS = 1500;
/** Files taken in one go; the rest wait a minute (each file is several calls to Qalam AI). */
const PER_RUN = 10;
const AGAIN_MS = 60_000;
/** A claimed file nobody finished with in this long goes back in the inbox. */
const STALE_CLAIM_MS = 15 * 60_000;

// One inbox per store, whichever copy of this module asks (the dev server loads it afresh after an edit).
const g = globalThis as { __qalamInboxes?: WeakMap<OrgStore, unknown> };
const inboxes = (g.__qalamInboxes ??= new WeakMap());

/** Watch an organization's inbox while its store is open. */
export function startInbox(store: OrgStore) {
  if (inboxes.has(store)) return;
  const ib = new Inbox(store);
  inboxes.set(store, ib);
  ib.start();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A name not taken in `dir` ("notes.md", "notes 2.md"…). */
async function free(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} ${n}${ext}`;
    if (!(await stat(path.join(dir, candidate)).catch(() => null))) return candidate;
  }
}

class Inbox {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private again = false;
  private stopped = false;
  readonly dir: string;

  constructor(readonly store: OrgStore) {
    this.dir = path.join(store.dir, "inbox");
  }

  start() {
    const on = (e: { kind: string }) => e.kind === "inbox" && this.soon();
    this.store.events.on("event", on);
    this.store.events.once("dispose", () => {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.store.events.off("event", on);
    });
    // There to be found in the folder, empty until something's dropped in.
    void mkdir(this.dir, { recursive: true })
      .then(() => this.unclaim())
      .catch(() => {})
      .finally(() => this.soon());
  }

  private soon(ms = SETTLE_MS) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  /** Files waiting at the inbox's top level, oldest first (folders and hidden files aside). */
  private async waiting(): Promise<string[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && !e.name.startsWith("."))
        .map(async (e) => ({ file: path.join(this.dir, e.name), at: (await stat(path.join(this.dir, e.name)).catch(() => null))?.mtimeMs ?? 0 })),
    );
    return files.sort((a, b) => a.at - b.at).map((f) => f.file);
  }

  /** Not still being copied in: the same size a moment apart. */
  private async settled(file: string): Promise<boolean> {
    const a = await stat(file).catch(() => null);
    await wait(800);
    const b = await stat(file).catch(() => null);
    return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;
  }

  private async run() {
    if (this.stopped) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    if (!aiConfigured()) return;
    this.busy = true;
    let taken = 0;
    try {
      for (const file of await this.waiting()) {
        if (this.stopped) break;
        if (taken >= PER_RUN) {
          this.again = true;
          break;
        }
        if (!(await this.settled(file))) {
          this.again = true;
          continue;
        }
        await this.take(file);
        taken++;
      }
    } finally {
      this.busy = false;
      if (this.again && !this.stopped) {
        this.again = false;
        this.soon(taken >= PER_RUN ? AGAIN_MS : SETTLE_MS);
      }
    }
  }

  private async take(inboxFile: string) {
    const name = path.basename(inboxFile);
    // Claimed first: moved out of the inbox while it's read, so no other Qalam watching this
    // folder (the desktop app and a dev server, say) takes it too. Only one rename can win.
    const file = await this.move(inboxFile, ".taking");
    if (!file) return;
    try {
      // Named as it was dropped in (a claimed copy may carry a number to keep it apart).
      await captureSource(this.store, await ingestPath(file, name));
      await this.move(file, "added");
    } catch (e) {
      const to = await this.move(file, "not-read");
      if (to) await writeFile(`${to}.why.txt`, `Qalam couldn't take in ${name}: ${e instanceof Error ? e.message : String(e)}\n`).catch(() => {});
    }
  }

  /** Files left claimed by a Qalam that stopped midway go back in the inbox, after a while. */
  private async unclaim() {
    const dir = path.join(this.dir, ".taking");
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile()) continue;
      const st = await stat(path.join(dir, e.name)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > STALE_CLAIM_MS) await rename(path.join(dir, e.name), path.join(this.dir, await free(this.dir, e.name))).catch(() => {});
    }
  }

  private async move(file: string, into: "added" | "not-read" | ".taking"): Promise<string | null> {
    const dir = path.join(this.dir, into);
    await mkdir(dir, { recursive: true });
    const to = path.join(dir, await free(dir, path.basename(file)));
    return rename(file, to).then(
      () => to,
      () => null,
    );
  }
}
