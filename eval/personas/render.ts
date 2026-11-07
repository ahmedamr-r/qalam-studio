import type { PlanCard } from "@/space/plan";
import type { BaselineRun } from "./baseline";
import type { PlanRun, ScanRun } from "./bench";

/** Each side's output as one neutral document, in the sections both were asked for, so a judge reads content rather than a canvas. */

const cardLines = (c: PlanCard) => [
  `**${c.title}**${c.type ? ` (${c.type})` : ""}`,
  ...(c.description ? [c.description] : []),
  ...(c.how ? [`How: ${c.how}`] : []),
  ...(c.why ? [`Why: ${c.why}`] : []),
  ...(c.came ? [`Rests on: ${String(c.came)}`] : []),
  ...c.read.slice(0, 3).map((l) => `Read online: ${l.text}${l.url ? ` (${l.url})` : ""}`),
  ...c.assumptions.map((a) => `Assumes (${a.category}, importance ${a.importance}): ${a.text}`),
  ...(c.test ? [`Test: ${c.test.what}. ${c.test.how}${c.test.suggested ? ` Pass: ${c.test.suggested}` : ""}`] : []),
];

export function renderPlan(r: PlanRun): string {
  const d = r.draft;
  if (!d) return "(nothing proposed)";
  const refOf = (c: PlanCard) => (c.under && "ref" in c.under ? c.under.ref : null);
  const goals = d.cards.filter((c) => c.kind === "outcome");
  const problems = d.cards.filter((c) => c.kind === "opportunity");
  const solutions = d.cards.filter((c) => c.kind === "solution");
  const out: string[] = ["# Goal", ""];
  if (!goals.length) out.push("(none proposed)");
  for (const g of goals) out.push(`**${g.title}**`, ...(g.metric?.name ? [`Measured by: ${g.metric.name}${g.metric.target != null ? `, target ${g.metric.target}` : ""}`] : []), ...(g.description ? [g.description] : []), ...(g.why ? [`Why: ${g.why}`] : []), "");
  out.push("", "# Problems", "");
  if (!problems.length) out.push("(none proposed)");
  for (const p of problems) out.push(...cardLines(p), "");
  out.push("", "# Solutions", "");
  for (const p of problems) {
    const under = solutions.filter((s) => refOf(s) === p.ref);
    if (under.length) out.push(`For "${p.title}":`, "");
    for (const s of under) out.push(...cardLines(s), "");
  }
  const lone = solutions.filter((s) => !problems.some((p) => p.ref === refOf(s)));
  for (const s of lone) out.push(...cardLines(s), "");
  const start = d.cards.find((c) => c.ref === d.start);
  out.push("", "# Start here", "", start ? `**${start.title}**` : "(nothing picked)");
  out.push("", "# What I'm unsure of", "", d.doubt || "(nothing said)");
  // What their own evidence said against what was proposed (src/challenge/), before they saw it.
  const raised = (r.checks ?? []).flatMap((c) => c.challenges);
  if (raised.length) {
    out.push("", "# What your own evidence says", "");
    for (const c of raised) out.push(`- ${c.line}${c.settle ? ` To settle it: ${c.settle}` : ""}`);
    if (r.before) out.push("", `Proposed again by it. Before: ${r.before.cards.map((c) => c.title).join(" · ")}`);
  }
  out.push("", "# What was looked up", "");
  for (const l of r.body.looks) {
    out.push(`Looked up: ${l.query || "what people do about this"}${l.noWeb ? " (no web here)" : ""}`);
    for (const x of l.lines) out.push(`- ${x.text}${x.url ? ` (${x.url})` : ""}`);
  }
  out.push("", "# PRD", "", r.brief?.markdown || "(none written)");
  return out.join("\n");
}

