import { ROLE_PATHS, ROLE_SPECS, getNode, setToken } from "./contract";
import { TokenSet, normalizeHex, type Token, type Tree } from "./resolve";
import { STYLE_BY_PATH } from "./styles";

/**
 * Editing a design system's DTCG tree by hand (the token editor): values, descriptions, new
 * tokens, renames and deletes. Every function works on a copy and checks that the tree still
 * resolves, so the builders never meet a broken system. Contract paths (see contract.ts) can be
 * re-valued but not renamed or deleted, because the builders, linter and prompts rely on them.
 */

export type Tier = "primitive" | "semantic" | "component";

export const TIERS: { tier: Tier; label: string; hint: string }[] = [
  { tier: "primitive", label: "Primitives", hint: "Raw scales: colour ramps, spacing, radii, font families. Nothing binds to these directly." },
  { tier: "semantic", label: "Semantic", hint: "Roles screens bind to (bg, text, border, type, shadow…), usually pointing at primitives." },
  { tier: "component", label: "Component", hint: "Recipes for one component (button fill, input height…), pointing at semantic tokens." },
];

/** Top-level groups that hold raw scales rather than roles. */
const PRIMITIVE_GROUPS = new Set(["color", "space", "radius", "size", "border-width", "font"]);
/** Where a new top-level group records its tier. */
const TIER_EXT = "qalam.tier";

const isObj = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);
const ALIAS = /^\{([^}]+)\}$/;

function extTier(node: Tree | undefined): Tier | undefined {
  const ext = node && isObj(node.$extensions) ? node.$extensions[TIER_EXT] : undefined;
  return ext === "primitive" || ext === "semantic" || ext === "component" ? ext : undefined;
}

export function tierOf(tree: Tree, path: string): Tier {
  const top = path.split(".")[0];
  if (top === "component") return "component";
  return extTier(getNode(tree, top)) ?? (PRIMITIVE_GROUPS.has(top) ? "primitive" : "semantic");
}

/** Contract paths can change value but keep their name: the builders look them up. */
export const isLocked = (path: string) => ROLE_PATHS.has(path);

// ---------------------------------------------------------------------------
// Groups (the sidebar tree)

export interface Group {
  /** Full group path, e.g. "color.ink" or "component.button.primary". */
  path: string;
  name: string;
  /** Tokens in this group and below. */
  count: number;
  children: Group[];
}

/** Group tree of one tier. Component recipes skip the shared "component" level. */
export function groupsOf(tree: Tree, ts: TokenSet, tier: Tier): Group[] {
  const root: Group = { path: "", name: "", count: 0, children: [] };
  for (const t of ts.tokens) {
    if (tierOf(tree, t.path) !== tier) continue;
    const segs = t.path.split(".").slice(0, -1);
    let g = root;
    g.count++;
    for (let i = 0; i < segs.length; i++) {
      const path = segs.slice(0, i + 1).join(".");
      let child = g.children.find((c) => c.path === path);
      if (!child) g.children.push((child = { path, name: segs[i], count: 0, children: [] }));
      child.count++;
      g = child;
    }
  }
  if (tier === "component") return root.children.find((c) => c.path === "component")?.children ?? [];
  return root.children;
}

export function tokensIn(tree: Tree, ts: TokenSet, scope: { tier?: Tier; group?: string }): Token[] {
  return ts.tokens.filter((t) => (!scope.tier || tierOf(tree, t.path) === scope.tier) && (!scope.group || t.path.startsWith(`${scope.group}.`)));
}

// ---------------------------------------------------------------------------
// Values

export type Result = { tree: Tree } | { error: string };

function pxText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return `${round(v)}px`;
  const m = typeof v === "string" ? v.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:px)?$/) : null;
  return m ? `${round(parseFloat(m[1]))}px` : null;
}
const round = (n: number) => Math.round(n * 100) / 100;

