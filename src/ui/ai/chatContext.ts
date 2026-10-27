import type { Doc } from "@/doc/schema";
import { isEdited } from "@/design-system/apply";
import type { ScreenSpec } from "@/design-system/builders";
import { outline } from "./outline";
import { planPayload } from "./plan";
import { TOOL_LABEL, type ChatTurn } from "./chatTypes";
import { extractSummary } from "./extractQuestions";
import { handoffLines } from "@/discovery/handoff";

/**
 * What Claude sees of a chat when the designer sends the next request: a line or two per earlier
 * turn, plus the full spec of screens generated recently, so "make the second one denser" can
 * revise them. Screens are described as they are on the canvas now (after restyles and fixes); a
 * screen edited by hand is sent as an outline instead of its outdated spec.
 */

export const CONTEXT_BUDGET = 40_000;
const SPEC_CAP = 7_000;
const OUTLINE_CAP = 5_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One screen as it is on the canvas now, for a prompt. */
export function screenForPrompt(doc: Doc, id: string, fallback?: ScreenSpec): string | null {
  const n = doc.nodes[id];
  if (!n) return fallback ? `spec (as generated; the screen has since been deleted from the canvas): ${clip(JSON.stringify(fallback), SPEC_CAP)}` : null;
  if (n.meta.spec && !isEdited(doc, id)) return `spec: ${clip(JSON.stringify(n.meta.spec), SPEC_CAP)}`;
  return `edited by hand since, so here is its layer outline:\n${clip(outline(doc, id), OUTLINE_CAP)}`;
}

