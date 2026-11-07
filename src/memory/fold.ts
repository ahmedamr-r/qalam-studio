import { ASKED_FLOWS, sharedHow, type AskedAbout, type AskedEntry, type AskedFlow, type AskedHow, type AskedLine, type RoundAnswer, type Who } from "./types";

/**
 * The memory as it's read (pure): both files' lines in any order, since a Git merge interleaves two
 * people's. Sorted by time then id, the latest answer to each question (by its id) stands; a forget takes
 * an answer off whenever it landed, before its entry included; a confirm says when it was last said to be
 * right. Broken lines are left out.
 */

export interface Memory {
  /** What's remembered, newest first. */
  entries: AskedEntry[];
  /** When each was last said to be right. */
  confirmed: Map<string, number>;
}

/** A stable id for a question asked in a conversation: two hashes of it, so ids don't collide in a project's life. */
export function askedId(flow: AskedFlow, key: string, qid: string): string {
  const s = `${flow}:${key}:${qid}`;
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return `m${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** An id for a question that came with none (what a scan was told while it read): its words, as a short slug. */
export const questionKey = (q: string): string =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "q";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const HOWS: readonly AskedHow[] = ["own", "pick", "unknown", "left"];
const whoOf = (v: unknown): Who | null => {
  const w = rec(v);
  return str(w.id) ? { id: str(w.id), ...(str(w.name) ? { name: str(w.name) } : {}) } : null;
};

/** A line as it was read, or null when it's broken. */
export function lineOf(raw: unknown): AskedLine | null {
  const x = rec(raw);
  const at = typeof x.at === "number" && Number.isFinite(x.at) ? x.at : null;
  const by = whoOf(x.by);
  if (x.v !== 1 || at === null || !by) return null;
  if (str(x.forget)) return { v: 1, forget: str(x.forget), at, by };
  if (str(x.confirm)) return { v: 1, confirm: str(x.confirm), at, by };
  const flow = ASKED_FLOWS.find((f) => f === x.flow);
  const how = HOWS.find((h) => h === x.how);
  const about = rec(x.about);
  if (!str(x.id) || !flow || !how || !str(x.q) || !str(x.qid) || !str(x.key)) return null;
  const ids = ["board", "card", "goal", "topic", "source"] as const;
  return {
    v: 1,
    id: str(x.id),
    at,
    by,
    flow,
    key: str(x.key),
    about: { product: typeof about.product === "string" ? about.product : null, ...Object.fromEntries(ids.flatMap((k) => (str(about[k]) ? [[k, str(about[k])]] : []))) } as AskedAbout,
    qid: str(x.qid),
    q: str(x.q),
    ...(x.code === true ? { code: true as const } : {}),
    how,
    a: str(x.a),
  };
}

const orderOf = (l: AskedLine) => ("forget" in l ? l.forget : "confirm" in l ? l.confirm : l.id);

export function foldAsked(lines: readonly unknown[]): Memory {
  const kept = lines.map(lineOf).filter((l): l is AskedLine => !!l);
  kept.sort((a, b) => a.at - b.at || orderOf(a).localeCompare(orderOf(b)));
  const latest = new Map<string, AskedEntry>();
  const forgotten = new Set<string>();
  const confirmed = new Map<string, number>();
  for (const l of kept) {
    if ("forget" in l) forgotten.add(l.forget);
    else if ("confirm" in l) confirmed.set(l.confirm, Math.max(confirmed.get(l.confirm) ?? 0, l.at));
    else latest.set(l.id, l);
  }
  const entries = [...latest.values()].filter((e) => !forgotten.has(e.id)).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return { entries, confirmed: new Map([...confirmed].filter(([id]) => latest.has(id) && !forgotten.has(id))) };
}

/**
 * What to write for a round: a line for each answer not remembered already as it is (so sending a round
 * twice writes nothing new), split between the team's file and this computer's.
 */
export function linesFor(o: { flow: AskedFlow; key: string; about: AskedAbout; answers: readonly RoundAnswer[]; by: Who; at: number; have: Memory }): { shared: AskedEntry[]; local: AskedEntry[] } {
  const known = new Map(o.have.entries.map((e) => [e.id, e]));
  const shared: AskedEntry[] = [];
  const local: AskedEntry[] = [];
  // A round's answers a millisecond apart, so the order they were asked in survives the fold.
  let step = 0;
  for (const x of o.answers) {
    const q = x.q.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!q || !x.qid) continue;
    const id = askedId(o.flow, o.key, x.qid);
    const a = x.a.replace(/\s+/g, " ").trim().slice(0, 1600);
    const was = known.get(id);
    if (was && was.a === a && was.how === x.how) continue;
    const e: AskedEntry = { v: 1, id, at: o.at + step++, by: o.by, flow: o.flow, key: o.key, about: o.about, qid: x.qid, q, ...(x.code ? { code: true as const } : {}), how: x.how, a };
    (sharedHow(x.how) ? shared : local).push(e);
  }
  return { shared, local };
}
