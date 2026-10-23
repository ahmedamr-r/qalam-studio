import { differenceCiede2000, parse, formatHex, formatHex8, wcagContrast } from "culori";
import type { Effect, Gradient } from "@/doc/schema";
import type { IconSet } from "./icons";
import raw from "./tokens.json";

export type TokenType = "color" | "dimension" | "fontFamily" | "typography" | "shadow" | "gradient" | string;

export interface Token {
  path: string;
  type: TokenType;
  /** Fully resolved value (aliases followed). Colours are upper-case #RRGGBB / #RRGGBBAA. */
  value: unknown;
  /** Value as authored, possibly an alias like "{color.ink.500}". */
  authored: unknown;
  /** Alias target when the token is a reference. */
  aliasOf?: string;
  description?: string;
}

export interface TypeStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export type Tree = Record<string, unknown>;

const isObj = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);
const ALIAS = /^\{([^}]+)\}$/;

export function normalizeHex(input: string): string | null {
  const c = parse(input.trim());
  if (!c) return null;
  const alpha = c.alpha ?? 1;
  return (alpha < 1 ? formatHex8(c) : formatHex(c)).toUpperCase();
}

export function px(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Flatten a DTCG tree into tokens, inheriting $type from groups and resolving aliases. */
export function flattenTokens(tree: Tree): Token[] {
  const out: Token[] = [];
  const walk = (node: Tree, prefix: string[], inheritedType?: string) => {
    const groupType = typeof node.$type === "string" ? node.$type : inheritedType;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || !isObj(child)) continue;
      const path = [...prefix, key];
      if ("$value" in child) {
        out.push({
          path: path.join("."),
          type: (typeof child.$type === "string" ? child.$type : groupType) ?? "unknown",
          value: child.$value,
          authored: child.$value,
          description: typeof child.$description === "string" ? child.$description : undefined,
        });
      } else {
        walk(child, path, groupType);
      }
    }
  };
  walk(tree, []);

  const byPath = new Map(out.map((t) => [t.path, t]));
  const resolveValue = (v: unknown, depth = 0): unknown => {
    if (depth > 10) return v;
    if (typeof v === "string") {
      const m = v.match(ALIAS);
      if (m) {
        const target = byPath.get(m[1]);
        return target ? resolveValue(target.authored, depth + 1) : v;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => resolveValue(x, depth + 1));
    if (isObj(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, depth + 1)]));
    }
    return v;
  };
  for (const t of out) {
    if (typeof t.authored === "string") {
      const m = t.authored.match(ALIAS);
      if (m) t.aliasOf = m[1];
    }
  }
  // Untyped aliases (e.g. component recipes) take the type of what they point at.
  for (const t of out) {
    let hop: Token | undefined = t;
    for (let i = 0; i < 10 && hop && hop.type === "unknown" && hop.aliasOf; i++) hop = byPath.get(hop.aliasOf);
    if (hop && hop !== t && hop.type !== "unknown") t.type = hop.type;
  }
  for (const t of out) {
    t.value = resolveValue(t.authored);
    if (t.type === "color" && typeof t.value === "string") t.value = normalizeHex(t.value) ?? t.value;
  }
  return out;
}

export class TokenSet {
  readonly tokens: Token[];
  private byPath: Map<string, Token>;
  /** The icon set the system draws with, from the "qalam.iconSet" extension on the tree's root (Lucide by default). */
  readonly iconSet: IconSet;

  constructor(tree: Tree) {
    this.tokens = flattenTokens(tree);
    this.byPath = new Map(this.tokens.map((t) => [t.path, t]));
    const ext = (tree.$extensions as Record<string, unknown> | undefined)?.["qalam.iconSet"];
    this.iconSet = ext === "hugeicons" ? "hugeicons" : "lucide";
  }

