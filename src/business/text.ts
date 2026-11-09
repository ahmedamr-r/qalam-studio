import { BUSINESS_SECTIONS, SECTION_LABEL, type Business, type BusinessLine, type BusinessSection } from "./types";

/*
 * How the business works as a call hears it (pure): each line under its section's name, Qalam AI's
 * readings marked as its own. Context, never evidence: callers put it after what quotes and numbers
 * are checked against, so nothing a card shows can come from it.
 *
 * A web search hears less (`research`): what the business is and how it reaches people, never what it
 * costs or its numbers, and no line with a figure in it.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The sections a web search may hear, and only their lines with no figure. */
const RESEARCH: readonly BusinessSection[] = ["serves", "gets", "earns", "finds", "stands"];
const FIGURE = /[\d٠-٩۰-۹]/;

const line = (l: BusinessLine) => `- ${SECTION_LABEL[l.section]}: ${one(l.text)}${l.by === "qalam" ? " (Qalam AI's reading of their answers, not their words)" : ""}`;

/** "" when nothing's known of the business yet. */
export function businessText(b: Business | null | undefined, o: { org?: string; max?: number; research?: boolean } = {}): string {
  if (!b?.lines.length) return "";
  const max = o.max ?? 1200;
  const sections = o.research ? RESEARCH : BUSINESS_SECTIONS;
  const order = sections.flatMap((s) => b.lines.filter((l) => l.section === s && (!o.research || (!FIGURE.test(l.text) && l.by !== "qalam"))));
  if (!order.length) return "";
  const head = o.research ? `What ${o.org ? `${one(o.org)} is` : "the business is"}, as the team tells it:` : `How ${o.org ? one(o.org) : "the business"} works, as the team tells it (what the business is, never what customers said):`;
  const lines: string[] = [];
  let size = head.length;
  for (const l of order) {
    const t = o.research ? `- ${SECTION_LABEL[l.section]}: ${one(l.text)}` : line(l);
    if (size + t.length + 1 > max) break;
    lines.push(t);
    size += t.length + 1;
  }
  return lines.length ? [head, ...lines].join("\n") : "";
}
