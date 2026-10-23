import type { Doc, FrameNode, SceneNode } from "@/doc/schema";
import { studio } from "@/doc/store";
import { descendants, isDescendant } from "@/doc/geometry";
import { fitText } from "@/doc/ops";
import { mirrorForRTL, mirrorSubtree } from "@/doc/rtl";
import { release, reserve } from "@/doc/reservations";
import { lintNodes } from "@/lint/rules";
import { callAI } from "@/ai/client";
import type { TranslateResult } from "@/ai/schemas";
import type { ScreenSpec } from "@/design-system/builders";
import { isEdited } from "@/design-system/apply";
import { rebuildScreen } from "@/design-system/refresh";
import { dsIdForNode, tokenSetFor } from "@/design-system/registry";
import { LANG_NAME, langForDir, needsTranslation, specCopy, translateSpec, translationUnits, type CopyPlace, type Lang, type TranslationUnit } from "@/design-system/translate";
import type { ChatTurn } from "./chatTypes";

/*
 * The Direction tool (AI panel): switch a screen between left-to-right and right-to-left, in
 * place or as a mirrored copy, and its copy with it. Screens built from a spec and not edited
 * since are rebuilt in the new direction (the builders handle Arabic type, amounts and icons);
 * anything else is mirrored, and auto layout re-flows rows and padding. Then the copy is scanned:
 * strings written in the other language are translated by Qalam AI (English ↔ Arabic). The
 * linter reports what still needs a look.
 */

export type DirectionMode = "switch" | "mirror";
export type Dir = "ltr" | "rtl";

/** What happened to the copy after the switch. */
export interface CopyOutcome {
  to: Lang;
  /** Distinct strings found in the other language. */
  found: number;
  translated: number;
  /** Strings left as written on purpose (names, brands, codes). */
  kept: string[];
  /** The model's line on terms it chose or kept. */
  note?: string;
  /** Nothing was translated: the designer kept the copy, or AI isn't set up here. */
  skipped?: "kept" | "no-ai";
}

export interface DirectionOutcome {
  kind: "direction";
  mode: DirectionMode;
  toDir: Dir;
  /** Frames switched in place, or the mirrored copies. */
  frames: { id: string; name: string }[];
  /** RTL checks the linter raised on the result. */
  rtlIssues: number;
  /** Set once the copy has been scanned (and translated). */
  copy?: CopyOutcome;
}

export const DIR_LABEL: Record<Dir, string> = { ltr: "left to right", rtl: "right to left" };

/** Frames the tool acts on: selected frames, or the frame around a selected layer (outermost only). */
export function directionTargets(doc: Doc, selection: string[]): FrameNode[] {
  const ids = new Set<string>();
  for (const id of selection) {
    let n: SceneNode | undefined = doc.nodes[id];
    while (n && n.type !== "frame") n = n.parentId ? doc.nodes[n.parentId] : undefined;
    if (n) ids.add(n.id);
  }
  const list = [...ids];
  return list.filter((id) => !list.some((o) => o !== id && isDescendant(doc, id, o))).map((id) => doc.nodes[id] as FrameNode);
}

/** Where the targets go: the opposite of the first one's direction. */
export const nextDir = (targets: FrameNode[]): Dir => (targets[0]?.dir === "rtl" ? "ltr" : "rtl");

/** A screen built from a spec and not changed by hand since: it's rebuilt rather than mirrored. */
const rebuildable = (doc: Doc, id: string): ScreenSpec | null => {
  const n = doc.nodes[id];
  return n && !n.parentId && n.meta.spec && !isEdited(doc, id) ? n.meta.spec : null;
};

