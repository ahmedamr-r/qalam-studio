import type { Market } from "./types";

/*
 * What's known about the company's market, as a call is told it (pure): its competitors, and (when
 * asked for) what companies like it aim for and what their customers struggle with. Always said to
 * be read on the web or the team's say-so, never what customers said.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function marketText(m: Market, o: { org: string; domain?: boolean; max?: number }): string {
  const out: string[] = [];
  if (m.competitors.length) out.push(`${o.org}'s competitors: ${m.competitors.map((c) => (c.lines[0] ? `${c.name} (${one(c.lines[0].text)})` : c.name)).join("; ")}.`);
  if (o.domain && m.aims.length) out.push(`What companies like ${o.org} usually aim for and measure (read on the web, not ${o.org}'s customers):`, ...m.aims.map((l) => `- ${one(l.text)}`));
  if (o.domain && m.struggles.length) out.push(`What customers of companies like ${o.org} usually struggle with (read on the web, not ${o.org}'s own customers):`, ...m.struggles.map((l) => `- ${one(l.text)}`));
  return out.join("\n").slice(0, o.max ?? 3000);
}

/**
 * The company's facts and its competitors, for a call that hears them beside what it works on.
 * `told` is what the call is told already (the About, which the first run fills from the facts), so
 * a fact in it isn't said twice.
 */
export function marketContext(m: Market, o: { org: string; told?: string; max?: number }): string {
  const told = one(o.told ?? "");
  const facts = m.company.map((l) => one(l.text)).filter((t) => !told.includes(t));
  const rivals = marketText(m, { org: o.org });
  if (!facts.length && !rivals) return "";
  return [`What's known about ${o.org}, read on the web or said by the team (context, never what its customers said):`, ...facts.map((t) => `- ${t}`), rivals].filter(Boolean).join("\n").slice(0, o.max ?? 1500);
}

/**
 * A draft's material with what's known about the company after it. Put on after the words a draft
 * may rest on are worked out (its `hay`), so it words a draft and no number or quote can come from it.
 */
export const withCompany = (text: string, company?: string) => (company?.trim() ? `${text}\n\nThe company (context for what fits it and what others already offer; nothing a draft rests on, and no number or quote may come from it):\n${company.trim()}` : text);
