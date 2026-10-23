import { callAI } from "@/ai/client";
import type { ElementBox } from "@/ai/ds-schemas";
import { RECONCILE_TOKEN_PATHS, type ReconcileModelResult } from "@/ai/ds-reconcile";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes } from "@/design-system/place";
import { measureElement, toLogical, type Capture } from "@/design-system/pixels";
import { describeRebuild, reconcile, structureProposals, type Proposal, type RebuildFacts, type ShotFacts, type Tried } from "@/design-system/reconcile";
import type { DesignSystem } from "@/design-system/registry";
import { TokenSet, type Tree } from "@/design-system/resolve";
import { inferStyles } from "@/design-system/structure";
import { measureStructure, type StructureEvidence } from "@/design-system/structure-pixels";
import { STYLE_AXES, STYLE_BY_PATH, structureLines } from "@/design-system/styles";
import { screenPNG } from "../componentPreviews";

/**
 * The extraction's compare-and-correct step, client side: draw the rebuild with the draft, tell
 * the model what the studio measured on both sides, and let code decide which of its proposals
 * to keep (src/design-system/reconcile.ts).
 */

export interface ReconcileState {
  status: "running" | "done" | "error";
  diagnosis?: string;
  /** Weighted error of the rebuild against the screenshot, before and after (0 = matches). */
  scoreBefore?: number;
  scoreAfter?: number;
  applied?: Tried[];
  rejected?: Tried[];
  suggestions?: Tried[];
  rebuildIssues?: { element: string; note: string }[];
  error?: string;
}

const r = (n: number) => Math.round(n);

/** What the screenshot clearly shows: structure the pixels decide, the tab bar's geometry, the primary button. */
function shotFactsOf(ev: StructureEvidence, elements: ElementBox[], pixels: ImageData, cap: Capture): ShotFacts {
  const decided = inferStyles(ev);
  const btn = elements
    .filter((e) => e.kind === "primary-button" && (Math.round(Number(e.image) || 1) === 1))
    .map((e) => measureElement(pixels, e.bbox, toLogical(cap)))
    .find(Boolean);
  return {
    styles: Object.fromEntries(Object.entries(decided).map(([p, d]) => [p, d.value])),
    ...(ev.nav ? { nav: { insetStart: ev.nav.insetStart, insetEnd: ev.nav.insetEnd, radius: ev.nav.radius, pill: ev.nav.pill, height: ev.nav.height } } : {}),
    ...(btn ? { button: { h: btn.h, radius: btn.radius, pill: btn.pill } } : {}),
  };
}

/** Both sides in plain lines, for the model. */
function measuredLines(ev: StructureEvidence, shot: ShotFacts, rebuild: RebuildFacts): string[] {
  const out: string[] = [];
  const n = ev.nav;
  if (n) out.push(`Screenshot tab bar: ${n.insetStart <= 2 && n.insetEnd <= 2 ? "full width" : `inset ${r(n.insetStart)}/${r(n.insetEnd)} px from the edges`}, ${r(n.height)} px tall, ${n.pill ? "round ends" : `${r(n.radius)} px corners`}${n.labels ? `, labels: ${n.labels}` : ""}.`);
  if (rebuild.nav) out.push(`Rebuild tab bar: ${rebuild.styles["component.nav-bar.style.placement"]}, inset ${r(rebuild.nav.insetStart)}/${r(rebuild.nav.insetEnd)} px, ${r(rebuild.nav.height)} px tall, labels: ${rebuild.styles["component.nav-bar.style.labels"]}.`);
  for (const [path, value] of Object.entries(shot.styles)) {
    const a = STYLE_BY_PATH.get(path)!;
    out.push(`${a.component} ${a.label.toLowerCase()}: the pixels show ${value}${rebuild.styles[path] ? `; the rebuild draws ${rebuild.styles[path]}` : ""}.`);
  }
  if (shot.button && rebuild.button) out.push(`Primary button: ${r(shot.button.h)} px tall in the screenshot, ${r(rebuild.button.h)} px in the rebuild.`);
  return out.slice(0, 30);
}

function outlineOf(spec: ScreenSpec): string {
  const one = (i: Inst): string => `${i.component}${i.children?.length ? `(${i.children.map(one).join(", ")})` : ""}`;
  return (["header", "hero", "body", "footer"] as const)
    .filter((k) => spec[k]?.length)
    .map((k) => `${k}: ${spec[k]!.map(one).join(", ")}`)
    .join("\n")
    .slice(0, 8000);
}

export interface CompareResult {
  state: ReconcileState;
  /** The corrected tree, when anything was kept. */
  tree?: Tree;
  /** One line for "What the studio measured and adjusted". */
  note?: string;
}