/** Switch or mirror the targets (one undo step) and lint the result. */
export function applyDirection(mode: DirectionMode, targets: FrameNode[], toDir: Dir = nextDir(targets)): DirectionOutcome {
  const s = studio();
  let ids: string[];
  if (mode === "switch") {
    ids = targets.filter((f) => f.dir !== toDir).map((f) => f.id);
    const specs = new Map(ids.map((id) => [id, rebuildable(s.doc, id)]));
    s.mutate((d) => {
      for (const id of ids) {
        const spec = specs.get(id);
        if (spec) rebuildScreen(d, id, { ...spec, dir: toDir });
        else {
          mirrorSubtree(d, id, toDir);
          // Keep the spec in step, so instances rebuilt later come out in the new direction.
          const n = d.nodes[id];
          if (!n.parentId && n.meta.spec) n.meta.spec.dir = toDir;
        }
      }
    });
  } else {
    ids = [];
    s.beginTx();
    for (const f of targets) {
      const spec = rebuildable(studio().doc, f.id);
      const dir: Dir = f.dir === "rtl" ? "ltr" : "rtl";
      mirrorForRTL(f.id);
      const copy = studio().selection[0];
      ids.push(copy);
      studio().mutate((d) => {
        const n = d.nodes[copy];
        if (spec) rebuildScreen(d, copy, { ...spec, dir });
        else if (!n.parentId && n.meta.spec) n.meta.spec.dir = dir;
      });
    }
    s.commitTx();
    s.select(ids);
  }
  const rtlIssues = lintNodes(ids).filter((f) => f.category === "rtl").length;
  const doc = studio().doc;
  return { kind: "direction", mode, toDir, frames: ids.map((id) => ({ id, name: doc.nodes[id]?.name ?? "Frame" })), rtlIssues };
}

// ---------------------------------------------------------------------------
// The copy

/** The nearest component a layer belongs to, for the model's context ("Button/Primary"). */
function componentOf(doc: Doc, id: string): string | undefined {
  for (let n: SceneNode | undefined = doc.nodes[id]; n; n = n.parentId ? doc.nodes[n.parentId] : undefined) if (n.meta.component) return n.meta.component;
}

/**
 * The strings in these frames written in the other language than `to`: from the spec of screens
 * that will be rebuilt, else from their text layers (and the spec, kept in step).
 */
export function scanCopy(doc: Doc, frameIds: string[], to: Lang): TranslationUnit[] {
  const found: (CopyPlace & { text: string })[] = [];
  for (const id of frameIds) {
    const f = doc.nodes[id];
    if (!f) continue;
    const spec = !f.parentId ? f.meta.spec : undefined;
    if (spec) found.push(...specCopy(spec).map((c) => ({ ...c, where: `${c.where} · ${f.name}` })));
    if (spec && rebuildable(doc, id)) continue;
    for (const c of descendants(doc, id)) {
      const n = doc.nodes[c];
      if (n?.type === "text") found.push({ text: n.text.content, where: `${componentOf(doc, c) ?? n.name} · ${f.name}` });
    }
  }
  return translationUnits(found, to);
}

const ARABIC_TEXT = (s: string) => needsTranslation(s, "en");

/** Put translated copy in (one undo step): rebuild untouched screens, else swap text layers' content and type. */
export function applyCopy(frameIds: string[], map: Map<string, string>, toDir: Dir) {
  const lang = langForDir(toDir);
  const doc = studio().doc;
  const specs = new Map(frameIds.map((id) => [id, rebuildable(doc, id)]));
  studio().mutate((d) => {
    for (const id of frameIds) {
      const f = d.nodes[id];
      if (!f) continue;
      const spec = specs.get(id);
      if (spec) {
        rebuildScreen(d, id, translateSpec(spec, map, toDir, lang));
        continue;
      }
      const orig = doc.nodes[id]?.meta.spec;
      if (!f.parentId && orig) f.meta.spec = translateSpec(orig, map, toDir, lang);
      const ts = tokenSetFor(dsIdForNode(doc, id));
      const arabic = String(ts.get("font.family.arabic")?.value ?? "IBM Plex Sans Arabic");
      const latin = String(ts.get("font.family.latin")?.value ?? "Inter");
      for (const c of descendants(d, id)) {
        const n = d.nodes[c];
        if (n?.type !== "text") continue;
        const next = map.get(n.text.content);
        if (!next) continue;
        const style = n.text.typeToken ? ts.typography(n.text.typeToken) : undefined;
        if (n.name === n.text.content.slice(0, 32)) n.name = next.slice(0, 32);
        n.text.content = next;
        if (ARABIC_TEXT(next)) {
          n.text.fontFamily = arabic;
          n.text.letterSpacing = 0;
          n.text.lineHeight = Math.max(n.text.lineHeight, Math.round(n.text.fontSize * 1.55));
        } else if (n.text.fontFamily === arabic) {
          n.text.fontFamily = style?.fontFamily ?? latin;
          n.text.letterSpacing = style?.letterSpacing ?? 0;
          n.text.lineHeight = style?.lineHeight ?? n.text.lineHeight;
        }
        fitText(n);
      }
    }
  });
}