/** A colour literal or an alias. */
function colorOrAlias(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return ALIAS.test(v.trim()) ? v.trim() : normalizeHex(v);
}
const dimOrAlias = (v: unknown) => (typeof v === "string" && ALIAS.test(v.trim()) ? v.trim() : pxText(v));

/** Normalise a literal $value for a type, or explain why it isn't one. Aliases pass through. */
export function normalizeValue(type: string, value: unknown): { value: unknown } | { error: string } {
  if (typeof value === "string" && ALIAS.test(value.trim())) return { value: value.trim() };
  switch (type) {
    case "color": {
      const hex = typeof value === "string" ? normalizeHex(value) : null;
      return hex ? { value: hex } : { error: `"${String(value)}" isn't a colour` };
    }
    case "dimension": {
      const p = pxText(value);
      return p ? { value: p } : { error: `"${String(value)}" isn't a size in px` };
    }
    case "fontFamily": {
      const f = typeof value === "string" ? value.replace(/^["']|["']$/g, "").trim() : "";
      return f ? { value: f } : { error: "The font family is empty" };
    }
    case "typography": {
      if (!isObj(value)) return { error: "Typography needs font, weight, size and line height" };
      const family = typeof value.fontFamily === "string" ? value.fontFamily.trim() : "";
      const weight = Number(value.fontWeight);
      const size = dimOrAlias(value.fontSize);
      const line = dimOrAlias(value.lineHeight);
      const tracking = dimOrAlias(value.letterSpacing ?? 0);
      if (!family) return { error: "Pick a font family" };
      if (!Number.isFinite(weight) || weight < 100 || weight > 900) return { error: "Weight must be 100–900" };
      if (!size || !line || !tracking) return { error: "Size, line height and letter spacing are px values" };
      return { value: { fontFamily: family, fontWeight: Math.round(weight / 100) * 100, fontSize: size, lineHeight: line, letterSpacing: tracking } };
    }
    case "shadow": {
      const layers = Array.isArray(value) ? value : isObj(value) ? [value] : null;
      if (!layers) return { error: "A shadow is a list of layers" };
      const out: Tree[] = [];
      for (const l of layers) {
        const color = isObj(l) ? colorOrAlias(l.color) : null;
        if (!isObj(l) || !color) return { error: "Every shadow layer needs a colour" };
        const layer: Tree = { color };
        for (const k of ["offsetX", "offsetY", "blur", "spread"] as const) {
          const p = dimOrAlias(l[k] ?? 0);
          if (!p) return { error: `${k} isn't a size in px` };
          layer[k] = p;
        }
        if (l.inset === true) layer.inset = true;
        out.push(layer);
      }
      return { value: out.length === 1 ? out[0] : out };
    }
    case "gradient": {
      if (!isObj(value) || (value.kind !== "linear" && value.kind !== "radial") || !Array.isArray(value.stops) || value.stops.length < 2)
        return { error: "A gradient needs a kind and at least two stops" };
      const stops = value.stops.map((s) => (isObj(s) ? { color: colorOrAlias(s.color), position: Math.min(1, Math.max(0, Number(s.position) || 0)) } : null));
      if (stops.some((s) => !s?.color)) return { error: "Every gradient stop needs a colour" };
      return { value: { kind: value.kind, ...(value.kind === "linear" ? { angle: Number(value.angle) || 0 } : {}), stops } };
    }
    case "string":
      return typeof value === "string" && value.trim() ? { value: value.trim() } : { error: "The value is empty" };
    default:
      return { value };
  }
}

/** Contract recipes may swap a flat colour for a gradient; nothing else changes type. */
const typeOk = (path: string, want: string, got: string) => got === want || (want === "color" && got === "gradient" && path.startsWith("component."));
const SPEC_TYPE = new Map(ROLE_SPECS.map((r) => [r.path, r.type]));

/** Check a changed tree: the token keeps its type and nothing that resolved before stops resolving. */
function check(before: TokenSet, after: Tree, path: string): string | null {
  const ts = new TokenSet(after);
  const t = ts.get(path);
  const was = before.get(path);
  if (!t) return "That value doesn't resolve";
  const want = SPEC_TYPE.get(path) ?? was?.type ?? t.type;
  if (!typeOk(path, want, t.type)) return `${path} is a ${want} token; that value is a ${t.type}`;
  const broken = new Set(before.unresolved());
  const now = ts.unresolved().filter((p) => !broken.has(p));
  if (now.includes(path)) return "That reference points nowhere or loops back on itself";
  if (now.length) return `That would break ${now.slice(0, 3).join(", ")}${now.length > 3 ? "…" : ""}`;
  return null;
}

/** Set a token's value: a literal in its type, or an alias like "{color.ink.500}". */
export function setValue(tree: Tree, path: string, value: unknown): Result {
  const ts = new TokenSet(tree);
  const cur = ts.get(path);
  if (!cur) return { error: `There is no ${path} token` };
  // Structure options take one of their listed values, never a reference.
  const axis = STYLE_BY_PATH.get(path);
  if (axis && (typeof value !== "string" || !axis.values.includes(value.trim()))) return { error: `${axis.label} is one of ${axis.values.join(", ")}` };
  const alias = typeof value === "string" ? value.trim().match(ALIAS) : null;
  if (alias && alias[1] === path) return { error: "A token can't point at itself" };
  if (alias && !ts.has(alias[1])) return { error: `There is no ${alias[1]} token` };
  if (alias) {
    const want = SPEC_TYPE.get(path) ?? cur.type;
    const got = ts.get(alias[1])!.type;
    if (!typeOk(path, want, got)) return { error: `${alias[1]} is a ${got} token, not a ${want}` };
  }
  const parsed = normalizeValue(alias ? (ts.get(alias[1])?.type ?? cur.type) : cur.type, value);
  if ("error" in parsed) return parsed;
  const out = structuredClone(tree);
  const node = getNode(out, path) ?? {};
  const next: Tree = { ...node, $value: parsed.value };
  // Recipes are untyped aliases (they take their target's type); a literal needs its type spelled out.
  if (alias) {
    if (next.$type !== ts.get(alias[1])?.type) delete next.$type;
  } else if (!("$type" in next)) next.$type = cur.type;
  setToken(out, path, next);
  const err = check(ts, out, path);
  return err ? { error: err } : { tree: out };
}

export function setDescription(tree: Tree, path: string, text: string): Result {
  const out = structuredClone(tree);
  const node = getNode(out, path);
  if (!node || !("$value" in node)) return { error: `There is no ${path} token` };
  const t = text.trim();
  if (t) node.$description = t;
  else delete node.$description;
  return { tree: out };
}

// ---------------------------------------------------------------------------
// Names

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Why a path can't be used for a new or renamed token, or null when it can. */
export function pathProblem(tree: Tree, path: string, except?: string): string | null {
  const segs = path.split(".");
  if (!path || segs.some((s) => !SEGMENT.test(s))) return "Use letters, digits, - and _, with dots between groups";
  if (path === except) return null;
  const ts = new TokenSet(tree);
  if (ts.has(path)) return `${path} already exists`;
  for (let i = 1; i < segs.length; i++) if (ts.has(segs.slice(0, i).join("."))) return `${segs.slice(0, i).join(".")} is a token, not a group`;
  if (ts.tokens.some((t) => t.path.startsWith(`${path}.`))) return `${path} is a group`;
  return null;
}

/** `base`, or `base-2`, `base-3`… whichever is free. */
export function freePath(tree: Tree, base: string): string {
  if (!pathProblem(tree, base)) return base;
  for (let i = 2; ; i++) if (!pathProblem(tree, `${base}-${i}`)) return `${base}-${i}`;
}

/** Drop groups left with no tokens, walking up from `path`'s parent. */
function prune(tree: Tree, path: string) {
  const segs = path.split(".");
  for (let i = segs.length - 1; i > 0; i--) {
    const gp = segs.slice(0, i).join(".");
    const g = getNode(tree, gp);
    if (!g || Object.keys(g).some((k) => !k.startsWith("$"))) return;
    const parent = i > 1 ? getNode(tree, segs.slice(0, i - 1).join(".")) : tree;
    if (parent) delete parent[segs[i - 1]];
  }
}

function removeNode(tree: Tree, path: string) {
  const segs = path.split(".");
  const parent = segs.length > 1 ? getNode(tree, segs.slice(0, -1).join(".")) : tree;
  if (parent) delete parent[segs[segs.length - 1]];
  prune(tree, path);
}

/** Replace every `{from}` reference in the tree (including inside type styles, shadows, gradients). */
function rewriteAliases(tree: Tree, from: string, to: string) {
  const ref = `{${from}}`;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v === ref ? `{${to}}` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      for (const k of Object.keys(v)) v[k] = walk(v[k]);
      return v;
    }
    return v;
  };
  walk(tree);
}