export async function compareAndCorrect(a: {
  draft: DesignSystem;
  spec: ScreenSpec;
  gaps: { element: string; workaround: string }[];
  image: { mediaType: string; data: string };
  capture: Capture;
  pixels: ImageData;
  elements?: ElementBox[];
  signal: AbortSignal;
}): Promise<CompareResult> {
  // Measurements in the pixels we actually have, whatever size they were decoded at.
  const cap: Capture = { ...a.capture, sentWidth: a.pixels.width, sentHeight: a.pixels.height };
  const elements = (a.elements ?? []).filter((e) => Math.round(Number(e?.image) || 1) === 1);
  const build = (tree: Tree) => buildScreenNodes(a.spec, a.draft.id, { x: 0, y: 0 }, "import", { ...a.draft, tree });
  const render = await screenPNG(a.spec, a.draft);
  if (!render) throw new Error("The rebuild couldn't be drawn.");
  const ev = measureStructure(elements, [a.pixels], [cap]);
  const shot = shotFactsOf(ev, elements, a.pixels, cap);
  const now = describeRebuild(build(a.draft.tree));
  const ts = new TokenSet(a.draft.tree);
  const value = (p: string) => String(ts.get(p)?.value ?? STYLE_BY_PATH.get(p)?.default ?? "");
  const { data } = await callAI<ReconcileModelResult>(
    "/api/extract-ds",
    {
      stage: "reconcile",
      images: [a.image],
      captures: [a.capture],
      reconcile: {
        rebuild: { mediaType: "image/png", data: render.data },
        structure: structureLines(value, true),
        tokens: RECONCILE_TOKEN_PATHS.map((p) => `${p} = ${ts.get(p)?.authored === undefined ? "" : typeof ts.get(p)!.authored === "string" ? ts.get(p)!.authored : JSON.stringify(ts.get(p)!.authored)}`.slice(0, 200)),
        measured: measuredLines(ev, shot, now),
        outline: outlineOf(a.spec),
        gaps: a.gaps.slice(0, 12),
      },
    },
    undefined,
    a.signal,
  );

  // The boxes the model points at now are measured too: more of the screenshot is decided.
  const more = [...elements, ...(Array.isArray(data.elements) ? data.elements.filter((e) => Math.round(Number(e?.image) || 1) === 1) : [])];
  const ev2 = measureStructure(more, [a.pixels], [cap]);
  const shot2 = shotFactsOf(ev2, more, a.pixels, cap);
  // Measured first, then the model's structure, then its token changes.
  const measured: Proposal[] = Object.entries(inferStyles(ev2))
    .filter(([p, d]) => value(p) !== d.value)
    .map(([p, d]) => ({ path: p, value: d.value, reason: `Measured: ${d.why}.` }));
  const proposals = [
    ...measured,
    ...structureProposals(data.structure as unknown as Record<string, Record<string, unknown>> | undefined, a.draft.tree, data.diagnosis),
    ...(Array.isArray(data.tokens) ? data.tokens.filter((t) => RECONCILE_TOKEN_PATHS.includes(t.path)).map((t) => ({ path: t.path, value: String(t.value ?? "").trim(), reason: String(t.reason ?? "").slice(0, 200) })) : []),
  ];
  const result = reconcile({ tree: a.draft.tree, docs: a.draft.docs, proposals, shot: shot2, build });
  const kept = result.applied.map((x) => (STYLE_BY_PATH.get(x.path) ? `${STYLE_BY_PATH.get(x.path)!.component} ${STYLE_BY_PATH.get(x.path)!.label.toLowerCase()} → ${x.to}` : `${x.path.replace(/^component\./, "")} → ${x.to}`));
  const note = result.applied.length || result.rejected.length
    ? `Compared the rebuild with the screenshot: ${kept.length ? `kept ${kept.join(", ")}` : "kept no changes"}${result.rejected.length ? `; ${result.rejected.length} proposed change${result.rejected.length > 1 ? "s" : ""} didn't bring it closer` : ""}${result.suggestions.length ? `; ${result.suggestions.length} to review` : ""}.`
    : undefined;
  return {
    state: {
      status: "done",
      diagnosis: String(data.diagnosis ?? "").slice(0, 600),
      scoreBefore: result.scoreBefore,
      scoreAfter: result.scoreAfter,
      applied: result.applied,
      rejected: result.rejected,
      suggestions: result.suggestions,
      rebuildIssues: (Array.isArray(data.rebuildIssues) ? data.rebuildIssues : []).slice(0, 8).map((i) => ({ element: String(i?.element ?? "").slice(0, 120), note: String(i?.note ?? "").slice(0, 200) })),
    },
    ...(result.applied.length ? { tree: result.tree } : {}),
    note,
  };
}

/** Structure axes, for display: "BottomNav placement". */
export const changeLabel = (path: string) => {
  const a = STYLE_AXES.find((x) => x.path === path);
  return a ? `${a.component} ${a.label.toLowerCase()}` : path.replace(/^component\./, "").replace(/\./g, " › ");
};