interface RunIO {
  patch: (p: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => void;
}

/**
 * The Direction turn: switch the frames (right away, locally), then scan their copy and translate
 * what's in the other language. If the translation fails the switch stands, and Retry only
 * translates (the outcome already lists the frames).
 */
export async function runDirection(t: ChatTurn, ai: boolean, progress: (tokens: number) => void, signal: AbortSignal, io: RunIO) {
  const req = t.request.direction;
  if (!req) return;
  let o = t.outcome?.kind === "direction" ? t.outcome : undefined;
  if (!o) {
    const { doc } = studio();
    const targets = (t.request.screens ?? []).map((s) => doc.nodes[s.id]).filter((n): n is FrameNode => n?.type === "frame");
    o = applyDirection(req.mode, targets, req.to);
    io.patch({ outcome: o });
  }
  const outcome = o;
  const ids = outcome.frames.map((f) => f.id).filter((id) => studio().doc.nodes[id]);
  const to = langForDir(outcome.toDir);
  const units = scanCopy(studio().doc, ids, to);
  const done = (copy: CopyOutcome) => {
    const rtlIssues = lintNodes(ids).filter((f) => f.category === "rtl").length;
    io.patch({ outcome: { ...outcome, rtlIssues, copy }, activity: undefined });
  };
  if (!units.length) return done({ to, found: 0, translated: 0, kept: [] });
  if (!req.translate) return done({ to, found: units.length, translated: 0, kept: [], skipped: "kept" });
  if (!ai) return done({ to, found: units.length, translated: 0, kept: [], skipped: "no-ai" });

  io.patch({ activity: `Translating ${units.length} text${units.length > 1 ? "s" : ""} to ${LANG_NAME[to]}…` });
  const hold = reserve("Translating", [], ids, t.id);
  try {
    const { doc } = studio();
    const context = { to, screens: ids.map((id) => doc.nodes[id]?.name ?? "Frame").slice(0, 8), product: doc.brief?.summary?.slice(0, 2000) || undefined };
    const first = await callAI<TranslateResult>("/api/translate", { ...context, units }, progress, signal);
    const byId = new Map(first.data.translations.map((x) => [x.id, x.text.trim()]));
    // Length budgets are measured here, not taken on trust: what's too long goes back once to be shortened.
    const over = units.filter((u) => u.maxChars && (byId.get(u.id)?.length ?? 0) > u.maxChars).map((u) => ({ ...u, previous: byId.get(u.id) }));
    let note = first.data.note;
    if (over.length) {
      io.patch({ activity: `Shortening ${over.length} translation${over.length > 1 ? "s" : ""} to fit…` });
      const again = await callAI<TranslateResult>("/api/translate", { ...context, units: over }, progress, signal);
      for (const x of again.data.translations) {
        const u = over.find((o) => o.id === x.id);
        const text = x.text.trim();
        if (u && text && text.length < (byId.get(u.id)?.length ?? Infinity)) byId.set(u.id, text);
      }
      // The first note was about the strings that didn't fit.
      note = again.data.note;
    }
    const model = first.model;
    const map = new Map<string, string>();
    const kept: string[] = [];
    for (const u of units) {
      const next = byId.get(u.id);
      if (next && next !== u.text) map.set(u.text, next);
      else kept.push(u.text);
    }
    if (map.size) applyCopy(ids, map, outcome.toDir);
    io.patch({ model });
    done({ to, found: units.length, translated: map.size, kept, ...(note ? { note } : {}) });
  } finally {
    release(hold);
  }
}
