import { findQuote } from "@/discovery/quotes";
import { checkWords } from "@/hub/topics";

/*
 * What a product does today, from its code (pure): its main flows, each a few steps, each step
 * naming the file it's in, the code's own words (a snippet) and the analytics events it sends. The
 * code reader proposes them; code keeps a step only when its file is in the copy that was read, its
 * snippet is in that file, and its events are ones the scanner found (src/code/scan.ts). A flow can
 * say which goal its events measure: that's the goal's funnel. Kept in hub/maps/<repo>.md, readable
 * like a topic page, each step's record in a comment.
 */

export interface MapStep {
  title: string;
  file: string;
  /** The code's own words, found in the file. */
  snippet: string;
  events: string[];
}

export interface MapFlow {
  name: string;
  /** The goal whose number its events measure. */
  goal?: string;
  steps: MapStep[];
}

export interface ProductMap {
  /** How the file is named: the repository as owner__name, or the folder's name. */
  key: string;
  /** owner/name, or the folder's name. */
  repo: string;
  commit?: string;
  product: string | null;
  readAt: number;
  flows: MapFlow[];
  /** Every event the scanner found. */
  events: string[];
}

/** A repository or folder this computer reads for a product (kept per computer: a folder's path is this Mac's). */
export interface CodeRepo {
  key: string;
  kind: "github" | "folder";
  /** owner/name, for GitHub. */
  repo?: string;
  /** The folder, read where it is. */
  path?: string;
  product: string | null;
  commit?: string;
  readAt?: number;
}

export const MAP_LIMITS = { flows: 8, steps: 10, title: 120, name: 80, snippet: 300, answer: 600 } as const;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A path as the copy names it: relative, forward slashes, without the folder the reader saw it in. */
export function repoPath(p: string, root: string): string {
  const norm = p.replace(/\\/g, "/").trim();
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return (norm.startsWith(`${base}/`) ? norm.slice(base.length + 1) : norm).replace(/^\.?\//, "");
}

/** A step's snippet in its file, word for word (spacing aside): the file's own words, else null. */
function inFile(text: string | undefined, snippet: string): string | null {
  if (!text || snippet.length < 8) return null;
  return findQuote(text, snippet)?.words.slice(0, MAP_LIMITS.snippet) ?? null;
}

/**
 * What code keeps of the reader's flows: steps whose file is in the copy, whose snippet is in that
 * file, with only the events the scanner found; a flow with fewer than two steps left goes.
 */
export function verifyFlows(raw: unknown, o: { root: string; files: ReadonlyMap<string, string>; events: ReadonlySet<string>; goals: ReadonlySet<string> }, dropped?: (why: string, item: unknown) => void): MapFlow[] {
  const out: MapFlow[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).flows) ? (rec(raw).flows as unknown[]) : []) {
    if (out.length >= MAP_LIMITS.flows) break;
    const f = rec(x);
    const name = clip(f.name, MAP_LIMITS.name);
    const steps: MapStep[] = [];
    for (const y of Array.isArray(f.steps) ? (f.steps as unknown[]) : []) {
      if (steps.length >= MAP_LIMITS.steps) break;
      const s = rec(y);
      const file = typeof s.file === "string" ? repoPath(s.file, o.root) : "";
      const snippet = typeof s.snippet === "string" ? inFile(o.files.get(file), s.snippet.slice(0, 600)) : null;
      const title = clip(s.title, MAP_LIMITS.title);
      if (!title || !o.files.has(file) || !snippet) {
        drop(!o.files.has(file) ? "a file not in the copy" : !snippet ? "its snippet isn't in its file" : "no title", y);
        continue;
      }
      const events = [...new Set((Array.isArray(s.events) ? s.events : []).filter((e): e is string => typeof e === "string").map((e) => e.trim()))];
      for (const e of events.filter((e) => !o.events.has(e))) drop(`an event the code doesn't send: ${e}`, y);
      steps.push({ title, file, snippet, events: events.filter((e) => o.events.has(e)) });
    }
    if (!name || steps.length < 2) {
      drop("fewer than two steps hold", x);
      continue;
    }
    const goal = typeof f.goal === "string" && o.goals.has(f.goal.trim()) ? f.goal.trim() : undefined;
    out.push({ name, ...(goal ? { goal } : {}), steps });
  }
  return out;
}

export interface CodeAnswer {
  text: string;
  cites: { file: string; snippet: string }[];
}

/** An answer about the code, kept only when what it cites is in the files and its quoted words in what it cites. */
export function verifyAnswer(raw: unknown, o: { root: string; files: ReadonlyMap<string, string> }): CodeAnswer | null {
  const a = rec(rec(raw).answer);
  const cites = (Array.isArray(a.cites) ? a.cites : []).map(rec).flatMap((c) => {
    const file = typeof c.file === "string" ? repoPath(c.file, o.root) : "";
    const snippet = typeof c.snippet === "string" ? inFile(o.files.get(file), c.snippet.slice(0, 600)) : null;
    return snippet ? [{ file, snippet }] : [];
  });
  if (!cites.length) return null;
  const text = checkWords(a.text, cites.map((c) => ({ text: c.snippet })), cites.map((c) => c.file).join("\n"), MAP_LIMITS.answer);
  return text ? { text, cites: cites.slice(0, 6) } : null;
}

