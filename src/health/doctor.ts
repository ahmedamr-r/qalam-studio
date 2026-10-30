/*
 * This Mac, checked (pure): what Qalam needs to work here, each as one row with a dot and a word,
 * and a fix where there is one. Quiet when all is well (one row says so); otherwise only what needs
 * doing shows, the worst first, the way OpenClaw's doctor sorts "Fix now" from the rest.
 */

export type Dot = "ok" | "warn" | "bad" | "off";

export interface HealthRow {
  id: "engine" | "search" | "models" | "inbox" | "voice" | "see" | "all";
  dot: Dot;
  /** What it is: "Qalam AI", "Search"… */
  label: string;
  /** Its state in a word or two. */
  word: string;
  detail?: string;
  /** What fixes it: an action the core runs (`POST /api/health/fix`), a command to copy, or a place to go. */
  fix?: { id: string; label: string; command?: string; href?: string };
}

export interface HealthFacts {
  engine: { kind: "cli" | "api"; ready: boolean; word: string; detail?: string };
  /** Full-text search works with this Node (Node 24, or the desktop app's). */
  search: { ok: boolean; node: string };
  models: { status: "idle" | "loading" | "ready" | "failed"; error?: string; download?: { done: number; total: number } } | null;
  inbox: { waiting: number; notRead: number; lastReason?: string; paused: boolean } | null;
  /** Talking instead of typing: whether a mic is on here, and whether macOS lets Qalam use the microphone. */
  voice?: { on: boolean; mic: "granted" | "denied" | "undetermined" } | null;
  /** Reading the words on screenshots: whether this Mac has the reader (qalam-see) and it runs. */
  see?: { here: boolean } | null;
}

const RANK: Record<Dot, number> = { bad: 0, warn: 1, off: 2, ok: 3 };

export function diagnose(f: HealthFacts): HealthRow[] {
  const rows: HealthRow[] = [];
  if (!f.engine.ready) {
    const signedOut = f.engine.word === "Signed out";
    const missing = f.engine.word === "Not installed";
    // No key yet: Connections' card is where one goes, so no button here.
    const noKey = f.engine.word === "No key";
    rows.push({
      id: "engine",
      dot: "bad",
      label: "Qalam AI",
      word: f.engine.word,
      ...(f.engine.detail ? { detail: f.engine.detail } : {}),
      ...(signedOut
        ? { fix: { id: "engine.signin", label: "Copy the command", command: "claude auth login" } }
        : missing
          ? { fix: { id: "engine.install", label: "Install Claude Code", href: "https://code.claude.com/docs/en/quickstart" } }
          : noKey
            ? {}
            : { fix: { id: "engine.test", label: "Test again" } }),
    });
  }
  if (!f.search.ok)
    rows.push({ id: "search", dot: "warn", label: "Search", word: "Off", detail: `This runs on Node ${f.search.node}, whose SQLite has no full-text search. Use Node 24, or the desktop app.` });
  if (f.models?.status === "failed") rows.push({ id: "models", dot: "warn", label: "Meaning search", word: "Stopped", detail: f.models.error, fix: { id: "models.retry", label: "Try again" } });
  else if (f.models?.status === "loading" && f.models.download)
    rows.push({ id: "models", dot: "off", label: "Meaning search", word: `Downloading ${Math.round((100 * f.models.download.done) / Math.max(1, f.models.download.total))}%`, detail: "A small model, once. Search by words works meanwhile." });
  if (f.inbox?.paused && f.inbox.waiting) rows.push({ id: "inbox", dot: "warn", label: "Inbox", word: `${f.inbox.waiting} waiting`, detail: "Files wait until Qalam AI is set up." });
  else if (f.inbox?.notRead) rows.push({ id: "inbox", dot: "warn", label: "Inbox", word: `${f.inbox.notRead} not read`, ...(f.inbox.lastReason ? { detail: f.inbox.lastReason } : {}) });
  if (f.voice?.on && f.voice.mic === "denied") rows.push({ id: "voice", dot: "warn", label: "Voice", word: "Microphone off", detail: "Allow Qalam in System Settings → Privacy & Security → Microphone, or choose your own dictation app in Connections." });
  if (f.see && !f.see.here)
    rows.push({ id: "see", dot: "off", label: "Reading words on screenshots", word: "Not on this Mac", detail: "This Mac has no reader for the words on screenshots, so they aren't checked: screens are kept without their labels or quotes." });
  if (!rows.length) return [{ id: "all", dot: "ok", label: "This Mac", word: "All good" }];
  return rows.sort((a, b) => RANK[a.dot] - RANK[b.dot]);
}

/** The sidebar's one dot for Connections: the worst row's, or none when all is good. */
export const worstDot = (rows: HealthRow[]): Dot | null => (rows.length === 1 && rows[0].id === "all" ? null : (rows[0]?.dot ?? null));
