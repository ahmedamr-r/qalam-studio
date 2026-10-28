import type { OstMetric } from "@/discovery/types";
import { factHash } from "@/knowledge/refs";
import { frontMatter, readFrontMatter } from "@/org/context-md";
import { ordered, rootsOf, childrenOf } from "./tree";
import { GOAL_LEVERS, GOAL_STATUSES, type Goal, type GoalTree } from "./types";

/**
 * The goal tree as a Markdown file people can read and edit (goals.md): the North Star under its
 * heading with the goals that feed it nested below, then the goals not under a goal yet. Each line is
 * the goal in words; after it, in italics, its product and number for whoever reads the file, and
 * its record (id, number, board…) in a comment Markdown doesn't show. A line without a record is a
 * person's; editing the words of one Qalam AI wrote makes it the person's. Lines under a goal that
 * aren't goals, and sections Qalam doesn't know, are kept where they were.
 */

export const GOALS_FILE = "goals/1";
const NORTH = "North Star";
const OTHER = "Not under a goal yet";
/** Written on top of a new goals file, for whoever edits it by hand (kept, or not, as they like). */
export const GOALS_INTRO = "The North Star on top, each goal under the goal it feeds. Move a line to put a goal under another, and edit the words freely. Each goal's number is in the note after it: change numbers in Qalam.";

const record = (o: Record<string, unknown>) => ` <!-- qalam ${JSON.stringify(o).replace(/>/g, "\\u003e")} -->`;
const RECORD = /\s*<!--\s*qalam\s+(\{[\s\S]*?\})\s*-->\s*$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
/** The italic note after a goal's words (its product, its number): written by code, read past. */
const TRAILER = /\s+·\s+\*[^*\n]*\*\s*$/;

const num = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

/** A number in a line: "1.2 → 1.5 orders by June", "now 41%". */
export function metricLine(m: OstMetric): string {
  const unit = m.unit?.trim() ? ` ${m.unit.trim()}` : "";
  const when = m.timeframe?.trim() ?? "";
  // "June" reads "by June"; a timeframe that says how already ("by March", "this quarter") as it is.
  const by = when ? ` ${/^(by|in|within|before|until|this|next|end|q[1-4]\b)/i.test(when) ? when : `by ${when}`}` : "";
  const from = m.current ?? m.baseline;
  if (m.target !== null) return `${from !== null ? num(from) : "?"} → ${num(m.target)}${unit}${by}`;
  if (from !== null) return `now ${num(from)}${unit}`;
  return m.name.trim();
}

function trailer(g: Goal, productName: (id: string) => string | undefined): string {
  const bits = [g.product ? productName(g.product) : undefined, g.metric ? metricLine(g.metric) : undefined].filter((x): x is string => !!x?.trim());
  return bits.length ? ` · *${bits.join(" · ").replace(/\*/g, "")}*` : "";
}

function recordOf(g: Goal): Record<string, unknown> {
  return {
    id: g.id,
    ...(g.product ? { product: g.product } : {}),
    ...(g.metric ? { metric: g.metric } : {}),
    ...(g.status !== "active" ? { status: g.status } : {}),
    ...(g.lever ? { lever: g.lever } : {}),
    ...(g.feeds ? { feeds: g.feeds } : {}),
    ...(g.on ? { on: g.on } : {}),
    ...(g.cites.length ? { cites: g.cites } : {}),
    by: g.by,
    at: g.at,
    ...(g.by === "qalam" ? { h: factHash(g.title) } : {}),
  };
}

