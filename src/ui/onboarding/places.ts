import { metricLine } from "@/goals/goals-md";
import { childrenOf, goalById } from "@/goals/tree";
import type { GoalTree } from "@/goals/types";
import type { OstMetric } from "@/discovery/types";
import type { Product } from "@/org/context-md";
import { pendingLines, type SetupField, type SetupSession } from "@/org/setup";
import { ORG_FIELD, PRODUCT_FIELD } from "../setup/review";

/*
 * The places on the setup's canvas (pure): the About and each product, as nodes the goals are wired
 * into. Each holds its lines: what it says now (read-only), and Qalam AI's proposed lines for it, to
 * accept or leave out in its panel. A product Qalam AI proposes keeps its place's key (`new:<ref>`)
 * once accepting a line makes it, so what's open and where the camera is don't jump.
 */

export type RowState = "proposed" | "accepted" | "discarded" | "kept";

export interface RestsOn {
  quotes: string[];
  answers: { question: string; answer: string }[];
}

export type LineField = SetupField;

export interface LineRow {
  id: string;
  field: LineField;
  label: string;
  text: string;
  state: RowState;
  rests: RestsOn;
  /** The quotes it rests on (the setup's), for the wires from their sources. */
  pieces: string[];
}

export interface Place {
  /** "org", a product's id, "new:<ref>" (a product Qalam AI proposes), or "named:<name>" (one they named at the know door). */
  key: string;
  title: string;
  /** A product not made yet. */
  fresh: boolean;
  lines: LineRow[];
}

export interface PlacesInput {
  org: string;
  session: SetupSession | null;
  products: readonly Product[];
  about: { context: string; audience: string; segments?: readonly string[] };
  quotes: readonly { id: string; text: string }[];
  /** Products named at the know door, not made yet. */
  named?: readonly string[];
}

const ORDER: SetupField[] = ["context", "audience", "segments"];

/** The place a line or a product belongs to: a product made from a proposed one keeps the proposal's key. */
export function placeKey(to: string | null, session: Pick<SetupSession, "made"> | null): string {
  if (!to || to === "org") return "org";
  if (to.startsWith("new:") || to.startsWith("named:")) return to;
  const ref = Object.entries(session?.made ?? {}).find(([, id]) => id === to)?.[0];
  return ref ? `new:${ref}` : to;
}

/** What a place says now, line by line, read-only. */
function kept(key: string, labels: Record<SetupField, string>, c: { context: string; audience: string; segments?: readonly string[] }): LineRow[] {
  const row = (field: SetupField, text: string): LineRow[] => (text.trim() ? [{ id: `${key}:${field}`, field, label: labels[field], text: text.trim(), state: "kept", rests: { quotes: [], answers: [] }, pieces: [] }] : []);
  return [...row("context", c.context), ...row("audience", c.audience), ...row("segments", (c.segments ?? []).join(", "))];
}

/** The About and each product (those there, those Qalam AI proposes, those they named), with their lines. */
export function placesOf(i: PlacesInput): Place[] {
  const s = i.session;
  const proposed = (s?.proposal?.lines ?? []).filter((l) => l.field !== "goals");
  const linesFor = (key: string, labels: Record<SetupField, string>): LineRow[] =>
    proposed
      .filter((l) => placeKey(l.to, s) === key)
      .sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field))
      .map((l) => ({ id: l.id, field: l.field, label: labels[l.field], text: l.text, state: s?.decided?.[l.id] ?? "proposed", rests: { quotes: l.pieces.flatMap((id) => i.quotes.find((q) => q.id === id)?.text ?? []), answers: l.answers }, pieces: l.pieces }));
  const places: Place[] = [{ key: "org", title: `About ${i.org}`, fresh: false, lines: [...linesFor("org", ORG_FIELD), ...kept("org", ORG_FIELD, i.about)] }];
  // Products Qalam AI proposes, in its order; made ones under the name they have now.
  for (const p of s?.proposal?.products ?? []) {
    const key = `new:${p.ref}`;
    const made = i.products.find((x) => x.id === s?.made?.[p.ref]);
    places.push({ key, title: made?.name ?? p.name, fresh: !made, lines: [...linesFor(key, PRODUCT_FIELD), ...(made ? kept(key, PRODUCT_FIELD, made) : [])] });
  }
  for (const p of i.products) {
    const key = placeKey(p.id, s);
    if (places.some((x) => x.key === key)) continue;
    places.push({ key, title: p.name, fresh: false, lines: [...linesFor(key, PRODUCT_FIELD), ...kept(key, PRODUCT_FIELD, p)] });
  }
  for (const name of i.named ?? []) {
    if (i.products.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    places.push({ key: `named:${name}`, title: name, fresh: true, lines: [] });
  }
  return places;
}

/** A place's lines in a few words: how many, and how many wait to be reviewed. */
export function placeLine(p: Pick<Place, "lines">): string {
  const n = p.lines.filter((l) => l.state !== "discarded").length;
  const open = p.lines.filter((l) => l.state === "proposed").length;
  if (!n) return "Nothing written yet";
  return `${n === 1 ? "1 line" : `${n} lines`}${open ? ` · ${open} to review` : ""}`;
}

/** How the review stands: Qalam AI's lines accepted, left out, and still to settle (their ids). */
export function reviewOf(s: SetupSession | null): { accepted: number; discarded: number; open: string[] } {
  const lines = s?.proposal?.lines ?? [];
  return { accepted: lines.filter((l) => s?.decided?.[l.id] === "accepted").length, discarded: lines.filter((l) => s?.decided?.[l.id] === "discarded").length, open: s ? pendingLines(s).map((l) => l.id) : [] };
}

/** A goal's number in a line: its name when it isn't the goal's own words, then where it stands (never the same words twice). */
export function numberLine(m: OstMetric | null | undefined, title: string): string {
  if (!m) return "No number yet";
  const line = metricLine(m);
  return [...new Set([m.name !== title ? m.name : null, line].filter((x): x is string => !!x))].join(": ");
}

/** The goals there now, in tree order, each with how deep it sits. */
export function treeRows(t: GoalTree): { id: string; title: string; depth: number; line: string; north: boolean }[] {
  const out: { id: string; title: string; depth: number; line: string; north: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const g = goalById(t, id);
    if (!g || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: g.title, depth, line: g.metric ? metricLine(g.metric) : "", north: id === t.north });
    childrenOf(t, id).forEach((c) => walk(c.id, depth + 1));
  };
  t.goals.filter((g) => !g.parent).forEach((g) => walk(g.id, 0));
  return out;
}