/** Tokens whose value refers to `path`, directly (as authored). */
export function referencesTo(ts: TokenSet, path: string): string[] {
  const ref = `{${path}}`;
  const has = (v: unknown): boolean => (typeof v === "string" ? v === ref : Array.isArray(v) ? v.some(has) : isObj(v) ? Object.values(v).some(has) : false);
  return ts.tokens.filter((t) => t.path !== path && has(t.authored)).map((t) => t.path);
}

export function renameToken(tree: Tree, from: string, to: string): Result {
  to = to.trim();
  if (from === to) return { tree };
  if (isLocked(from)) return { error: `${from} is part of the role contract; screens are built with it, so it keeps its name` };
  const problem = pathProblem(tree, to);
  if (problem) return { error: problem };
  const out = structuredClone(tree);
  const node = getNode(out, from);
  if (!node || !("$value" in node)) return { error: `There is no ${from} token` };
  // Keep the type when the token leaves the group that declared it.
  const type = new TokenSet(tree).get(from)?.type;
  const moved: Tree = { ...node };
  if (!("$type" in moved) && type && type !== "unknown" && !(typeof moved.$value === "string" && ALIAS.test(moved.$value))) moved.$type = type;
  removeNode(out, from);
  const before = new TokenSet(tree);
  setToken(out, to, moved);
  markTier(out, before, to, tierOf(tree, from));
  rewriteAliases(out, from, to);
  const err = check(before, out, to);
  return err ? { error: err } : { tree: out };
}

