import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import type { Decision } from "@/decisions/model";
import { STRENGTH_LABEL, strengthOf } from "@/hub/strength";
import type { Voice } from "@/hub/people";
import { metricText } from "./dump";
import { stageLabel } from "./kinds";
import { movedSince } from "./readings";
import type { OstCard } from "./types";

/*
 * Where a board stands, as Markdown a team pastes for the people it answers to (pure): each
 * outcome with the goal it serves and its number, the target need with how strong what backs it
 * is, the solutions on it with their tests and, once shipped, how the number moved since; the
 * other needs in a line each; the latest decisions with their whys. All of it is the board's own
 * data, counted by code: nothing here is written by a model.
 */

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const q = (t: string) => `“${t.replace(/\s+/g, " ").trim()}”`;

export function boardSummary(doc: Doc, o: { name: string; now: number; goalOf?: (c: OstCard) => string | undefined; voices?: ReadonlyMap<string, Voice>; decisions?: Decision[] }): string {
  const card = (id: string) => (isOstCard(doc.nodes[id]) ? doc.nodes[id].meta.ost : null);
  const kids = (id: string) => (doc.nodes[id]?.children ?? []).filter((k) => card(k));
  const out: string[] = [`# ${o.name}: where it stands`, "", `${day(o.now)}`];

  const solution = (id: string, outcome: OstCard | null, depth: string) => {
    const s = card(id)!;
    const moved = s.stage === "shipped" && s.stageAt && outcome?.metric ? movedSince(outcome.metric, s.stageAt) : null;
    const since = moved ? `; since it shipped, ${outcome!.metric!.name || "the number"} went ${moved.before} → ${moved.after}${moved.better === true ? " (the right way)" : moved.better === false ? " (the wrong way)" : ""}` : "";
    out.push(`${depth}- Solution ${q(s.title)}: ${stageLabel("solution", s.stage).toLowerCase()}${s.owner ? `, owner ${s.owner}` : ""}${since}`);
    for (const t of kids(id).filter((k) => card(k)!.kind === "test")) {
      const tc = card(t)!;
      out.push(`${depth}  - Test ${q(tc.title)}: ${stageLabel("test", tc.stage).toLowerCase()}${tc.test?.criterion ? `, passes if ${tc.test.criterion}` : ""}${tc.test?.result ? `. Result: ${tc.test.result}` : ""}`);
    }
  };

  const need = (id: string, outcome: OstCard | null, depth: string) => {
    const n = card(id)!;
    const s = strengthOf(n, { now: o.now, voices: o.voices });
    const what = `${STRENGTH_LABEL[s.level]}${s.why ? `: ${s.why}` : ""}`;
    if (n.stage === "target") {
      out.push("", `${depth}### Target: ${q(n.title)}`, "", `${depth}What backs it: ${what}.`);
      for (const k of kids(id)) if (card(k)!.kind === "solution") solution(k, outcome, depth);
    } else {
      out.push(`${depth}- ${q(n.title)} (${stageLabel("opportunity", n.stage).toLowerCase()}): ${what}`);
      // Work under a need that isn't the target any more still shows: what's being tested, built or shipped.
      for (const k of kids(id)) if (card(k)!.kind === "solution" && ["testing", "building", "shipped"].includes(card(k)!.stage)) solution(k, outcome, `${depth}  `);
    }
    for (const k of kids(id)) if (card(k)!.kind === "opportunity") need(k, outcome, `${depth}  `);
  };

  const outcome = (id: string, level: number) => {
    const c = card(id)!;
    const goal = o.goalOf?.(c);
    out.push("", `${"#".repeat(Math.min(level, 3))} Outcome: ${q(c.title)}`, "");
    const facts = [goal && `Serves the goal ${q(goal)}`, c.metric && metricText(c.metric), c.stage !== "active" && stageLabel("outcome", c.stage), c.owner && `owner ${c.owner}`].filter(Boolean);
    if (facts.length) out.push(facts.join(" · "));
    const needs = kids(id).filter((k) => card(k)!.kind === "opportunity");
    const target = needs.filter((k) => card(k)!.stage === "target");
    for (const k of target) need(k, c, "");
    const rest = needs.filter((k) => !target.includes(k));
    if (rest.length) {
      out.push("", "Other needs under it:");
      for (const k of rest) need(k, c, "");
    }
    for (const k of kids(id)) if (card(k)!.kind === "outcome") outcome(k, level + 1);
  };

  for (const r of doc.roots) if (card(r)?.kind === "outcome") outcome(r, 2);
  const decisions = (o.decisions ?? []).filter((d) => !d.undone).slice(0, 8);
  if (decisions.length) {
    out.push("", "## Latest decisions", "");
    for (const d of decisions) out.push(`- ${day(d.at)} · ${d.what}${d.who ? ` (${d.who})` : ""}${d.why ? `. Why: ${d.why}` : ""}`);
  }
  return `${out.join("\n")}\n`;
}
