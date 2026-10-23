import { ROLE_SPECS, getNode, setToken } from "./contract";
import { CATALOG, COMPONENT_NAMES } from "./components";
import { emptyGuide, type ComponentGuide, type DesignDocs } from "./docs";
import { TokenSet, normalizeHex, type Tree } from "./resolve";
import { STYLE_BY_PATH } from "./styles";

/**
 * Tuning a design system from designer feedback. Two kinds of change: token edits (roles,
 * component recipes, layout metrics — how screens look) and guidance edits (the rules and
 * dos/don'ts the generator reads — how screens are composed). Changes are checked and applied in
 * order; each one records what it replaced so the batch can be undone.
 */

export interface TokenChange {
  kind: "token";
  path: string;
  /** "{other.token}", or a literal in the token's type (see parseTokenValue). */
  value: string;
  reason: string;
}

export interface GuidanceChange {
  kind: "guidance";
  /** A list in the docs: "language.dos", "layout.rules", "Button.donts"… (see GUIDANCE_TARGETS). */
  target: string;
  op: "add" | "remove";
  text: string;
  reason: string;
}

export type SystemChange = TokenChange | GuidanceChange;

export type Undo =
  | { kind: "token"; path: string; before: Tree | null }
  | { kind: "guidance"; target: string; op: "add" | "remove"; text: string; index: number };

// ---------------------------------------------------------------------------
// What can be changed

/** Every contract path: roles, component recipes and layout metrics. */
export const TUNABLE_PATHS = ROLE_SPECS.map((r) => r.path);
const SPEC_TYPE = new Map(ROLE_SPECS.map((r) => [r.path, r.type]));

const COMPONENT_LISTS = { whenToUse: "Use when", whenNotToUse: "Avoid when", dos: "Do", donts: "Don't" } as const;
type ComponentList = keyof typeof COMPONENT_LISTS;
const DOC_LISTS: Record<string, string> = { "language.dos": "Design language · Do", "language.donts": "Design language · Don't", "layout.rules": "Layout rules" };

export const GUIDANCE_TARGETS = [...Object.keys(DOC_LISTS), ...COMPONENT_NAMES.flatMap((c) => Object.keys(COMPONENT_LISTS).map((f) => `${c}.${f}`))];

export function guidanceLabel(target: string): string {
  if (DOC_LISTS[target]) return DOC_LISTS[target];
  const i = target.lastIndexOf(".");
  return `${target.slice(0, i)} · ${COMPONENT_LISTS[target.slice(i + 1) as ComponentList] ?? target.slice(i + 1)}`;
}

/** The docs list a target names (created on a guide that doesn't exist yet), or null if it isn't one. */
function listOf(docs: DesignDocs, target: string): string[] | null {
  if (target === "language.dos") return (docs.language.dos ??= []);
  if (target === "language.donts") return (docs.language.donts ??= []);
  if (target === "layout.rules") return (docs.layout.rules ??= []);
  const i = target.lastIndexOf(".");
  const [name, field] = [target.slice(0, i), target.slice(i + 1)];
  if (!COMPONENT_NAMES.includes(name) || !(field in COMPONENT_LISTS)) return null;
  docs.components ??= [];
  let g = docs.components.find((c) => c.component === name);
  if (!g) {
    g = emptyGuide(name, CATALOG.find((c) => c.name === name)?.description);
    docs.components.push(g);
  }
  return (g[field as ComponentList] ??= []) as ComponentGuide[ComponentList];
}

/** Every non-empty guidance list, for the prompt (so removals can quote items exactly). */
export function guidanceLists(docs: DesignDocs): { target: string; items: string[] }[] {
  const out: { target: string; items: string[] }[] = [];
  const d = structuredClone(docs);
  for (const target of Object.keys(DOC_LISTS)) {
    const items = listOf(d, target) ?? [];
    if (items.length) out.push({ target, items });
  }
  for (const g of docs.components ?? [])
    for (const f of Object.keys(COMPONENT_LISTS) as ComponentList[]) if (g[f]?.length && COMPONENT_NAMES.includes(g.component)) out.push({ target: `${g.component}.${f}`, items: g[f] });
  return out;
}

// ---------------------------------------------------------------------------
// Token values

const ALIAS = /^\{([\w.-]+)\}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pxText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return `${v}px`;
  const m = typeof v === "string" ? v.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:px)?$/) : null;
  return m ? `${parseFloat(m[1])}px` : null;
}

