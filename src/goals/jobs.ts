import { checkWords, cleanLine, SECTION_HEADING, type Topic } from "@/hub/topics";
import type { Gap } from "./gaps";
import { withoutIds } from "./said";
import { metricLine } from "./goals-md";
import type { GoalProblem } from "./problems";
import { chainOf } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * Jobs (pure): the work that would close what a team doesn't know yet about a goal (src/goals/gaps.ts).
 * Qalam AI plans them; code keeps a job only when its gap, tool and people were sent, and its words
 * and numbers are in what was sent. Qalam runs what it can (a search in a connected tool, a number
 * from PostHog) and hands over the rest (questions, and who to ask: only segments and people the
 * team's own material names). Each job is a line in hub/jobs.jsonl, then a line per change to it.
 */

export const JOB_KINDS = ["search", "numbers", "talk", "read-code"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "todo" | "done" | "dropped";

export interface JobWho {
  /** A segment page, a person named in the sources, or the team. */
  kind: "segment" | "person" | "team";
  /** The segment page. */
  id?: string;
  name: string;
  /** Why them, in one line. */
  why: string;
}

export interface Job {
  id: string;
  goal: string;
  /** The gap it would close (its key). */
  gap?: string;
  kind: JobKind;
  title: string;
  /** What the team would learn, in one line. */
  why: string;
  /** search: a tool that brings material in · numbers: PostHog. */
  connector?: string;
  /** search: the words to search for · numbers: a saved insight's name. */
  query?: string;
  /** talk and read-code: what to ask. */
  questions?: string[];
  /** talk: who to ask. */
  who?: JobWho[];
  status: JobStatus;
  /** The sources it brought in (a search's items, a talk's notes). */
  results: string[];
  /** What came of it, in code's words. */
  outcome?: string;
  by: "qalam" | "you";
  at: number;
  /** When it last changed. */
  changed: number;
}

/** A line of hub/jobs.jsonl: a job, or a change to one (its fields win; `results` adds to the job's). */
export type JobLog = Partial<Omit<Job, "changed">> & { id: string; at: number };

const STATUSES = new Set<JobStatus>(["todo", "done", "dropped"]);
/** What a change may set: never whose goal it is, what kind it is, or who planned it. */
const CHANGES = ["status", "outcome", "title", "why", "query", "questions", "who", "connector", "gap"] as const;

/** The jobs as they are now: each one's first line, with every change after it. */
export function foldJobs(log: JobLog[]): Job[] {
  const jobs = new Map<string, Job>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (typeof e.id !== "string" || typeof e.at !== "number") continue;
    const cur = jobs.get(e.id);
    if (!cur) {
      if (typeof e.goal !== "string" || !JOB_KINDS.includes(e.kind as JobKind) || typeof e.title !== "string") continue;
      jobs.set(e.id, {
        id: e.id,
        goal: e.goal,
        ...(e.gap ? { gap: e.gap } : {}),
        kind: e.kind as JobKind,
        title: e.title,
        why: e.why ?? "",
        ...(e.connector ? { connector: e.connector } : {}),
        ...(e.query ? { query: e.query } : {}),
        ...(e.questions?.length ? { questions: e.questions } : {}),
        ...(e.who?.length ? { who: e.who } : {}),
        status: e.status && STATUSES.has(e.status) ? e.status : "todo",
        results: [...new Set(e.results ?? [])],
        ...(e.outcome ? { outcome: e.outcome } : {}),
        by: e.by === "you" ? "you" : "qalam",
        at: e.at,
        changed: e.at,
      });
      continue;
    }
    const next: Job = { ...cur, results: [...new Set([...cur.results, ...(e.results ?? [])])], changed: e.at };
    for (const k of CHANGES) if (e[k] !== undefined) Object.assign(next, { [k]: e[k] });
    if (!STATUSES.has(next.status)) next.status = cur.status;
    jobs.set(e.id, next);
  }
  return [...jobs.values()];
}

/** A goal's jobs as its page lists them: to do (oldest first), then done (newest first); dropped ones go. */
export function jobsOf(jobs: Job[], goal: string): Job[] {
  const mine = jobs.filter((j) => j.goal === goal && j.status !== "dropped");
  return [...mine.filter((j) => j.status === "todo").sort((a, b) => a.at - b.at), ...mine.filter((j) => j.status === "done").sort((a, b) => b.changed - a.changed)];
}

// ---------------------------------------------------------------------------
// What a call is sent, and its answer as code keeps it

export const JOB_LIMITS = { jobs: 6, questions: 5, who: 4, segments: 12, people: 12, problems: 8, lines: 4, title: 110, why: 240, query: 120, question: 220, whoWhy: 160 } as const;

/** A tool a job may use: one that brings material in (search) or reads a number (numbers). */
export interface JobTool {
  id: string;
  label: string;
  kind: "search" | "numbers";
  /** What it does, for the call. */
  what: string;
  connected: boolean;
}

export interface JobSent {
  /** The material as the model reads it. */
  text: string;
  /** What isn't known, as the call names it (x1…). */
  gaps: Map<string, Gap>;
  /** By the tool's id. */
  tools: Map<string, JobTool>;
  /** Segment pages as the call names them (s1…). */
  segments: Map<string, { id: string; title: string }>;
  /** People named in the sources (p1…). */
  people: Map<string, { name: string; quotes: number }>;
  /** Every word it was sent: what a job's words and numbers must come from. */
  hay: string;
  /** The goal's jobs already planned (not dropped): none is planned twice. */
  planned: Job[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const attr = (s: string) => one(s).replace(/"/g, "'");

/**
 * The material: the goal under the goals it feeds (with their numbers), what isn't known about it,
 * the problems behind it with a few lines each, the tools here and whether they're connected, the
 * segments and the people the team's material names, and the jobs already planned.
 */
export function jobMaterial(o: { tree: GoalTree; goal: Goal; gaps: Gap[]; problems: GoalProblem[]; topics: ReadonlyMap<string, Topic>; tools: JobTool[]; segments: Pick<Topic, "id" | "title">[]; people: { name: string; quotes: number }[]; planned: Job[]; productName: (id: string) => string | undefined }): JobSent {
  const out: string[] = ["The goal, under the goals it feeds (whose · goal · its number):"];
  const chain = chainOf(o.tree, o.goal.id).reverse();
  chain.forEach((g, depth) => {
    const who = g.product ? (o.productName(g.product) ?? "a product") : "the organization";
    const north = g.id === o.tree.north ? "North Star: " : "";
    out.push(`${"  ".repeat(depth)}- ${who} · ${north}${one(g.title)}${g.metric ? ` · ${g.metric.name ? `${one(g.metric.name)}: ` : ""}${metricLine(g.metric)}` : " · no number yet"}${g.id === o.goal.id ? "   ← this goal" : ""}`);
  });

  const gaps = new Map<string, Gap>();
  out.push("", "What isn't known yet about it (id · what):");
  for (const g of o.gaps) {
    const id = `x${gaps.size + 1}`;
    gaps.set(id, g);
    out.push(`- ${id} · ${one(g.title)}${g.kind === "open-question" && g.page ? ` (an open question on “${one(o.topics.get(g.page)?.title ?? "")}”)` : ""}`);
  }
  if (!gaps.size) out.push("(nothing: plan only what would make the problems behind it surer)");

  out.push("", "The problems behind it, with what their pages say:");
  for (const p of o.problems.slice(0, JOB_LIMITS.problems)) {
    out.push(`<problem title="${attr(p.title)}" bears="${p.bears}" evidence="${p.quotes ? `${p.quotes} quotes · ${p.sources} sources` : "no customer words yet"}">`);
    if (p.how) out.push(`How it moves the goal: ${one(p.how)}`);
    const lines = o.topics.get(p.topic)?.lines ?? [];
    for (const l of [...lines.filter((l) => l.section === "know"), ...lines.filter((l) => l.section === "believe"), ...lines.filter((l) => l.section === "open")].slice(0, JOB_LIMITS.lines)) out.push(`- ${SECTION_HEADING[l.section]}: ${one(l.text)}`);
    out.push("</problem>");
  }
  if (!o.problems.length) out.push("(none linked yet)");

  const tools = new Map(o.tools.map((t) => [t.id, t]));
  out.push("", "Tools (id · what it does · whether it's connected here):");
  for (const t of o.tools) out.push(`- ${t.id} · ${t.label}: ${t.what} · ${t.connected ? "connected" : "not connected"}`);

  const segments = new Map<string, { id: string; title: string }>();
  for (const s of o.segments.slice(0, JOB_LIMITS.segments)) segments.set(`s${segments.size + 1}`, { id: s.id, title: s.title });
  out.push("", "Segments, from the organization's segment pages (id · who):", ...(segments.size ? [...segments].map(([id, s]) => `- ${id} · ${one(s.title)}`) : ["(none yet)"]));

  const people = new Map<string, { name: string; quotes: number }>();
  for (const p of o.people.slice(0, JOB_LIMITS.people)) people.set(`p${people.size + 1}`, p);
  out.push("", "People named in the team's material (id · name · how many of their quotes it has):", ...(people.size ? [...people].map(([id, p]) => `- ${id} · ${one(p.name)} · ${p.quotes}`) : ["(none named)"]));

  const planned = o.planned.filter((j) => j.status !== "dropped");
  if (planned.length) out.push("", "Jobs already planned (don't plan them again):", ...planned.map((j) => `- ${one(j.title)}`));

  const text = out.join("\n");
  return { text, gaps, tools, segments, people, hay: text, planned };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const same = (a: string, b: string) => one(a).toLowerCase() === one(b).toLowerCase();

/**
 * What code keeps of the answer: jobs it can stand behind, at most so many, none twice.
 * `dropped` hears each job left out and why (for the call's trace).
 */
export function sanitizeJobs(raw: unknown, m: JobSent, o: { goal: string; now: number; id: () => string }, dropped?: (why: string, item: unknown) => void): Job[] {
  const out: Job[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  // The call's ids as what they stand for (a gap, a segment, a person), then checked.
  const name = (ref: string) => m.gaps.get(ref)?.title ?? m.segments.get(ref)?.title ?? m.people.get(ref)?.name;
  const words = (v: unknown, max: number, also: string[] = []) => checkWords(withoutIds(v, name), also.map((text) => ({ text })), m.hay, max);
  for (const x of Array.isArray(rec(raw).jobs) ? (rec(raw).jobs as unknown[]) : []) {
    if (out.length >= JOB_LIMITS.jobs) {
      drop("over the limit", x);
      continue;
    }
    const j = rec(x);
    const kind = JOB_KINDS.find((k) => k === j.kind);
    if (!kind) {
      drop("not a kind of job", x);
      continue;
    }
    const gapRef = typeof j.gap === "string" ? j.gap.trim() : "none";
    const gap = gapRef === "none" || gapRef === "" ? undefined : m.gaps.get(gapRef);
    if (gapRef !== "none" && gapRef !== "" && !gap) {
      drop("a gap not sent", x);
      continue;
    }
    // One open job per gap: a job done without closing it leaves room for another.
    if (gap && (out.some((y) => y.gap === gap.key) || m.planned.some((y) => y.gap === gap.key && y.status === "todo"))) {
      drop("a second job for one gap", x);
      continue;
    }
    let connector: string | undefined;
    let query: string | undefined;
    if (kind === "search" || kind === "numbers") {
      const tool = typeof j.connector === "string" ? m.tools.get(j.connector.trim()) : undefined;
      if (!tool || tool.kind !== kind) {
        drop("a tool not sent, or not one for this kind of job", x);
        continue;
      }
      const q = words(j.query, JOB_LIMITS.query);
      if (!q || q.length < 2) {
        drop("its query's words or numbers aren't in what was sent", x);
        continue;
      }
      connector = tool.id;
      query = cleanLine(q).replace(/[“”"]/g, "").trim();
    }
    const title = words(j.title, JOB_LIMITS.title, query ? [query] : []);
    const why = words(j.why, JOB_LIMITS.why, query ? [query] : []);
    if (!title || !why) {
      drop("its words or numbers aren't in what was sent", x);
      continue;
    }
    let questions: string[] | undefined;
    let who: JobWho[] | undefined;
    if (kind === "talk" || kind === "read-code") {
      const asked = strs(j.questions)
        .map((q) => words(q, JOB_LIMITS.question))
        .filter((q): q is string => !!q);
      questions = [...new Set(asked)].slice(0, kind === "talk" ? JOB_LIMITS.questions : 2);
      if (!questions.length) {
        drop("no question it can stand behind", x);
        continue;
      }
    }
    if (kind === "talk") {
      who = [];
      for (const w of Array.isArray(j.who) ? j.who.map(rec) : []) {
        const ref = typeof w.ref === "string" ? w.ref.trim() : "";
        const reason = words(w.why, JOB_LIMITS.whoWhy) ?? "";
        const segment = m.segments.get(ref);
        const person = m.people.get(ref);
        const next: JobWho | null = segment ? { kind: "segment", id: segment.id, name: segment.title, why: reason } : person ? { kind: "person", name: person.name, why: reason } : ref === "team" ? { kind: "team", name: "The team", why: reason } : null;
        if (!next) drop("someone not named in what was sent", w);
        else if (who.length < JOB_LIMITS.who && !who.some((y) => y.kind === next.kind && y.name === next.name)) who.push(next);
      }
    }
    // Planned already, for this goal or by this answer.
    const twin = (y: Pick<Job, "kind" | "title" | "connector" | "query">) => same(y.title, title) || (y.kind === kind && !!query && y.connector === connector && !!y.query && same(y.query, query));
    if (m.planned.some(twin) || out.some(twin)) {
      drop("planned already", x);
      continue;
    }
    out.push({
      id: o.id(),
      goal: o.goal,
      ...(gap ? { gap: gap.key } : {}),
      kind,
      title,
      why,
      ...(connector ? { connector } : {}),
      ...(query ? { query } : {}),
      ...(questions ? { questions } : {}),
      ...(who ? { who } : {}),
      status: "todo",
      results: [],
      by: "qalam",
      at: o.now,
      changed: o.now,
    });
  }
  return out;
}

/** A job as its first line in hub/jobs.jsonl. */
export function jobLine(j: Job): JobLog {
  const { changed: _c, ...line } = j;
  return line;
}