export function renderScan(r: ScanRun): string {
  const out: string[] = ["# Goal", "", r.goal ? `**${r.goal.title}**\nMeasured by: ${r.goal.metric}` : "(none set)", "", `Who it's for first: ${r.audience ?? "(none picked)"}`];
  if (r.audiences.length) out.push("", "Offered:", ...r.audiences.map((a) => `- ${a.name}: ${a.about}`));
  out.push("", "", "# Problems", "");
  if (!r.problems.length) out.push("(none found)");
  for (const p of r.problems) {
    out.push(`**${p.title}**`, p.line);
    for (const l of p.lines.slice(0, 8)) out.push(`- [${l.section}] ${l.text}`);
    out.push("");
  }
  out.push("", "# Solutions", "");
  if (r.build) {
    out.push(`For "${r.build.problem}":`, "");
    for (const d of r.build.drafts) out.push(`**${d.title}**${d.type ? ` (${d.type})` : ""}`, d.description, ...d.assumptions.map((a) => `Assumes: ${a}`), ...(d.test ? [`Test: ${d.test}`] : []), "");
    if (r.build.note) out.push(`Note: ${r.build.note}`);
  } else out.push("(none drafted)");
  const pick = r.build?.drafts.find((d) => d.id === r.build?.pick?.draft);
  out.push("", "# Start here", "", pick ? `**${pick.title}**\n${r.build?.pick?.why ?? ""}` : "(nothing picked)");
  const s = r.session;
  out.push("", "# What I'm unsure of", "", s?.thin ? "It said it found little to go on." : "(nothing said)", "", "# What was looked up", "");
  for (const c of s?.competitors ?? []) out.push(`- Uses today: ${c.name}`);
  for (const x of s?.read ?? []) out.push(`- ${x.title} (${x.origin}): ${x.quotes ?? 0} quotes`);
  for (const k of s?.known ?? []) out.push(`- Read elsewhere: ${k.name ? `${k.name}: ` : ""}${k.text} (${k.url})`);
  for (const n of s?.notRead ?? []) out.push(`- Not read (${n.why}): ${n.url}`);
  out.push("", "# PRD", "", r.brief?.markdown || "(none written)");
  return out.join("\n");
}

/** What the real app ended with: the canvas's cards, what the chat said, and the brief. */
export function renderTab(r: { cards: { id: string; kind: string; title: string; description: string; parent: string | null; assumptions: string[]; test: string }[]; thread: string; brief: string }): string {
  const line = (c: (typeof r.cards)[number]) => [`**${c.title}**`, ...(c.description ? [c.description] : []), ...c.assumptions.map((a) => `Assumes: ${a}`), ...(c.test ? [`Test: ${c.test}`] : []), ""];
  const of = (k: string) => r.cards.filter((c) => c.kind === k);
  const out: string[] = ["# Goal", ""];
  for (const g of of("outcome")) out.push(...line(g));
  out.push("", "# Problems", "");
  for (const p of of("opportunity")) out.push(...line(p));
  out.push("", "# Solutions", "");
  for (const p of of("opportunity")) {
    const under = of("solution").filter((s) => s.parent === p.id);
    if (under.length) out.push(`For "${p.title}":`, "");
    for (const s of under) {
      out.push(...line(s));
      for (const t of of("test").filter((x) => x.parent === s.id)) out.push(`Test: ${t.title}${t.test ? `: ${t.test}` : ""}`, "");
    }
  }
  out.push("", "# What the chat said", "", r.thread.slice(0, 6000), "", "# PRD", "", r.brief || "(none written)");
  return out.join("\n");
}

export const renderBaseline = (r: BaselineRun) => r.final || r.turns.filter((t) => t.role === "agent").at(-1)?.text || "(no answer)";

/** The part that's the PRD, so it can be measured alone. */
export function prdOf(text: string): string {
  const at = text.search(/^#\s*PRD\b/im);
  return at < 0 ? "" : text.slice(at).replace(/^#\s*PRD\s*\n?/i, "").trim();
}

/** Words that give a side away. */
const GIVEAWAYS: [RegExp, string][] = [
  [/\bQalam( AI| Studio)?\b/gi, "the tool"],
  [/\bClaude( Code)?\b/gi, "the tool"],
  [/Written \d{4}-\d{2}-\d{2} from what's kept here\.[^\n]*/g, ""],
  [/Suggested from the above, not anything anyone asked for\. Change whatever doesn't fit\./g, ""],
];

export const neutral = (text: string) => GIVEAWAYS.reduce((t, [re, to]) => t.replace(re, to), text);