const colorText = (v: unknown): string | null => (typeof v !== "string" ? null : ALIAS.test(v.trim()) ? v.trim() : normalizeHex(v));

function json(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

type Parsed = { value: unknown } | { error: string };

function typographyValue(ts: TokenSet, path: string, v: string): Parsed {
  const patch = json(v);
  if (!isObj(patch)) return { error: 'Typography needs a JSON object like {"fontSize":"16px"}' };
  const cur = ts.get(path)!;
  const base = { ...((isObj(cur.authored) ? cur.authored : isObj(cur.value) ? cur.value : {}) as Record<string, unknown>) };
  let n = 0;
  for (const k of ["fontSize", "lineHeight", "letterSpacing"] as const)
    if (k in patch) {
      const p = pxText(patch[k]);
      if (!p) return { error: `${k} "${patch[k]}" isn't a size in px` };
      base[k] = p;
      n++;
    }
  if ("fontWeight" in patch) {
    const w = Number(patch.fontWeight);
    if (!Number.isFinite(w) || w < 100 || w > 900) return { error: `fontWeight ${patch.fontWeight} isn't 100–900` };
    base.fontWeight = Math.round(w / 100) * 100;
    n++;
  }
  if (typeof patch.fontFamily === "string" && patch.fontFamily.trim()) {
    base.fontFamily = patch.fontFamily.trim();
    n++;
  }
  return n ? { value: base } : { error: "No typography fields to change" };
}

function shadowValue(v: string): Parsed {
  if (/^(none|\[\s*\])$/i.test(v)) return { value: [] };
  const raw = json(v);
  const layers = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : null;
  if (!layers) return { error: "A shadow needs JSON layers, or [] for none" };
  const out: Record<string, unknown>[] = [];
  for (const l of layers) {
    const color = isObj(l) ? colorText(l.color) : null;
    if (!isObj(l) || !color) return { error: "Every shadow layer needs a colour" };
    const layer: Record<string, unknown> = { color };
    for (const k of ["offsetX", "offsetY", "blur", "spread"] as const) layer[k] = pxText(l[k] ?? 0) ?? "0px";
    if (l.inset === true) layer.inset = true;
    out.push(layer);
  }
  return { value: out.length === 1 ? out[0] : out };
}

function gradientValue(v: string): Parsed {
  const g = json(v);
  if (!isObj(g) || (g.kind !== "linear" && g.kind !== "radial") || !Array.isArray(g.stops) || g.stops.length < 2) return { error: 'A gradient needs {"kind":"linear","angle":…,"stops":[…]}' };
  const stops = g.stops.map((s) => (isObj(s) ? { color: colorText(s.color), position: Math.min(1, Math.max(0, Number(s.position) || 0)) } : null));
  if (stops.some((s) => !s?.color)) return { error: "Every gradient stop needs a colour" };
  return { value: { kind: g.kind, ...(g.kind === "linear" ? { angle: Number(g.angle) || 0 } : {}), stops } };
}

const typeOk = (path: string, want: string, got: string) => got === want || (want === "color" && got === "gradient" && path.startsWith("component."));

/** The $value to store for `value` on this token, or why it can't be. */
export function parseTokenValue(ts: TokenSet, path: string, value: string): Parsed {
  const cur = ts.get(path);
  if (!cur || !SPEC_TYPE.has(path)) return { error: "Not a token of this system" };
  const type = SPEC_TYPE.get(path)!;
  const v = value.trim();
  // Structure options (styles.ts): one of the listed values, never a reference.
  const axis = STYLE_BY_PATH.get(path);
  if (axis) return axis.values.includes(v) ? { value: v } : { error: `${path} is one of ${axis.values.join(", ")}` };
  const alias = v.match(ALIAS);
  if (alias) {
    const target = ts.get(alias[1]);
    if (!target) return { error: `There is no ${alias[1]} token` };
    if (alias[1] === path) return { error: "A token can't point at itself" };
    if (!typeOk(path, type, target.type)) return { error: `${alias[1]} is a ${target.type}, not a ${type}` };
    return { value: v };
  }
  switch (type) {
    case "color": {
      const hex = normalizeHex(v);
      return hex ? { value: hex } : { error: `"${v}" isn't a colour` };
    }
    case "dimension": {
      const p = pxText(v);
      return p ? { value: p } : { error: `"${v}" isn't a size in px` };
    }
    case "fontFamily": {
      const f = v.replace(/^["']|["']$/g, "").trim();
      return f ? { value: f } : { error: "The font family is empty" };
    }
    case "typography":
      return typographyValue(ts, path, v);
    case "shadow":
      return shadowValue(v);
    case "gradient":
      return gradientValue(v);
    default:
      return { error: `${type} tokens can't be tuned` };
  }
}

/** A token's value as authored, for display: "{radius.lg}", "16px", or compact JSON. */
export function tokenText(ts: TokenSet, path: string): string {
  const a = ts.get(path)?.authored;
  return a === undefined ? "" : typeof a === "string" || typeof a === "number" ? String(a) : JSON.stringify(a);
}

// ---------------------------------------------------------------------------
// Applying

const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

function applyToken(tree: Tree, ts: TokenSet, c: TokenChange): { undo: Undo } | { error: string } {
  const parsed = parseTokenValue(ts, c.path, c.value);
  if ("error" in parsed) return parsed;
  const node = getNode(tree, c.path);
  const before = node ? structuredClone(node) : null;
  const next: Tree = { ...(node ?? {}), $value: parsed.value };
  // Recipes are untyped aliases; a literal needs its type spelled out.
  if (typeof parsed.value === "string" && ALIAS.test(parsed.value)) {
    if (!before || !("$type" in before)) delete next.$type;
  } else if (!("$type" in next)) next.$type = SPEC_TYPE.get(c.path);
  setToken(tree, c.path, next);
  const after = new TokenSet(tree);
  const t = after.get(c.path);
  const broken = !t || !typeOk(c.path, SPEC_TYPE.get(c.path)!, t.type) || after.unresolved().some((p) => !ts.unresolved().includes(p));
  if (broken) {
    if (before) setToken(tree, c.path, before);
    return { error: "That value doesn't resolve for this token" };
  }
  return { undo: { kind: "token", path: c.path, before } };
}

function applyGuidance(docs: DesignDocs, c: GuidanceChange): { undo: Undo } | { error: string } {
  const list = listOf(docs, c.target);
  if (!list) return { error: "Not a guidance list of this system" };
  const text = c.text.trim();
  if (!text) return { error: "The rule is empty" };
  if (c.op === "add") {
    if (list.some((x) => same(x, text))) return { error: "Already in the guidance" };
    // Newest first: prompts keep the first items of long lists.
    list.unshift(text);
    return { undo: { kind: "guidance", target: c.target, op: "add", text, index: 0 } };
  }
  const i = list.findIndex((x) => same(x, text));
  if (i < 0) return { error: "Not in the guidance" };
  const [removed] = list.splice(i, 1);
  return { undo: { kind: "guidance", target: c.target, op: "remove", text: removed, index: i } };
}

export interface ApplyResult {
  tree: Tree;
  docs: DesignDocs;
  /** One entry per applied change, in order. */
  undo: Undo[];
  /** Per input change: why it was skipped, or null. */
  problems: (string | null)[];
}

/** Apply changes in order to copies of a system's tree and docs; changes that don't check out are skipped. */
export function applyChanges(tree: Tree, docs: DesignDocs, changes: SystemChange[]): ApplyResult {
  const out = { tree: structuredClone(tree), docs: structuredClone(docs), undo: [] as Undo[], problems: [] as (string | null)[] };
  let ts = new TokenSet(out.tree);
  for (const c of changes) {
    const r = c.kind === "token" ? applyToken(out.tree, ts, c) : applyGuidance(out.docs, c);
    if ("error" in r) {
      out.problems.push(r.error);
      continue;
    }
    out.problems.push(null);
    out.undo.push(r.undo);
    if (c.kind === "token") ts = new TokenSet(out.tree);
  }
  return out;
}

/** Put back what `undo` records, newest first. */
export function revertChanges(tree: Tree, docs: DesignDocs, undo: Undo[]): { tree: Tree; docs: DesignDocs } {
  const out = { tree: structuredClone(tree), docs: structuredClone(docs) };
  for (const u of [...undo].reverse()) {
    if (u.kind === "token") {
      if (u.before) setToken(out.tree, u.path, u.before);
      continue;
    }
    const list = listOf(out.docs, u.target);
    if (!list) continue;
    if (u.op === "add") {
      const i = same(list[u.index] ?? "", u.text) ? u.index : list.findIndex((x) => same(x, u.text));
      if (i >= 0) list.splice(i, 1);
    } else list.splice(Math.min(u.index, list.length), 0, u.text);
  }
  return out;
}
