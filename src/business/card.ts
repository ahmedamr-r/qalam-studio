import type { ContextFields } from "@/org/context-md";
import type { Market } from "@/market/types";
import { linesIn, type Business } from "./types";

/*
 * The Business card at the top of a space's canvas (pure): how the business works in three rows, from
 * its page, else from what's known elsewhere (a fact read on the web, the About's audience). Drawn, not a
 * card on any board: nothing saves or composes it, and its size never changes, so an edit to the page
 * never moves the canvas.
 */

/** Its fixed size on the canvas. */
export const PLACE_CARD = { w: 320, h: 124 } as const;

export interface PlaceCard {
  title: string;
  rows: { label: string; text: string }[];
  /** Nothing known yet: drawn faint, saying it fills in as they talk. */
  empty: boolean;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function placeCardOf(o: { business: Business; about: ContextFields; market: Market; org: string }): PlaceCard {
  const first = (s: "earns" | "serves") => linesIn(o.business, s)[0]?.text;
  const fact = (f: "model" | "for") => o.market.company.find((l) => l.field === f)?.text;
  const earns = first("earns") ?? fact("model") ?? "";
  const serves = first("serves") ?? (one(o.about.audience) || fact("for") || "");
  const numbers = linesIn(o.business, "numbers")
    .slice(0, 2)
    .map((l) => one(l.text))
    .join(" · ");
  const rows = [
    { label: "Earns", text: one(earns) },
    { label: "Serves", text: one(serves) },
    { label: "Numbers", text: numbers },
  ];
  return { title: `How ${one(o.org) || "the business"} works`, rows, empty: rows.every((r) => !r.text) };
}
