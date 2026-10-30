import { goalText, type OrgGoal } from "@/org/context-md";
import { tally, tallyText, type Voice } from "./people";
import { checkWords, sameTopic, SECTION_HEADING, type Topic } from "./topics";

/**
 * Which outcome would move a goal (pure). A stated goal is often a business number; a team moves it
 * through a change in what customers do. Qalam AI reads the goal, what the organization says about
 * itself, and its need pages (each with how many people raise it, counted by code) and proposes a
 * few product outcomes, each resting on the needs and lines it cites. Code keeps a candidate only
 * when it cites what was sent and its quotes and numbers are in it (or in the goal), and never one
 * a board already works on.
 */

export const OUTCOME_LIMITS = { needs: 40, lines: 240, candidates: 3, title: 120, why: 600, moves: 400 } as const;

export interface OutcomesSent {
  ref: string;
  text: string;
  /** The page it's on (a need's id). */
  topic: string;
}

export interface OutcomesMaterial {
  text: string;
  /** Ids a candidate may cite (t…, l…). */
  ids: string[];
  /** Need pages, as the call named them (t…), by topic id. */
  needs: Map<string, string>;
  sent: Map<string, OutcomesSent>;
  /** The goal's words, which a candidate may repeat. */
  goal: string;
  /** Outcomes boards already work on (a candidate isn't one of them). */
  existing: string[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The quotes a need page's "We know" lines cite, and who said them: how many people raise it. */
export function raisedBy(t: Topic, voices: ReadonlyMap<string, Voice>) {
  const refs = [...new Set(t.lines.filter((l) => l.section === "know").flatMap((l) => l.cites))];
  return tally(refs.flatMap((r) => voices.get(r) ?? []));
}

export function outcomesMaterial(o: {
  goal: OrgGoal;
  owner: string;
  context: string;
  topics: Topic[];
  voices: ReadonlyMap<string, Voice>;
  outcomes: { title: string; board: string; metric?: string }[];
  product: string | null;
}): OutcomesMaterial {
  const sent = new Map<string, OutcomesSent>();
  const needs = new Map<string, string>();
  const out = [`The goal (${o.owner}'s): ${goalText(o.goal)}`];
  if (o.context.trim()) out.push("", o.context.trim());
  if (o.outcomes.length) out.push("", "Outcomes boards already work on (don't propose these again):", ...o.outcomes.map((x) => `- “${one(x.title)}”${x.metric ? ` · ${x.metric}` : ""} · on ${x.board}`));
  // The needs for this product (or every need, for the organization's goal), the most raised first.
  const pages = o.topics
    .filter((t) => t.kind === "need" && (!o.product || !t.products.length || t.products.includes(o.product)))
    .map((t) => ({ t, by: raisedBy(t, o.voices) }))
    .sort((a, b) => b.by.voices - a.by.voices || b.t.updatedAt - a.t.updatedAt)
    .slice(0, OUTCOME_LIMITS.needs);
  out.push("", pages.length ? "Customers' needs, from the topic pages (id · need · how many raise it, counted by code), each with its lines (id · part: words):" : "The organization has no need pages yet.");
  let ln = 0;
  for (const [i, { t, by }] of pages.entries()) {
    const tid = `t${i + 1}`;
    needs.set(tid, t.id);
    const raised = by.voices ? `raised by ${tallyText(by)}` : "no customer's words behind it yet";
    sent.set(tid, { ref: `hub:topic:${t.id}`, text: `${t.title}\n${raised}`, topic: t.id });
    out.push(`- ${tid} · “${one(t.title)}” · ${raised}`);
    for (const l of t.lines) {
      if (ln >= OUTCOME_LIMITS.lines) break;
      const lid = `l${++ln}`;
      sent.set(lid, { ref: `hub:topic:${t.id}:${l.id}`, text: [l.text, ...(l.disputes ?? []).map((d) => d.text)].join("\n"), topic: t.id });
      out.push(`  - ${lid} · ${SECTION_HEADING[l.section]}${l.by === "person" ? " (the team's words)" : ""}: ${one(l.text)}`);
    }
  }
  out.push("", "Which product outcomes would move the goal?");
  return { text: out.join("\n"), ids: [...sent.keys()], needs, sent, goal: goalText(o.goal), existing: o.outcomes.map((x) => x.title) };
}

export interface OutcomeCandidate {
  title: string;
  metric: { name: string; direction: "increase" | "decrease" };
  why: string;
  /** How it moves the goal. */
  moves: string;
  /** Whether the team can move it by what it builds. */
  control: "yes" | "partly" | "no";
  /** The need pages it rests on (topic ids). */
  needs: string[];
  /** What it cites, as refs. */
  refs: string[];
}

const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

/** What code keeps of the candidates: each on what it cites, its words found there, none a board already has. */
export function sanitizeOutcomes(raw: unknown, m: OutcomesMaterial): { candidates: OutcomeCandidate[]; note?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const candidates: OutcomeCandidate[] = [];
  for (const c of items(r.candidates)) {
    if (candidates.length >= OUTCOME_LIMITS.candidates) break;
    const ids = [...new Set((Array.isArray(c.cites) ? c.cites : []).filter((x): x is string => typeof x === "string" && m.sent.has(x.trim())).map((x) => x.trim()))];
    // At least one line of what customers said or did (a need page alone is only its title).
    if (!ids.some((id) => id.startsWith("l"))) continue;
    const cited = ids.map((id) => m.sent.get(id)!);
    const title = checkWords(c.title, cited, m.goal, OUTCOME_LIMITS.title);
    const metric = (c.metric ?? {}) as Record<string, unknown>;
    const name = checkWords(metric.name, cited, m.goal, OUTCOME_LIMITS.title);
    const why = checkWords(c.why, cited, m.goal, OUTCOME_LIMITS.why);
    const moves = checkWords(c.moves, cited, m.goal, OUTCOME_LIMITS.moves);
    if (!title || !name || !why || !moves) continue;
    if (m.existing.some((x) => sameTopic(x, title)) || candidates.some((x) => sameTopic(x.title, title))) continue;
    const needs = [...new Set([...(Array.isArray(c.needs) ? c.needs : []).flatMap((x) => (typeof x === "string" ? (m.needs.get(x.trim()) ?? []) : [])), ...cited.map((x) => x.topic)])];
    candidates.push({
      title: title.replace(/[.。]+$/, ""),
      metric: { name, direction: metric.direction === "decrease" ? "decrease" : "increase" },
      why,
      moves,
      control: c.control === "yes" || c.control === "no" ? c.control : "partly",
      needs,
      refs: cited.map((x) => x.ref),
    });
  }
  const note = typeof r.note === "string" && r.note.trim() ? checkWords(r.note, [], m.goal, 400) : null;
  return { candidates, ...(note ? { note } : {}) };
}