  get(path: string): Token | undefined {
    return this.byPath.get(path);
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  color(path: string): string | undefined {
    const t = this.byPath.get(path);
    return t && t.type === "color" ? (t.value as string) : undefined;
  }

  dimension(path: string): number | undefined {
    const t = this.byPath.get(path);
    return t && t.type === "dimension" ? px(t.value) : undefined;
  }

  /** A string option (component structure, see styles.ts): the value if it's one of `allowed`, else `fallback`. */
  option<T extends string>(path: string, allowed: readonly T[], fallback: T): T {
    const v = this.byPath.get(path)?.value;
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  }

  typography(path: string): TypeStyle | undefined {
    const t = this.byPath.get(path);
    if (!t || t.type !== "typography" || !isObj(t.value)) return undefined;
    const v = t.value;
    return {
      fontFamily: String(v.fontFamily ?? "Inter"),
      fontWeight: Number(v.fontWeight ?? 400),
      fontSize: px(v.fontSize),
      lineHeight: px(v.lineHeight),
      letterSpacing: px(v.letterSpacing),
    };
  }

  /** Shadow layers of a shadow token; `[]` for "none", undefined when missing. */
  shadowLayers(path: string): Effect[] | undefined {
    const t = this.byPath.get(path);
    if (!t || t.type !== "shadow") return undefined;
    const list = Array.isArray(t.value) ? t.value : [t.value];
    return list.filter(isObj).map((l) => ({
      kind: l.inset ? "inner" : "drop",
      x: px(l.offsetX),
      y: px(l.offsetY),
      blur: px(l.blur),
      spread: px(l.spread),
      color: normalizeHex(String(l.color ?? "#00000000")) ?? "#00000000",
    }));
  }

  gradient(path: string): Gradient | undefined {
    const t = this.byPath.get(path);
    if (!t || t.type !== "gradient" || !isObj(t.value)) return undefined;
    const v = t.value;
    const stops = (Array.isArray(v.stops) ? v.stops : []).filter(isObj).map((s) => ({
      color: normalizeHex(String(s.color ?? "#000000")) ?? "#000000",
      position: Math.min(1, Math.max(0, Number(s.position ?? 0))),
    }));
    if (stops.length < 2) return undefined;
    return { kind: v.kind === "radial" ? "radial" : "linear", angle: Number(v.angle ?? 180), stops };
  }

  /** A fill: a flat colour, or a gradient plus a representative colour for contrast checks. */
  paint(path: string): { color: string; gradient?: Gradient } | undefined {
    const c = this.color(path);
    if (c) return { color: c };
    const g = this.gradient(path);
    return g ? { color: gradientAverage(g), gradient: g } : undefined;
  }

  /** Font families this set renders with (family tokens and type styles). */
  families(): string[] {
    const fromType = this.ofType("typography").map((t) => (isObj(t.value) ? String(t.value.fontFamily ?? "") : ""));
    return [...new Set([...this.ofType("fontFamily").map((t) => String(t.value)), ...fromType])].filter(Boolean);
  }

  /** Paths whose value still contains an alias that points nowhere. */
  unresolved(): string[] {
    const bad = (v: unknown): boolean =>
      typeof v === "string" ? ALIAS.test(v) : Array.isArray(v) ? v.some(bad) : isObj(v) ? Object.values(v).some(bad) : false;
    return this.tokens.filter((t) => bad(t.value)).map((t) => t.path);
  }

  ofType(type: TokenType, prefix?: string): Token[] {
    return this.tokens.filter((t) => t.type === type && (!prefix || t.path.startsWith(prefix)));
  }

  /** Role tokens a designer binds to: not primitives, component recipes or layout metrics. */
  roles(type: TokenType): Token[] {
    return this.tokens.filter((t) => t.type === type && isRolePath(t.path));
  }

  /** Semantic colour tokens (aliases), which are what designers should bind to. */
  semanticColors(): Token[] {
    return this.roles("color");
  }

  /**
   * Nearest colour token by CIEDE2000. Prefers semantic tokens in `prefixes` order,
   * e.g. ["text."] for a text fill so we suggest `text.secondary`, not `color.neutral.600`.
   */
  nearestColor(hex: string, prefixes?: string[]): { token: Token; deltaE: number } | null {
    const target = parse(hex);
    if (!target) return null;
    const diff = differenceCiede2000();
    const pool = this.tokens.filter(
      (t) => t.type === "color" && (prefixes ? prefixes.some((p) => t.path.startsWith(p)) : !t.path.startsWith("component.")),
    );
    let best: { token: Token; deltaE: number } | null = null;
    for (const t of pool) {
      const c = parse(t.value as string);
      if (!c) continue;
      const d = diff(target, c);
      if (!best || d < best.deltaE) best = { token: t, deltaE: d };
    }
    return best;
  }

  /** Exact colour matches – several semantic tokens can legitimately share one hex. */
  colorMatches(hex: string): Token[] {
    const n = normalizeHex(hex);
    return this.tokens.filter((t) => t.type === "color" && t.value === n);
  }

  nearestDimension(value: number, prefix: string): { token: Token; delta: number } | null {
    let best: { token: Token; delta: number } | null = null;
    for (const t of this.ofType("dimension", prefix)) {
      const d = Math.abs(px(t.value) - value);
      if (!best || d < best.delta) best = { token: t, delta: d };
    }
    return best;
  }

  nearestTypography(fontSize: number, fontWeight: number): { token: Token; score: number } | null {
    let best: { token: Token; score: number } | null = null;
    for (const t of this.ofType("typography")) {
      const s = this.typography(t.path)!;
      const score = Math.abs(s.fontSize - fontSize) * 10 + Math.abs(s.fontWeight - fontWeight) / 100;
      if (!best || score < best.score) best = { token: t, score };
    }
    return best;
  }
}

/** Primitive ramps, component recipes and layout metrics are not offered as bindable roles. */
export function isRolePath(path: string): boolean {
  return !path.startsWith("color.") && !path.startsWith("component.") && !path.startsWith("layout.");
}

/** Mean of the stops in sRGB: good enough as a flat stand-in for contrast checks. */
export function gradientAverage(g: Gradient): string {
  const cs = g.stops.map((s) => parse(s.color)).filter(Boolean) as unknown as { r: number; g: number; b: number }[];
  if (!cs.length) return "#000000";
  const avg = (k: "r" | "g" | "b") => cs.reduce((a, c) => a + c[k], 0) / cs.length;
  return formatHex({ mode: "rgb", r: avg("r"), g: avg("g"), b: avg("b") }).toUpperCase();
}

/** The built-in design system. */
export const BUILTIN = new TokenSet(raw as Tree);
/** @deprecated Resolve through the design-system registry; kept for tests and legacy callers. */
export const tokens = BUILTIN;

export function contrastRatio(fg: string, bg: string): number {
  return wcagContrast(fg, bg);
}

export type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";

export function wcagLevel(ratio: number, largeText = false): WcagLevel {
  if (largeText) return ratio >= 4.5 ? "AAA" : ratio >= 3 ? "AA" : "Fail";
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

/** WCAG 1.4.3: large = >= 24px regular or >= 18.66px bold. */
export function isLargeText(fontSize: number, fontWeight: number): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

/** Alpha-composite a #RRGGBBAA colour over an opaque background. */
export function flatten(fg: string, bg: string): string {
  const f = parse(fg);
  const b = parse(bg);
  if (!f || !b) return fg;
  const a = f.alpha ?? 1;
  if (a >= 1) return normalizeHex(fg) ?? fg;
  const fr = f as unknown as { r: number; g: number; b: number };
  const br = b as unknown as { r: number; g: number; b: number };
  const mix = { mode: "rgb" as const, r: fr.r * a + br.r * (1 - a), g: fr.g * a + br.g * (1 - a), b: fr.b * a + br.b * (1 - a) };
  return formatHex(mix).toUpperCase();
}