/** A token that starts a new top-level group gives that group the tier it was made in. */
function markTier(out: Tree, before: TokenSet, path: string, tier: Tier) {
  const top = path.split(".")[0];
  const node = getNode(out, top);
  if (!node || tier === "component" || before.tokens.some((t) => t.path === top || t.path.startsWith(`${top}.`)) || tierOf(out, path) === tier) return;
  node.$extensions = { ...(isObj(node.$extensions) ? node.$extensions : {}), [TIER_EXT]: tier };
}

export function deleteToken(tree: Tree, path: string): Result {
  if (isLocked(path)) return { error: `${path} is part of the role contract and can't be deleted` };
  const ts = new TokenSet(tree);
  if (!ts.has(path)) return { error: `There is no ${path} token` };
  const refs = referencesTo(ts, path);
  if (refs.length) return { error: `Used by ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? ` and ${refs.length - 3} more` : ""}` };
  const out = structuredClone(tree);
  removeNode(out, path);
  return { tree: out };
}

// ---------------------------------------------------------------------------
// New tokens

export type NewType = "color" | "dimension" | "fontFamily" | "typography" | "shadow" | "gradient";

export const NEW_TYPES: { type: NewType; label: string }[] = [
  { type: "color", label: "Colour" },
  { type: "dimension", label: "Number (px)" },
  { type: "fontFamily", label: "Font family" },
  { type: "typography", label: "Type style" },
  { type: "shadow", label: "Shadow" },
  { type: "gradient", label: "Gradient" },
];