/** The file for a goal tree. */
export function goalsToMarkdown(t: GoalTree, names: { product?: (id: string) => string | undefined } = {}): string {
  const tree = ordered(t);
  const productName = names.product ?? (() => undefined);
  const lines = (g: Goal, depth: number): string[] => {
    const pad = "  ".repeat(depth);
    const title = g.title.replace(/\s+/g, " ").trim() || "Untitled goal";
    const out = [`${pad}- ${title}${trailer(g, productName)}${record(recordOf(g))}`];
    if (g.more?.trim()) out.push(...g.more.split("\n").map((l) => (l.trim() ? `${pad}  ${l}` : "")));
    for (const c of childrenOf(tree, g.id)) out.push(...lines(c, depth + 1));
    return out;
  };
  const roots = rootsOf(tree);
  const north = roots.find((g) => g.id === tree.north);
  const others = roots.filter((g) => g !== north);
  const notes = tree.notes?.trim() ?? "";
  // An intro (text before any section) stays on top; sections of its own go at the end.
  const cut = notes.startsWith("## ") ? 0 : notes.search(/\n\n## /) < 0 ? notes.length : notes.search(/\n\n## /);
  const parts = ["# Goals"];
  if (notes.slice(0, cut).trim()) parts.push(notes.slice(0, cut).trim());
  if (north) parts.push(`## ${NORTH}\n\n${lines(north, 0).join("\n")}`);
  if (others.length) parts.push(`## ${OTHER}\n\n${others.flatMap((g) => lines(g, 0)).join("\n")}`);
  if (notes.slice(cut).trim()) parts.push(notes.slice(cut).trim());
  return `${frontMatter({ qalam: GOALS_FILE })}${parts.join("\n\n")}\n`;
}

type Meta = Partial<Record<keyof Goal | "h", unknown>>;

function parseItem(raw: string): { text: string; meta: Meta | null } {
  const m = RECORD.exec(raw);
  let meta: Meta | null = null;
  let text = raw;
  if (m) {
    try {
      meta = JSON.parse(m[1]) as Meta;
      text = raw.slice(0, m.index);
    } catch {
      meta = null;
    }
  }
  return { text: text.replace(TRAILER, "").trim(), meta };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function goalOf(text: string, meta: Meta | null, id: string, parent: string | null): Goal {
  const m = meta ?? {};
  const on = m.on as Goal["on"] | undefined;
  const metric = m.metric && typeof m.metric === "object" ? (m.metric as OstMetric) : undefined;
  const qalam = m.by === "qalam" && (!m.h || m.h === factHash(text));
  return {
    id,
    title: text,
    parent,
    product: str(m.product) ?? null,
    ...(metric ? { metric } : {}),
    status: (GOAL_STATUSES as readonly unknown[]).includes(m.status) ? (m.status as Goal["status"]) : "active",
    ...((GOAL_LEVERS as readonly unknown[]).includes(m.lever) ? { lever: m.lever as Goal["lever"] } : {}),
    ...(str(m.feeds) ? { feeds: str(m.feeds) } : {}),
    ...(on && typeof on.board === "string" && typeof on.card === "string" ? { on: { board: on.board, card: on.card } } : {}),
    cites: Array.isArray(m.cites) ? m.cites.filter((c): c is string => typeof c === "string") : [],
    by: qalam ? "qalam" : "person",
    at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : 0,
  };
}

/** A goals file back to its tree. A file Qalam can't read as goals gives what it could, never an error. */
export function goalsFromMarkdown(md: string): GoalTree {
  const { fields, body } = readFrontMatter(md.replace(/\r\n/g, "\n"));
  if (fields.qalam !== undefined && fields.qalam !== GOALS_FILE) return { goals: [], north: null, notes: body.trim() || undefined };
  const lines = body.split("\n");
  const goals: Goal[] = [];
  const notes: string[] = [];
  const intro: string[] = [];
  const seen = new Map<string, number>();
  const used = new Set<string>();
  const personId = (text: string) => {
    const base = `p${factHash(text)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  };
  let north: string | null = null;
  let i = 0;
  for (; i < lines.length && !/^## /.test(lines[i]); i++) if (!/^# +/.test(lines[i])) intro.push(lines[i]);
  if (intro.join("\n").trim()) notes.push(intro.join("\n").trim());
  while (i < lines.length) {
    const name = lines[i].replace(/^## +/, "").trim();
    const end = lines.findIndex((l, j) => j > i && /^## /.test(l));
    const chunk = lines.slice(i + 1, end < 0 ? lines.length : end);
    i = end < 0 ? lines.length : end;
    const section = name.toLowerCase() === NORTH.toLowerCase() ? "north" : name.toLowerCase() === OTHER.toLowerCase() ? "other" : null;
    if (!section) {
      notes.push([`## ${name}`, ...chunk].join("\n").trim());
      continue;
    }
    // Each bullet's parent is the nearest bullet above it indented less.
    const stack: { indent: number; id: string }[] = [];
    let last: Goal | null = null;
    const more = new Map<Goal, string[]>();
    let first = true;
    for (const line of chunk) {
      const b = BULLET.exec(line);
      if (!b) {
        if (last && line.trim()) more.set(last, [...(more.get(last) ?? []), line]);
        continue;
      }
      const indent = b[1].replace(/\t/g, "  ").length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const { text, meta } = parseItem(b[2]);
      if (!text) continue;
      let id = str(meta?.id) ?? personId(text);
      if (used.has(id)) id = personId(`${text}#${id}`);
      used.add(id);
      const parent = stack.length ? stack[stack.length - 1].id : null;
      const g = goalOf(text, meta, id, parent);
      if (section === "north" && !parent && first) north = id;
      if (!parent) first = false;
      goals.push(g);
      stack.push({ indent, id });
      last = g;
    }
    for (const [g, extra] of more) {
      const pad = Math.min(...extra.map((l) => l.match(/^\s*/)![0].length));
      g.more = extra.map((l) => l.slice(pad)).join("\n");
    }
  }
  return ordered({ goals, north, ...(notes.length ? { notes: notes.join("\n\n") } : {}) });
}
