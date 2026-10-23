/** Identifiers and literals for generated code (pure). */

const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield", "let", "static", "implements", "interface", "package", "private", "protected", "public",
  "await", "async", "of", "undefined", "NaN", "Infinity",
]);

/** Latin words of a name ("Order tracking · Map first" → ["Order", "tracking", "Map", "first"]). */
const words = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[A-Za-z0-9]+/g) ?? [];

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/** "map first" → "MapFirst"; null when the name has no Latin letters or digits. */
export function pascal(s: string, maxWords = 4): string | null {
  const w = words(s).slice(0, maxWords);
  if (!w.length) return null;
  const out = w.map((x) => cap(x.length > 1 && x === x.toUpperCase() ? x.toLowerCase() : x)).join("");
  return /^\d/.test(out) ? `N${out}` : out;
}

/** "Status bar" → "statusBar". */
export function camel(s: string, maxWords = 3): string | null {
  const p = pascal(s, maxWords);
  if (!p) return null;
  const out = p[0].toLowerCase() + p.slice(1);
  return RESERVED.has(out) ? `${out}_` : out;
}

/** `base`, else `base2`, `base3`… whichever is free; records it in `used`. */
export function unique(base: string, used: Set<string>): string {
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
}

/**
 * Component names for screens, without the part every name shares ("Order tracking · Map first",
 * "Order tracking · Timeline" → "MapFirst", "Timeline"). Names without Latin letters become Screen1…
 */
export function screenNames(names: string[]): string[] {
  const split = names.map((n) => n.split(/\s+[·•|/:—–-]\s+/));
  const shared = names.length > 1 && split.every((p) => p.length > 1 && p[0].trim().toLowerCase() === split[0][0].trim().toLowerCase());
  const used = new Set<string>(["Prototype"]);
  return split.map((parts, i) => unique(pascal(shared ? parts.slice(1).join(" ") : names[i]) ?? `Screen${i + 1}`, used));
}

/** A JS string literal. */
export const lit = (s: string) => JSON.stringify(s);

/** A property key: bare when it's an identifier, quoted otherwise. */
export const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k));

/** A number for code: at most 4 decimals, no "-0". */
export function num(n: number): string {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** JSX text: as is when it is plain, else a string expression. */
export function jsxText(s: string): string {
  return /^[^{}<>&\n\r]*$/.test(s) && s.trim() === s && s !== "" ? s : `{${lit(s)}}`;
}