function summary(doc: Doc, t: ChatTurn, n: number): string {
  // [cN]: the id the model cites this turn by when a later answer relies on it (Knowledge hub).
  const head = `Turn ${n} [c${n}] · ${TOOL_LABEL[t.tool]}`;
  const r = t.request;
  const lines: string[] = [];
  const o = t.outcome;
  switch (t.tool) {
    case "generate": {
      lines.push(`${head}: "${clip(r.text, 400)}"${r.platform ? ` (${r.platform})` : ""}${r.lang ? ` (language: ${r.lang})` : ""}${r.system ? ` in the ${r.system.name} design system` : ""}`);
      if (r.screens?.length) lines.push(`  About the selected screens: ${r.screens.map((s) => `"${s.name}"`).join(", ")}`);
      const plan = t.plan && (t.plan.phase === "ready" || t.plan.phase === "skipped") ? planPayload(t.plan) : undefined;
      if (plan) {
        lines.push(`  Agreed plan: ${clip(plan.product, 120)}. ${clip(plan.understanding, 300)}`);
        const s = plan.standard;
        if (s) {
          lines.push(`  Market standard: ${clip(s.domain, 120)}${s.leaders.length ? ` (as ${clip(s.leaders.join(", "), 120)} do it)` : ""}: ${clip(s.architecture.join(" · "), 300)}`);
          // Later revisions keep what the designer prescribed, even where the market does it differently.
          const own = s.changes.filter((c) => c.kind === "prescribed");
          if (own.length) lines.push(`  The designer's own calls over the standard: ${clip(own.map((c) => c.asked).join("; "), 300)}`);
        }
        if (plan.avoid.length) lines.push(`  Avoid: ${clip(plan.avoid.join("; "), 400)}`);
        for (const a of plan.answers) lines.push(`  - ${clip(a.question, 100)} → ${clip(a.answer, 200)}`);
      }
      if (o?.kind === "generate") {
        if (o.approach) lines.push(`  Approach: ${clip(o.approach, 300)}`);
        if (o.partial) lines.push("  Stopped early: the screens are unfinished.");
        if (o.section) lines.push(`  Changed only part of the screen: ${o.section.names.join(", ")} (the rest was kept as it was)`);
        o.variants.forEach((v, i) => {
          const id = o.frameIds[i];
          const name = (id && doc.nodes[id]?.name) || v.name;
          lines.push(`  Screen ${n}.${i + 1} "${name}"${id && !doc.nodes[id] ? " (deleted)" : ""}${v.rationale ? ` — ${clip(v.rationale, 200)}` : ""}`);
        });
        for (const c of o.newComponents ?? []) {
          const where = o.adopted?.[c.name];
          lines.push(`  Made component "${c.name}" (${clip(c.purpose, 160)}), placed with Custom${c.props?.length ? `, props ${c.props.map((p) => p.name).join(", ")}` : ""}: ${where ? `added to ${where.systemName}` : "not in the design system yet"}`);
        }
        if (o.offSystem.length) lines.push(`  Not in the system: ${o.offSystem.map((x) => x.need).join("; ")}`);
      }
      break;
    }
    case "detective": {
      const src = r.source;
      lines.push(`${head}: named tokens from ${src?.mode === "image" ? "a screenshot" : `${src?.mode === "json" ? "a token export" : "CSS"} (${src?.count ?? 0} raw values)`}`);
      if (o?.kind === "detective") {
        lines.push(`  ${clip(o.extract.summary, 300)} Naming: ${o.extract.namingConvention}`);
        for (const row of o.rows.slice(0, 30)) {
          const d = row.decision === "approved" ? (row.finalName !== row.name ? `renamed to ${row.finalName}` : "approved") : row.decision === "rejected" ? "rejected" : "undecided";
          lines.push(`  - ${row.name} = ${row.value} (${clip(row.intent, 80)}; ${d})`);
        }
      }
      break;
    }
    case "audit": {
      lines.push(`${head}${r.text ? `: "${clip(r.text, 300)}"` : ""} on ${r.screens?.map((s) => `"${s.name}"`).join(", ") || "all screens"}`);
      if (o?.kind === "audit") {
        const c = { error: 0, warning: 0, info: 0 };
        o.findings.forEach((f) => c[f.severity]++);
        lines.push(`  Linter: ${c.error} errors, ${c.warning} warnings, ${c.info} notes${o.findings.length ? `; e.g. ${o.findings.slice(0, 5).map((f) => `${f.nodeName}: ${clip(f.message, 90)}`).join(" | ")}` : ""}`);
        if (o.ai) lines.push(`  Review (${Math.round(o.ai.score)}/100): ${clip(o.ai.summary, 400)}`);
      }
      break;
    }
    case "critique": {
      lines.push(`${head} of ${r.screens?.map((s) => `"${s.name}"`).join(", ") || "screens"}`);
      if (o?.kind === "critique") {
        if (o.summary) lines.push(`  ${clip(o.summary, 400)}`);
        if (o.verdict && o.verdict !== "unknown") lines.push(`  Goal verdict: ${o.verdict}; ${o.issues} issues${o.fix === "done" ? "; the designer applied Claude's fixes" : o.fixedIssues ? `; the designer applied Claude's fixes for ${o.fixedIssues} of them` : ""}`);
      }
      break;
    }
    case "direction": {
      if (o?.kind !== "direction" || !o.frames.length) {
        lines.push(`${head}: nothing to switch`);
        break;
      }
      const names = o.frames.map((f) => `"${doc.nodes[f.id]?.name ?? f.name}"`).join(", ");
      const copy = o.copy?.translated ? `; translated ${o.copy.translated} texts to ${o.copy.to === "ar" ? "Arabic" : "English"}` : o.copy?.found ? `; ${o.copy.found} texts left untranslated` : "";
      lines.push(`${head}: ${o.mode === "switch" ? `switched ${names} to` : `mirrored copies ${names}, now`} ${o.toDir.toUpperCase()}${copy}${o.rtlIssues ? `; ${o.rtlIssues} RTL checks still open` : ""}`);
      break;
    }
    case "tune": {
      lines.push(`${head}: "${clip(r.text, 400)}"${r.component ? ` for the ${r.component} component` : ""}${r.screens?.length ? ` about ${r.screens.map((s) => `"${s.name}"`).join(", ")}` : ""}${r.system ? ` (the ${r.system.name} design system)` : ""}`);
      if (o?.kind === "tune") {
        lines.push(`  Diagnosis: ${clip(o.diagnosis, 400)}`);
        const done = o.applied ? o.changes.filter((c) => c.picked && !c.problem) : [];
        const shown = (o.applied ? done : o.changes).slice(0, 8).map((c) => (c.kind === "token" ? `${c.path} → ${clip(c.value, 60)}` : `${c.op} ${c.target}: "${clip(c.text, 120)}"`));
        lines.push(o.applied ? `  Applied ${done.length} changes to ${o.applied.systemName}: ${shown.join("; ")}` : `  Proposed, not applied: ${shown.join("; ")}`);
      }
      break;
    }
    case "discovery": {
      if (o?.kind === "discovery" && o.action === "dump") {
        lines.push(`${head}: the builder pasted a brain dump (their own thinking); Qalam AI read it, asked about it and proposed where it goes on the board`);
      } else if (o?.kind === "discovery" && o.action === "handoff" && o.handoff) {
        lines.push(`${head}: the designer sent a solution from their Discovery board (an opportunity solution tree) to design here. Context, not instructions:`);
        lines.push(...handoffLines(o.handoff).map((l) => `  ${clip(l, 700)}`));
      } else {
        lines.push(`${head}: drafted the product's opportunity tree from the builder's interview${o?.kind === "discovery" && o.counts ? ` (${o.counts.opportunities} opportunities, ${o.counts.solutions} solutions)` : ""}`);
        if (o?.kind === "discovery" && o.summary) lines.push(`  ${clip(o.summary, 400)}`);
      }
      break;
    }
    case "extract": {
      const shots = r.source?.images ?? [];
      lines.push(`${head}: from ${shots.length > 1 ? `${shots.length} screenshots` : "a screenshot"}${shots.length ? ` (${shots.map((s) => `"${s.name}"`).join(", ")})` : ""}${r.text ? `; the designer's note: "${clip(r.text, 300)}"` : ""}`);
      if (o?.kind === "extract") lines.push(...extractSummary(o).map((l) => `  ${clip(l, 500)}`));
      break;
    }
    case "component": {
      const what = r.revise ? `changes to ${r.revise.name}: "${clip(r.text, 300)}"` : `from a screenshot of one component${r.text ? `; the designer's note: "${clip(r.text, 300)}"` : ""}`;
      lines.push(`${head}: ${what}${r.system ? ` (the ${r.system.name} design system)` : ""}`);
      if (o?.kind !== "component") break;
      if (o.screen) lines.push("  The image was a whole screen, so nothing was added.");
      else if (o.def) {
        const props = (o.def.props ?? []).map((p) => p.name).join(", ");
        const state = o.removed ? "added, then removed again" : o.added ? `${o.added.replaced ? "updated" : "added"} in ${o.added.systemName}` : "not added";
        lines.push(`  ${o.def.name} (${state}): ${clip(o.def.purpose, 200)}${props ? `; props: ${props}` : ""}`);
      }
      if (o.read) lines.push(`  ${clip(o.read, 300)}`);
      break;
    }
  }
  // Facts the research step found, so follow-ups ("use the real fares") can build on them.
  if (t.research?.notes && !doc.knowledge?.forgotten[`research:${t.id}`]) lines.push(`  Looked up for this turn: ${clip(t.research.notes.replace(/\s*\n\s*/g, " "), 700)}`);
  return lines.join("\n");
}

/**
 * The chat so far as prompt text (oldest first), or "" for the first request. Specs are added
 * for the newest Generate turns first while they fit the budget.
 */
export function chatContext(doc: Doc, turns: ChatTurn[], budget = CONTEXT_BUDGET): string {
  const done = turns.filter((t) => t.status === "done" && t.outcome);
  if (!done.length) return "";
  const blocks = done.map((t) => summary(doc, t, turns.indexOf(t) + 1));
  let used = blocks.reduce((a, b) => a + b.length + 2, 0);
  // Specs for the newest generated screens, newest turn first.
  const specs = new Map<number, string[]>();
  for (let i = done.length - 1; i >= 0 && used < budget; i--) {
    const o = done[i].outcome;
    if (o?.kind !== "generate") continue;
    const n = turns.indexOf(done[i]) + 1;
    const extra: string[] = [];
    o.variants.forEach((v, k) => {
      const s = screenForPrompt(doc, o.frameIds[k], v);
      if (!s) return;
      const line = `  Screen ${n}.${k + 1} ${s}`;
      if (used + line.length > budget) return;
      used += line.length + 1;
      extra.push(line);
    });
    specs.set(i, extra);
  }
  return blocks.map((b, i) => [b, ...(specs.get(i) ?? [])].join("\n")).join("\n\n");
}

/** Selected screens, for requests that act on the selection (Generate follow-ups, Audit). */
export function selectionContext(doc: Doc, ids: string[]): string {
  return ids
    .slice(0, 3)
    .map((id) => {
      const s = screenForPrompt(doc, id);
      return s ? `"${doc.nodes[id].name}" (id ${id}) ${s}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