// ---------------------------------------------------------------------------
// The file: hub/maps/<key>.md

const RECORD = /\s*<!--\s*qalam\s+(\{.*\})\s*-->\s*$/;
const json = (s: string): Record<string, unknown> => {
  try {
    return rec(JSON.parse(s));
  } catch {
    return {};
  }
};

export function mapToMarkdown(m: ProductMap, o: { productName?: string; goalTitle: (id: string) => string | undefined }): string {
  const head = ["---", `qalam: "map/1"`, `key: ${JSON.stringify(m.key)}`, `repo: ${JSON.stringify(m.repo)}`, ...(m.commit ? [`commit: ${JSON.stringify(m.commit)}`] : []), `product: ${JSON.stringify(m.product)}`, `readAt: ${m.readAt}`, `events: ${JSON.stringify(m.events)}`, "---", ""];
  const body = [
    `# What ${o.productName ?? "the product"} does today`,
    "",
    `From ${m.repo}${m.commit ? ` at ${m.commit.slice(0, 7)}` : ""}, read ${new Date(m.readAt).toISOString().slice(0, 10)}. Each step names the file it's in; events are what it sends. Qalam reads it again from the code: edit the words, not the records.`,
    "",
    ...m.flows.flatMap((f) => {
      const goal = f.goal ? o.goalTitle(f.goal) : undefined;
      return [
        `## ${f.name}${goal ? ` · measures “${goal}”` : ""}${f.goal ? ` <!-- qalam ${JSON.stringify({ goal: f.goal })} -->` : ""}`,
        "",
        ...f.steps.map((s, i) => `${i + 1}. ${s.title} · \`${s.file}\`${s.events.length ? ` · sends ${s.events.map((e) => `\`${e}\``).join(", ")}` : ""} <!-- qalam ${JSON.stringify({ file: s.file, snippet: s.snippet, events: s.events })} -->`),
        "",
      ];
    }),
  ];
  return [...head, ...body].join("\n");
}

/** A map file read back: its records, with the words people edited as its titles. Null when it isn't one. */
export function mapFromMarkdown(md: string): ProductMap | null {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!fm || !/qalam:\s*"map\/1"/.test(fm[1])) return null;
  const field = (k: string) => {
    const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1]);
    if (!m) return undefined;
    try {
      return JSON.parse(m[1]) as unknown;
    } catch {
      return undefined;
    }
  };
  const flows: MapFlow[] = [];
  for (const line of md.slice(fm[0].length).split("\n")) {
    const flow = /^##\s+(.+)$/.exec(line);
    if (flow) {
      const r = RECORD.exec(flow[1]);
      const name = flow[1].replace(RECORD, "").replace(/\s·\smeasures\s“.*”\s*$/, "").trim();
      const goal = r ? json(r[1]).goal : undefined;
      flows.push({ name, ...(typeof goal === "string" ? { goal } : {}), steps: [] });
      continue;
    }
    const step = /^\d+\.\s+(.+)$/.exec(line);
    const r = step ? RECORD.exec(step[1]) : null;
    if (!step || !r || !flows.length) continue;
    const data = json(r[1]);
    if (typeof data.file !== "string" || typeof data.snippet !== "string") continue;
    const title = step[1].replace(RECORD, "").replace(/\s·\s`[^`]+`(\s·\ssends\s.+)?$/, "").trim();
    flows[flows.length - 1].steps.push({ title, file: data.file, snippet: data.snippet, events: Array.isArray(data.events) ? data.events.filter((e): e is string => typeof e === "string") : [] });
  }
  const key = field("key");
  const repo = field("repo");
  const readAt = field("readAt");
  if (typeof key !== "string" || typeof repo !== "string" || typeof readAt !== "number") return null;
  const commit = field("commit");
  const product = field("product");
  const events = field("events");
  return { key, repo, ...(typeof commit === "string" ? { commit } : {}), product: typeof product === "string" ? product : null, readAt, flows: flows.filter((f) => f.steps.length), events: Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [] };
}

/** The flow that measures a goal, from the maps of its product (or any, for the whole organization's). */
export function funnelOf(goal: { id: string; product: string | null }, maps: ProductMap[]): { map: ProductMap; flow: MapFlow } | null {
  for (const map of maps) {
    if (goal.product && map.product && map.product !== goal.product) continue;
    const flow = map.flows.find((f) => f.goal === goal.id);
    if (flow) return { map, flow };
  }
  return null;
}
