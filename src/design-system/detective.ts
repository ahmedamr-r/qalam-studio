import { setToken } from "./contract";
import { normalizeValue, pathProblem } from "./edit";
import { TokenSet, normalizeHex, type Tree } from "./resolve";

/**
 * Turning the Token Detective's approved suggestions into tokens in a design system. The Detective
 * reports values the way sources write them (hex, "12px", a CSS font or box-shadow shorthand);
 * this parses them into DTCG values and adds each under the name the designer approved.
 */

export interface DetectedToken {
  /** The name the designer approved (possibly renamed). */
  name: string;
  type: "color" | "dimension" | "typography" | "shadow";
  value: string;
  intent: string;
  usage: string;
  action: "reuse-existing" | "new-token" | "split" | "merge" | "drop";
}

/** "600 16px/24px Inter", "16px/1.5 'DM Sans', sans-serif", "bold 14px Inter" → a typography value. */
export function parseFont(css: string): Record<string, unknown> | null {
  const m = css.trim().match(/^(?:(italic|normal)\s+)?(?:(\d{3}|bold|semibold|medium|regular|normal)\s+)?(\d+(?:\.\d+)?)px(?:\s*\/\s*(\d+(?:\.\d+)?)(px)?)?\s*(.*)$/i);
  if (!m) return null;
  const words: Record<string, number> = { bold: 700, semibold: 600, medium: 500, regular: 400, normal: 400 };
  const weight = m[2] ? (Number(m[2]) || words[m[2].toLowerCase()] || 400) : 400;
  const size = parseFloat(m[3]);
  const line = m[4] ? (m[5] ? parseFloat(m[4]) : parseFloat(m[4]) * size) : size * 1.4;
  const family = (m[6] || "").split(",")[0].replace(/["']/g, "").trim();
  return { fontFamily: family || "{font.family.latin}", fontWeight: weight, fontSize: `${size}px`, lineHeight: `${Math.round(line)}px`, letterSpacing: "0px" };
}

/** A CSS box-shadow ("0 2px 8px rgba(0,0,0,.08), inset 0 1px 0 #fff") → shadow layers. */
export function parseShadow(css: string): Record<string, unknown>[] | null {
  const parts = css.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  const layers: Record<string, unknown>[] = [];
  for (const p of parts) {
    const inset = /\binset\b/i.test(p);
    const color = p.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i)?.[0];
    const lengths = p
      .replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\binset\b/gi, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((x) => parseFloat(x));
    if (lengths.length < 2 || lengths.some((n) => !Number.isFinite(n))) return null;
    const hex = color ? normalizeHex(color) : "#00000033";
    if (!hex) return null;
    const [x, y, blur = 0, spread = 0] = lengths;
    layers.push({ color: hex, offsetX: `${x}px`, offsetY: `${y}px`, blur: `${blur}px`, spread: `${spread}px`, ...(inset ? { inset: true } : {}) });
  }
  return layers.length ? layers : null;
}

/** A token path from the approved name: kebab-case segments, dots between groups. */
export function tokenPath(name: string): string {
  return name
    .trim()
    .split(/[./]/)
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join(".");
}

/**
 * Add approved suggestions to a tree. Reused and dropped values add nothing; a name that already
 * exists is left alone (renaming or re-pointing a system role belongs in the token editor); merged
 * near-duplicates share one name and are added once.
 */
export function addDetectedTokens(tree: Tree, rows: DetectedToken[]): { tree: Tree; added: string[]; skipped: { name: string; reason: string }[] } {
  const out = structuredClone(tree);
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const path = tokenPath(r.name);
    if (r.action === "drop") continue;
    if (r.action === "reuse-existing") {
      skipped.push({ name: r.name, reason: "reuses an existing token" });
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    const problem = pathProblem(out, path);
    if (problem) {
      skipped.push({ name: r.name, reason: problem });
      continue;
    }
    const raw = r.type === "typography" ? parseFont(r.value) : r.type === "shadow" ? parseShadow(r.value) : r.value;
    const v = raw === null ? { error: `couldn't read "${r.value}"` } : normalizeValue(r.type, raw);
    if ("error" in v) {
      skipped.push({ name: r.name, reason: v.error });
      continue;
    }
    setToken(out, path, { $type: r.type, $value: v.value, $description: `${r.intent}${r.usage ? `. Used by: ${r.usage}` : ""}`.slice(0, 300) });
    added.push(path);
  }
  // Nothing added may leave an alias dangling (a typography family pointing at a missing role).
  const broken = new TokenSet(out).unresolved().filter((p) => added.includes(p));
  if (broken.length) {
    const again = addDetectedTokens(tree, rows.filter((r) => !broken.includes(tokenPath(r.name))));
    return { ...again, skipped: [...again.skipped, ...broken.map((name) => ({ name, reason: "refers to a token this system doesn't have" }))] };
  }
  return { tree: out, added, skipped };
}
