import { studio } from "@/doc/store";
import { callAI } from "@/ai/client";
import { systemPayload } from "@/ai/ds-payload";
import type { RepairResult } from "@/ai/schemas";
import { lintSpec, type SpecIssue } from "@/design-system/spec-lint";
import { fixSpec } from "@/design-system/spec-fix";
import { systemFor, tokenSetFor } from "@/design-system/registry";
import { ensureSystemFonts } from "@/design-system/place";
import { replaceScreen } from "@/design-system/apply";
import type { ScreenSpec } from "@/design-system/builders";
import { ensureYoga } from "@/engine/layout";
import { auditSubtree, lintNodes } from "@/lint/rules";

/**
 * The self-check after generation: every new screen is checked (its spec, and its render as the
 * linter measures it), and whatever is wrong goes back to the model once, with the exact spec path
 * of each problem. A repaired screen replaces the original only if it comes out with fewer issues.
 */

/**
 * Linter rules on the rendered screen that a spec change can fix (a shorter string, another tone
 * or variant). Icon contrast and target sizes aren't: icon colours come from the design system's
 * tokens and component sizes from its builders (no spec prop sets them), so they count as system
 * issues, for Tune. Sending them to the model only costs a round trip that can't fix anything.
 */
const RENDER_RULES = new Set(["text-overflow", "truncated", "squeezed-text", "contrast", "rtl-direction", "rtl-icon-mirror", "arabic-letter-spacing"]);
const SYSTEM_RULES = new Set(["non-text-contrast", "touch-target"]);

/** Problems on a screen that come from its design system's tokens, not from its spec. */
export function systemIssues(rootIds: string[]): number {
  const { doc } = studio();
  return auditSubtree(doc, rootIds).filter((f) => SYSTEM_RULES.has(f.rule) && f.severity !== "info").length;
}

/** What's wrong with a built screen: its spec's checks plus the linter's measurements, by spec path. */
export function screenIssues(rootId: string): SpecIssue[] {
  const { doc } = studio();
  const root = doc.nodes[rootId];
  const spec = root?.meta.spec as ScreenSpec | undefined;
  if (!spec) return [];
  const issues = lintSpec(spec, tokenSetFor(root.meta.designSystem), systemFor(root.meta.designSystem ?? "builtin").docs.patterns);
  for (const f of auditSubtree(doc, [rootId])) {
    if (!RENDER_RULES.has(f.rule) || f.severity === "info") continue;
    let n = doc.nodes[f.nodeId];
    while (n && n.meta.specPath === undefined && n.parentId) n = doc.nodes[n.parentId];
    issues.push({ path: n?.meta.specPath ?? "", rule: f.rule, severity: f.severity === "error" ? "error" : "warning", message: f.message });
  }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.path}|${i.rule}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface RepairOutcome {
  /** Issues found before the repair, and left after it. */
  found: number;
  remaining: number;
  /** Issues in the design system (e.g. icon colours below 3:1): Tune fixes them, not a repair. */
  system?: number;
  changes: { screen: string; path: string; summary: string }[];
  /** The repair call failed; the screens are as generated. */
  error?: string;
}

const weight = (list: SpecIssue[]) => list.reduce((s, i) => s + (i.severity === "error" ? 3 : 1), 0);

/** Repairs code makes on its own (fixSpec), each kept only if the screen comes out with fewer issues. */
async function fixInCode(frameIds: string[], dsId: string, before: SpecIssue[][]): Promise<RepairOutcome["changes"]> {
  const changes: RepairOutcome["changes"] = [];
  // Code's repairs measure how they lay out, so the engine and fonts come first.
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const fixes = frameIds.map((id) => {
    const root = studio().doc.nodes[id];
    const spec = root?.meta.spec as ScreenSpec | undefined;
    return spec ? fixSpec(spec, { library: systemFor(root.meta.designSystem ?? "builtin").docs.patterns, ts: tokenSetFor(root.meta.designSystem) }) : null;
  });
  if (!fixes.some((f) => f?.changes.length)) return changes;
  studio().beginTx();
  fixes.forEach((f, i) => {
    const id = frameIds[i];
    const old = studio().doc.nodes[id]?.meta.spec as ScreenSpec | undefined;
    if (!f?.changes.length || !old) return;
    replaceScreen(id, f.spec, dsId);
    lintNodes([id]);
    const after = screenIssues(id);
    if (weight(after) >= weight(before[i])) return replaceScreen(id, old, dsId);
    before[i] = after;
    for (const c of f.changes) changes.push({ screen: old.name, ...c });
  });
  studio().commitTx();
  return changes;
}

/** Check freshly placed screens and send what's wrong back to the model once. Null when nothing was wrong. */
export async function repairScreens(frameIds: string[], dsId: string, signal: AbortSignal, onProgress?: (t: number) => void): Promise<RepairOutcome | null> {
  const before = frameIds.map(screenIssues);
  const found = before.reduce((s, l) => s + l.length, 0);
  const system = systemIssues(frameIds);
  if (!found) return system ? { found: 0, remaining: 0, changes: [], system } : null;
  // What code can fix exactly is fixed first; the model gets what's left.
  const changes = await fixInCode(frameIds, dsId, before);
  if (!before.some((l) => l.length)) {
    lintNodes(frameIds);
    return { found, remaining: 0, changes, ...(system ? { system } : {}) };
  }
  const { doc } = studio();
  const screens = frameIds
    .map((id, index) => ({ index, spec: doc.nodes[id]?.meta.spec, issues: before[index].slice(0, 40).map(({ path, rule, message }) => ({ path, rule, message: message.slice(0, 400) })) }))
    .filter((s) => s.spec && s.issues.length)
    .slice(0, 4);
  const { data } = await callAI<RepairResult>("/api/repair", { screens, designSystem: systemPayload(systemFor(dsId)) }, onProgress, signal);
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  studio().beginTx();
  for (const r of data.screens ?? []) {
    const id = frameIds[r.index];
    const root = id ? studio().doc.nodes[id] : undefined;
    const old = root?.meta.spec as ScreenSpec | undefined;
    if (!root || !old || !r.screen || !Array.isArray(r.screen.body)) continue;
    // The repair may not move the screen to another platform, language or name.
    const next: ScreenSpec = { ...r.screen, name: old.name, rationale: old.rationale, platform: old.platform, dir: old.dir, lang: old.lang };
    replaceScreen(id, next, dsId);
    lintNodes([id]);
    // Keep it only if it's better.
    if (weight(screenIssues(id)) >= weight(before[r.index])) {
      replaceScreen(id, old, dsId);
      continue;
    }
    for (const c of r.changes ?? []) changes.push({ screen: old.name, path: String(c.path ?? ""), summary: String(c.summary ?? "") });
  }
  studio().commitTx();
  lintNodes(frameIds);
  const remaining = frameIds.map(screenIssues).reduce((s, l) => s + l.length, 0);
  return { found, remaining, changes, ...(system ? { system } : {}) };
}