/** Where a new token goes when no group is picked. */
const DEFAULT_GROUP: Record<Tier, Record<NewType, string>> = {
  primitive: { color: "color", dimension: "space", fontFamily: "font.family", typography: "type", shadow: "shadow", gradient: "gradient" },
  semantic: { color: "bg", dimension: "size", fontFamily: "font.family", typography: "type", shadow: "shadow", gradient: "gradient" },
  component: { color: "component.custom", dimension: "component.custom", fontFamily: "component.custom", typography: "component.custom", shadow: "component.custom", gradient: "component.custom" },
};

function defaultValue(ts: TokenSet, type: NewType): unknown {
  switch (type) {
    case "color":
      return "#000000";
    case "dimension":
      return "8px";
    case "fontFamily":
      return "Inter";
    case "typography":
      return { fontFamily: ts.has("font.family.latin") ? "{font.family.latin}" : "Inter", fontWeight: 400, fontSize: "16px", lineHeight: "24px", letterSpacing: "0px" };
    case "shadow":
      return { color: "#0E13421A", offsetX: "0px", offsetY: "2px", blur: "8px", spread: "0px" };
    case "gradient":
      return {
        kind: "linear",
        angle: 180,
        stops: [
          { color: "#FFFFFF", position: 0 },
          { color: "#000000", position: 1 },
        ],
      };
  }
}

/**
 * Add a token of `type` to `group` (or the tier's usual group), named after its type. It starts
 * as a copy of the last sibling of the same type, so a new ramp step or role looks like its
 * neighbours. Returns the new path.
 */
export function createToken(tree: Tree, opts: { type: NewType; tier: Tier; group?: string }): { tree: Tree; path: string } {
  const ts = new TokenSet(tree);
  const group = opts.group || DEFAULT_GROUP[opts.tier][opts.type];
  const sibling = [...ts.tokens].reverse().find((t) => t.type === opts.type && t.path.startsWith(`${group}.`) && t.path.split(".").length === group.split(".").length + 1);
  const base = `${group}.${opts.type === "dimension" ? "new-size" : opts.type === "fontFamily" ? "new-family" : `new-${opts.type}`}`;
  const path = freePath(tree, base);
  const out = structuredClone(tree);
  setToken(out, path, { $type: opts.type, $value: structuredClone(sibling ? sibling.authored : defaultValue(ts, opts.type)) });
  markTier(out, ts, path, opts.tier);
  return { tree: out, path };
}

export function duplicateToken(tree: Tree, path: string): { tree: Tree; path: string } | { error: string } {
  const node = getNode(tree, path);
  if (!node || !("$value" in node)) return { error: `There is no ${path} token` };
  const copy = freePath(tree, `${path}-copy`);
  const out = structuredClone(tree);
  const type = new TokenSet(tree).get(path)?.type;
  setToken(out, copy, { ...structuredClone(node), ...(type && type !== "unknown" && !("$type" in node) && !(typeof node.$value === "string" && ALIAS.test(node.$value)) ? { $type: type } : {}) });
  return { tree: out, path: copy };
}

const RANK: Record<Tier, number> = { primitive: 0, semantic: 1, component: 2 };

/**
 * Tokens a value of `type` can point at from `path`: same type, not itself, not something that
 * points back. With the tree, references only run down the tiers (component → semantic →
 * primitive), never from a role up into a component recipe.
 */
export function aliasTargets(ts: TokenSet, path: string, type: string, tree?: Tree): Token[] {
  const pointsBack = (t: Token) => {
    let hop: Token | undefined = t;
    for (let i = 0; i < 12 && hop; i++) {
      if (hop.path === path) return true;
      hop = hop.aliasOf ? ts.get(hop.aliasOf) : undefined;
    }
    return false;
  };
  const ok = (t: Token) => typeOk(path, SPEC_TYPE.get(path) ?? type, t.type);
  const rank = tree ? RANK[tierOf(tree, path)] : 2;
  const below = (t: Token) => !tree || RANK[tierOf(tree, t.path)] <= rank;
  return ts.tokens.filter((t) => t.path !== path && ok(t) && below(t) && !pointsBack(t));
}
