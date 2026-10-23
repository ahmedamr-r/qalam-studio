import { BUILTIN, TokenSet, isRolePath, type Tree } from "./resolve";
import { neutralOf } from "./neutral";

/**
 * The role contract: every token path the builders, linter and prompts rely on. Each design system
 * provides a value for every path, so any screen can be built with any system. The built-in token
 * file is the reference implementation; its primitive ramps (`color.*`) are not part of the contract.
 */

export interface RoleSpec {
  path: string;
  type: string;
  group: string;
  description: string;
}

const DESCRIPTIONS: Record<string, string> = {
  "bg.canvas": "Default screen background",
  "bg.surface": "Tiles, secondary buttons, grouped areas on the canvas",
  "bg.surface-raised": "Cards that sit above the surface",
  "bg.brand": "Bright brand accent fill (highlights, secondary brand buttons, progress)",
  "bg.brand-strong": "Primary action fill and brand headers",
  "bg.brand-subtle": "Tinted brand background for icon circles, avatars, selected rows",
  "bg.inverse": "Dark surfaces (ETA chips, inverse cards)",
  "bg.go": "Accent 1 for promotional banners",
  "bg.get": "Accent 2 for promotional banners",
  "bg.eat": "Accent 3 for promotional banners",
  "bg.pay": "Accent 4 for promotional banners",
  "bg.sky": "Soft decorative background",
  "text.primary": "Main text on canvas and surfaces",
  "text.secondary": "Supporting text, placeholders",
  "text.tertiary": "Disabled or least-important text",
  "text.on-brand": "Text on bg.brand",
  "text.on-brand-strong": "Text on bg.brand-strong (primary button label)",
  "text.inverse": "Text on dark or saturated fills",
  "text.link": "Links and tertiary actions",
  "text.success": "Positive status text",
  "text.error": "Error text",
  "text.warning": "Warning text",
  "text.info": "Informational text",
  "border.subtle": "Dividers, card outlines",
  "border.default": "Input and chip outlines",
  "border.strong": "High-emphasis outlines",
  "border.focus": "Focus ring colour",
  "border.error": "Error outline",
  "feedback.success": "Success fill",
  "feedback.success-subtle": "Success background",
  "feedback.error": "Error / destructive fill",
  "feedback.error-subtle": "Error background",
  "feedback.warning": "Warning fill",
  "feedback.warning-subtle": "Warning background",
  "feedback.info": "Info fill",
  "feedback.info-subtle": "Info background",
  "icon.primary": "Default icon colour",
  "icon.secondary": "Muted icons",
  "icon.brand": "Brand-coloured icons on light backgrounds",
  "icon.on-brand-strong": "Icons on bg.brand-strong",
  "icon.inverse": "Icons on dark fills",
  "size.touch-min": "Minimum touch target",
};

function describe(path: string, own?: string): string {
  if (own) return own;
  if (DESCRIPTIONS[path]) return DESCRIPTIONS[path];
  if (path.startsWith("component.")) return path.slice("component.".length).replace(/\./g, " › ");
  return path;
}

export const ROLE_SPECS: RoleSpec[] = BUILTIN.tokens
  .filter((t) => !t.path.startsWith("color."))
  .map((t) => ({ path: t.path, type: t.type, group: t.path.split(".")[0], description: describe(t.path, t.description) }));

export const ROLE_PATHS = new Set(ROLE_SPECS.map((r) => r.path));

/** Component fills may point at a gradient where the built-in recipe uses a flat colour. */
const typeOk = (r: RoleSpec, type: string) => type === r.type || (r.type === "color" && type === "gradient" && r.path.startsWith("component."));

// ---------------------------------------------------------------------------
// tree helpers

const isObj = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);

export function getNode(tree: Tree, path: string): Tree | undefined {
  let n: unknown = tree;
  for (const k of path.split(".")) {
    if (!isObj(n)) return undefined;
    n = n[k];
  }
  return isObj(n) ? n : undefined;
}

export function setToken(tree: Tree, path: string, token: Tree) {
  const keys = path.split(".");
  let n = tree;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(n[k]) || "$value" in (n[k] as Tree)) n[k] = {};
    n = n[k] as Tree;
  }
  n[keys[keys.length - 1]] = token;
}

/** Every reference in an authored value: the value itself, or e.g. the stop colours of a gradient. */
const refsIn = (v: unknown): string[] =>
  typeof v === "string" ? (v.match(/^\{([^}]+)\}$/)?.slice(1) ?? []) : Array.isArray(v) ? v.flatMap(refsIn) : isObj(v) ? Object.values(v).flatMap(refsIn) : [];

/**
 * Fill every contract path the tree lacks. A built-in value that references other contract paths
 * (e.g. a component recipe pointing at "{bg.brand-strong}", or the backdrop gradient fading from
 * "{bg.brand-subtle}" to "{bg.canvas}") is copied with those references, so it resolves against
 * this tree's own roles (a dark system's backdrop fades to its dark canvas); anything else becomes
 * the built-in value as a literal (never an alias into the built-in primitives, which the new tree
 * doesn't have). Returns the completed copy and the paths that were filled.
 */
export function completeTree(tree: Tree): { tree: Tree; filled: string[] } {
  const out = structuredClone(tree);
  const have = new TokenSet(out);
  const broken = new Set(have.unresolved());
  const filled: string[] = [];
  for (const r of ROLE_SPECS) {
    const t = have.get(r.path);
    if (t && typeOk(r, t.type) && !broken.has(r.path)) continue;
    const b = BUILTIN.get(r.path)!;
    // Built-in choices that are specific to its look have neutral defaults (neutral.ts).
    const authored = neutralOf(r.path) ?? b.authored;
    const refs = refsIn(authored);
    const portable = refs.length > 0 && refs.every((p) => ROLE_PATHS.has(p) && !broken.has(p));
    const literal = neutralOf(r.path) !== undefined && !refs.length ? authored : b.value;
    setToken(out, r.path, !portable ? { $type: r.type, $value: structuredClone(literal) } : typeof authored === "string" ? { $value: authored } : { $type: r.type, $value: structuredClone(authored) });
    filled.push(r.path);
  }
  // A reference whose target was itself missing or broken falls back to the literal.
  const after = new TokenSet(out);
  for (const p of after.unresolved()) {
    const b = BUILTIN.get(p);
    if (b && ROLE_PATHS.has(p)) setToken(out, p, { $type: b.type, $value: structuredClone(b.value) });
  }
  return { tree: out, filled };
}

/** A stored system from before the contract grew (new components): fill what it lacks. */
export function upgradeTree(tree: Tree): Tree {
  const v = validateTree(tree);
  return isValid(v) ? tree : completeTree(tree).tree;
}

export interface Validation {
  missing: string[];
  wrongType: string[];
  unresolved: string[];
}

export function validateTree(tree: Tree): Validation {
  const ts = new TokenSet(tree);
  const unresolved = ts.unresolved();
  const missing: string[] = [];
  const wrongType: string[] = [];
  for (const r of ROLE_SPECS) {
    const t = ts.get(r.path);
    if (!t) missing.push(r.path);
    else if (!typeOk(r, t.type)) wrongType.push(r.path);
  }
  return { missing, wrongType, unresolved };
}

export const isValid = (v: Validation) => !v.missing.length && !v.wrongType.length && !v.unresolved.length;

/** Role paths of one type that designers bind to (no primitives / component / layout). */
export const rolesOf = (type: string) => ROLE_SPECS.filter((r) => r.type === type && isRolePath(r.path)).map((r) => r.path);
