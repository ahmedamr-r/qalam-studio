import { FACT_FIELDS, MARKET_LIMITS, emptyMarket, type Competitor, type FactField, type Market, type MarketBy, type MarketLine } from "./types";

/*
 * hub/market.md: what's known about the company, its competitors and its domain, readable like a
 * topic page (pure). Each line links the page it was read on; its record (who wrote it, the page,
 * the words found there) is a comment. The words are a person's to edit, the records aren't: a
 * line a person writes or edits is theirs (`by: "you"`), and Qalam AI never rewrites it.
 */

const RECORD = /\s*<!--\s*qalam\s+(\{.*\})\s*-->\s*$/;
/** A record in a comment: JSON that can't close the comment early. */
const record = (o: Record<string, unknown>) => ` <!-- qalam ${JSON.stringify(o).replace(/--/g, "-\\u002d").replace(/>/g, "\\u003e")} -->`;
const LINK_TAIL = /\s*\(\[[^\]]*\]\((https?:\/\/[^)\s]+)\)\)\s*$/;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const json = (s: string): Record<string, unknown> => {
  try {
    return rec(JSON.parse(s));
  } catch {
    return {};
  }
};
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? one(v).slice(0, max) : undefined);
const byOf = (v: unknown): MarketBy => (v === "you" ? "you" : "qalam");
const atOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fieldOf = (v: unknown): FactField | undefined => (typeof v === "string" && (FACT_FIELDS as readonly string[]).includes(v) ? (v as FactField) : undefined);
const label = (s: string) => s.replace(/[[\]]/g, "").slice(0, MARKET_LIMITS.title);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A short hash of a line's words: changed words (a person's edit) make the line theirs. */
function wordsHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of one(text)) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(36);
}

const SECTIONS = { company: "The company", competitors: "Competitors", domain: "The domain" } as const;
const DOMAIN = { aims: "What companies like it aim for", struggles: "What their customers struggle with" } as const;

function lineMd(l: MarketLine): string {
  const link = l.url ? ` ([${label(l.title || hostOf(l.url))}](${l.url}))` : "";
  return `- ${one(l.text)}${link}${record({ id: l.id, by: l.by, at: l.at, h: wordsHash(l.text), ...(l.field ? { field: l.field } : {}), ...(l.url ? { url: l.url } : {}), ...(l.title ? { title: l.title } : {}), ...(l.quote ? { quote: l.quote } : {}) })}`;
}

export function marketToMarkdown(m: Market, o: { org: string }): string {
  const out = ["---", `qalam: "market/1"`, `gone: ${JSON.stringify(m.gone)}`, "---", "", `# What's known about ${o.org}`, "", "From the web and from you. Each line links where it was read; edit the words, not the records. None of it is what customers said.", ""];
  out.push(`## ${SECTIONS.company}`, "", ...m.company.map(lineMd), "");
  out.push(`## ${SECTIONS.competitors}`, "");
  for (const c of m.competitors) {
    out.push(`### ${one(c.name)}${c.url ? ` ([${label(hostOf(c.url))}](${c.url}))` : ""}${record({ id: c.id, by: c.by, at: c.at, ...(c.url ? { url: c.url } : {}) })}`, "", ...c.lines.map(lineMd), "");
  }
  out.push(`## ${SECTIONS.domain}`, "", `### ${DOMAIN.aims}`, "", ...m.aims.map(lineMd), "", `### ${DOMAIN.struggles}`, "", ...m.struggles.map(lineMd), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

let made = 0;
const freshId = (p: string) => `${p}${Date.now().toString(36)}${(made++).toString(36)}`;

function lineOf(raw: string): MarketLine | null {
  const r = RECORD.exec(raw);
  const data = r ? json(r[1]) : {};
  let text = raw.replace(RECORD, "");
  const link = LINK_TAIL.exec(text);
  text = one(text.replace(LINK_TAIL, ""));
  if (!text) return null;
  const url = str(data.url, 2000) ?? link?.[1];
  // A line written with no record is a person's, and so is one whose words they changed.
  const by = !r || (typeof data.h === "string" && data.h !== wordsHash(text)) ? "you" : byOf(data.by);
  return { id: str(data.id, 40) ?? freshId("m"), text: text.slice(0, MARKET_LIMITS.text), by, at: atOf(data.at), ...(fieldOf(data.field) ? { field: fieldOf(data.field) } : {}), ...(url ? { url } : {}), ...(str(data.title, MARKET_LIMITS.title) ? { title: str(data.title, MARKET_LIMITS.title) } : {}), ...(str(data.quote, MARKET_LIMITS.quote) ? { quote: str(data.quote, MARKET_LIMITS.quote) } : {}) };
}

export function marketFromMarkdown(md: string): Market {
  const m = emptyMarket();
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (front) {
    const gone = /^gone:\s*(.*)$/m.exec(front[1]);
    if (gone) {
      try {
        const list = JSON.parse(gone[1]) as unknown;
        if (Array.isArray(list)) m.gone = list.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());
      } catch {
        // A hand-edited list that isn't JSON: nothing gone.
      }
    }
  }
  let section: keyof typeof SECTIONS | null = null;
  let domain: keyof typeof DOMAIN | null = null;
  let competitor: Competitor | null = null;
  for (const raw of (front ? md.slice(front[0].length) : md).split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(raw);
    if (h2 && !raw.startsWith("###")) {
      const name = h2[1].toLowerCase();
      section = name === SECTIONS.company.toLowerCase() ? "company" : name === SECTIONS.competitors.toLowerCase() ? "competitors" : name === SECTIONS.domain.toLowerCase() ? "domain" : null;
      competitor = null;
      domain = null;
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(raw);
    if (h3) {
      if (section === "domain") {
        const name = h3[1].toLowerCase();
        domain = name === DOMAIN.aims.toLowerCase() ? "aims" : name === DOMAIN.struggles.toLowerCase() ? "struggles" : null;
      } else if (section === "competitors") {
        const r = RECORD.exec(h3[1]);
        const data = r ? json(r[1]) : {};
        const head = h3[1].replace(RECORD, "");
        const link = LINK_TAIL.exec(head);
        const name = one(head.replace(LINK_TAIL, "")).slice(0, MARKET_LIMITS.name);
        if (!name) continue;
        const url = str(data.url, 2000) ?? link?.[1];
        competitor = { id: str(data.id, 40) ?? freshId("c"), name, ...(url ? { url } : {}), lines: [], by: r ? byOf(data.by) : "you", at: atOf(data.at) };
        m.competitors.push(competitor);
      }
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!bullet) continue;
    const line = lineOf(bullet[1]);
    if (!line) continue;
    if (section === "company") m.company.push(line);
    else if (section === "competitors" && competitor) competitor.lines.push(line);
    else if (section === "domain" && domain) m[domain].push(line);
  }
  return m;
}
