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
