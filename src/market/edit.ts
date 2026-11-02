import { MARKET_LIMITS, type Competitor, type Market, type MarketLine } from "./types";

/*
 * A person's edits to what's known, from the canvas's Company section (pure). A line whose words
 * they change is theirs, and the page's own words no longer bear it out; a competitor they take off
 * is never proposed again, until they add it back.
 */

export type MarketSection = "company" | "competitors" | "aims" | "struggles";

export const MARKET_SECTIONS: readonly MarketSection[] = ["company", "competitors", "aims", "struggles"];

export type MarketEdit = { kind: "fix"; id: string; text: string } | { kind: "remove"; id: string } | { kind: "add"; section: MarketSection; text: string };

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export const roomIn = (m: Market, section: MarketSection) => m[section].length < (section === "company" ? MARKET_LIMITS.company : section === "competitors" ? MARKET_LIMITS.competitors : MARKET_LIMITS.domain);

/** Each list of lines changed by `fn`, a competitor's own lines too. */
function mapLines(m: Market, fn: (lines: MarketLine[]) => MarketLine[]): Market {
  return { ...m, company: fn(m.company), aims: fn(m.aims), struggles: fn(m.struggles), competitors: m.competitors.map((c) => ({ ...c, lines: fn(c.lines) })) };
}

const allLines = (m: Market) => [...m.company, ...m.aims, ...m.struggles, ...m.competitors.flatMap((c) => c.lines)];

export function editMarket(m: Market, e: MarketEdit, o: { now: number; id: (prefix: string) => string }): Market {
  if (e.kind === "remove") {
    const rival = m.competitors.find((c) => c.id === e.id);
    if (rival) return { ...m, competitors: m.competitors.filter((c) => c !== rival), gone: [...new Set([...m.gone, rival.name.toLowerCase()])] };
    return mapLines(m, (lines) => lines.filter((l) => l.id !== e.id));
  }
  if (e.kind === "fix") {
    const text = one(e.text).slice(0, MARKET_LIMITS.text);
    const was = allLines(m).find((l) => l.id === e.id);
    if (!text || !was || was.text === text) return m;
    return mapLines(m, (lines) => lines.map((l) => (l.id === e.id ? { id: l.id, text, ...(l.field ? { field: l.field } : {}), ...(l.url ? { url: l.url, title: l.title } : {}), by: "you", at: o.now } : l)));
  }
  const text = one(e.text);
  if (!text || !roomIn(m, e.section)) return m;
  if (e.section === "competitors") {
    const name = text.slice(0, MARKET_LIMITS.name);
    const key = name.toLowerCase();
    if (m.competitors.some((c) => c.name.toLowerCase() === key)) return m;
    const added: Competitor = { id: o.id("c"), name, lines: [], by: "you", at: o.now };
    return { ...m, competitors: [...m.competitors, added], gone: m.gone.filter((g) => g !== key) };
  }
  const line: MarketLine = { id: o.id(e.section === "company" ? "f" : "d"), text: text.slice(0, MARKET_LIMITS.text), ...(e.section === "company" ? { field: "does" as const } : {}), by: "you", at: o.now };
  return { ...m, [e.section]: [...m[e.section], line] };
}
