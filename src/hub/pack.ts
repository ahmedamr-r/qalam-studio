import { entry, type ManifestEntry } from "@/knowledge/trace";

/**
 * A budget of the organization's knowledge for one call (pure). The best pieces go in whole, the
 * rest as one line each, until the budget is spent; when everything fits, everything goes whole.
 * Each piece gets the id the prompt shows it with ([k1]), and the manifest maps ids back to
 * pieces, so code keeps only citations of pieces that were sent (sanitizeReliance).
 */

export interface PackItem {
  ref: string;
  text: string;
  line: string;
  /** Cards it's about. */
  topics?: string[];
}

export interface Packed {
  block: string;
  items: { k: string; ref: string; whole: boolean }[];
  manifest: ManifestEntry[];
  tokens: number;
  /** Pieces that didn't fit. */
  left: number;
}

/** About how many tokens a text is (English prose runs near four characters a token). */
export const tokensOf = (s: string) => Math.ceil(s.length / 3.8);

const SHORT = 160;

function render(p: PackItem, k: string, whole: boolean): string {
  // A card the line already names isn't said twice.
  const topics = (p.topics ?? []).filter((t) => !p.line.includes(`“${t}”`));
  const about = topics.length ? ` · about ${topics.map((t) => `“${t}”`).join(", ")}` : "";
  const text = p.text.replace(/\s+/g, " ").trim();
  if (whole) return `[${k}] ${p.line}${about}\n${text}`;
  return `[${k}] ${p.line}${about}: ${text.length > SHORT ? `${text.slice(0, SHORT - 1).trimEnd()}…` : text}`;
}

export function pack(ranked: PackItem[], opts: { budget: number; wholeTop?: number; prefix?: string }): Packed {
  const prefix = opts.prefix ?? "k";
  const wholeTop = opts.wholeTop ?? 8;
  const everything = ranked.reduce((s, p, i) => s + tokensOf(render(p, `${prefix}${i + 1}`, true)) + 1, 0) <= opts.budget;
  const blocks: string[] = [];
  const items: Packed["items"] = [];
  const manifest: ManifestEntry[] = [];
  let tokens = 0;
  for (const p of ranked) {
    const k = `${prefix}${items.length + 1}`;
    let whole = everything || items.length < wholeTop;
    let text = render(p, k, whole);
    if (tokens + tokensOf(text) + 1 > opts.budget && whole) {
      whole = false;
      text = render(p, k, false);
    }
    if (tokens + tokensOf(text) + 1 > opts.budget) break;
    tokens += tokensOf(text) + 1;
    blocks.push(text);
    items.push({ k, ref: p.ref, whole });
    manifest.push(entry(k, p.ref, p.text));
  }
  return { block: blocks.join("\n"), items, manifest, tokens, left: ranked.length - items.length };
}
