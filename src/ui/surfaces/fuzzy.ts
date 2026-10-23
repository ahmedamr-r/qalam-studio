/*
 * Fuzzy matching for the ⌘K palette and the shortcuts panel search. Pure, so it is tested on its own.
 *
 * A query matches a text when its characters appear in order. Matches score higher when they start
 * words ("fs" → "Frame selection"), run together, and sit near the start; an exact prefix or a whole
 * word wins outright. Multi-word queries must match every word ("zoom sel").
 */

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters in the text (for highlighting). */
  hits: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/.·:()…>]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/** One query word against a text: the best in-order match, or null. */
function matchWord(word: string, text: string, lower: string): FuzzyMatch | null {
  if (!word) return { score: 0, hits: [] };
  // Contiguous substrings first: they read as what the person meant.
  let best: FuzzyMatch | null = null;
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
    const boundary = isBoundary(text, at);
    const score = 100 + (boundary ? 60 : 0) + (at === 0 ? 40 : 0) - at * 0.5 + word.length * 4;
    if (!best || score > best.score) best = { score, hits: Array.from({ length: word.length }, (_, k) => at + k) };
    if (at === 0) break;
  }
  if (best) return best;
  // Then acronym-like subsequences: every letter starts a word or continues the previous hit
  // ("fs" → Frame Selection, "zsel" → Zoom to SELection), never letters scattered mid-word.
  const hits: number[] = [];
  let score = 0;
  for (const ch of word) {
    const prev = hits[hits.length - 1];
    let pick = -1;
    if (prev !== undefined && lower[prev + 1] === ch) pick = prev + 1;
    else for (let i = prev === undefined ? 0 : prev + 1; i < lower.length; i++) if (lower[i] === ch && isBoundary(text, i)) { pick = i; break; }
    if (pick < 0) return null;
    score += pick === prev! + 1 ? 6 : 12;
    hits.push(pick);
  }
  return { score: score - hits[0] * 0.3, hits };
}

/** Match a query against one text. Every query word must match. */
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: [] };
  const lower = text.toLowerCase();
  const hits = new Set<number>();
  let score = 0;
  for (const w of words) {
    const m = matchWord(w, text, lower);
    if (!m) return null;
    score += m.score;
    m.hits.forEach((h) => hits.add(h));
  }
  if (lower === query.toLowerCase().trim()) score += 200;
  return { score, hits: [...hits].sort((a, b) => a - b) };
}

export interface Searchable {
  label: string;
  keywords?: string[];
  /** Weaker context such as a category ("View", "Tool"). */
  extra?: string;
}

/**
 * Score an item across its label, keywords and category. Label hits count most and carry the
 * highlight; a keyword or category hit still lists the item, lower.
 */
export function scoreItem(query: string, item: Searchable): FuzzyMatch | null {
  const label = fuzzy(query, item.label);
  let best: FuzzyMatch | null = label ? { score: label.score + 50, hits: label.hits } : null;
  for (const k of item.keywords ?? []) {
    const m = fuzzy(query, k);
    if (m && (!best || m.score * 0.8 > best.score)) best = { score: m.score * 0.8, hits: label?.hits ?? [] };
  }
  if (item.extra) {
    const m = fuzzy(query, item.extra);
    if (m && (!best || m.score * 0.5 > best.score)) best = { score: m.score * 0.5, hits: label?.hits ?? [] };
  }
  // Query spread across label + keywords ("rulers show").
  if (!best) {
    const all = [item.label, ...(item.keywords ?? []), item.extra ?? ""].join(" · ");
    const m = fuzzy(query, all);
    if (m) best = { score: m.score * 0.4, hits: m.hits.filter((h) => h < item.label.length) };
  }
  return best;
}

/** Split a label into runs of matched / unmatched characters for rendering. */
export function highlightRuns(text: string, hits: number[]): { text: string; hit: boolean }[] {
  if (!hits.length) return [{ text, hit: false }];
  const set = new Set(hits);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
