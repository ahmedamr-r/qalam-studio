/*
 * The lab (browser-safe): what v0.1 hides so a first-time user sees one loop (docs/v0.1.md).
 * Everything here is off by default. `labs` in this computer's settings, or QALAM_LAB, turns all
 * of it on (true, "1") or some of it (a list of names). Nothing is deleted: the routes, the server
 * and the organization's files stay as they are, and only the ways in are hidden. The window reads
 * it once per page load, before anything draws (`loadLab`), so it never changes under a page.
 */

export const LAB_FEATURES = [
  /** Screens, design systems and prototypes, and Design this on a solution. */
  "design",
  /** The Decisions place and the "why?" prompt (decisions are still recorded). */
  "decisions",
  /** Engines other than Claude Code, Codex and an Anthropic key. */
  "engines",
  /** The connectors past docs and analytics (customer voice, build and design), and work status on cards. */
  "connectors",
  /** Product code: Connections' Product code card, Evidence's product maps. */
  "code",
  /** A connector's saved search wired to goals and cards. */
  "feeds",
  /** A goal's jobs and gaps, what others aim for, Break it down, its funnel, flows toward it. */
  "goals",
  /** People online: Look online on a problem's page. */
  "online",
  /** What people see: screens and flows read from screenshots. */
  "seen",
  /** What's inside a PDF's pictures: charts, tables set as images, scanned pages (server/pictures.ts). */
  "pictures",
  /** Needs a look's Review now (code's checks stay). */
  "review",
  /** Draft its tests on a solution (Draft solutions already gives each one a test). */
  "tests",
  /** Quick capture from the menu bar (⌃⌥Space). */
  "capture",
  /** Look in your tools: one question searched in every connected tool at once (src/connectors/everywhere.ts). */
  "everywhere",
] as const;

export type LabFeature = (typeof LAB_FEATURES)[number];

/** What's on: everything, or the features named. */
export type LabState = true | readonly LabFeature[];

const isFeature = (x: unknown): x is LabFeature => typeof x === "string" && (LAB_FEATURES as readonly string[]).includes(x);

/** A setting or variable read as what's on: true or "1"/"true"/"all" is everything, a list (or "a,b") those, anything else nothing. */
export function labState(raw: unknown): LabState {
  if (raw === true || raw === "1" || raw === "true" || raw === "all") return true;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",").map((s) => s.trim()) : [];
  return list.filter(isFeature);
}

let state: LabState = [];

/** Whether a hidden feature is on for this page load. */
export const lab = (f: LabFeature): boolean => state === true || state.includes(f);

/** For tests, and for `loadLab`. */
export function setLab(s: LabState) {
  state = s;
}

/** The engines v0.1 offers: the person's own Claude Code and Codex, and an Anthropic key. */
export const engineShown = (kind: string): boolean => kind === "cli" || kind === "codex" || kind === "api" || lab("engines");

/** The connector groups shown: docs and analytics, the rest with the lab's `connectors`. */
export const connectorShown = (group: string): boolean => group === "docs" || group === "numbers" || lab("connectors");

let loading: Promise<void> | null = null;

/**
 * Read what's on from the core, once per page load. The desktop app's core may still be starting
 * (503) or restarting (502): wait for it as boot does (`retry` gives the next wait, null to stop).
 * Anything else, or no answer, leaves everything hidden.
 */
export function loadLab(retry: (attempt: number) => number | null): Promise<void> {
  loading ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("/api/lab").catch(() => null);
      if (res?.ok) return setLab(labState(((await res.json().catch(() => ({}))) as { on?: unknown }).on));
      const wait = res && (res.status === 502 || res.status === 503) ? retry(attempt) : null;
      if (wait === null) return;
      await new Promise((r) => setTimeout(r, wait));
    }
  })();
  return loading;
}
