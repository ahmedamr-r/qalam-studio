/*
 * What's known about the organization's company, its competitors and its domain (hub/market.md):
 * read on the web in the first run and checked by code, or said by the person. Never customers'
 * evidence: a line here says what a page or the team says, not what customers said.
 */

export type MarketBy = "qalam" | "you";

/** What a company fact is about: what it does, who it's for, where, how it makes money, how far along, a product. */
export const FACT_FIELDS = ["does", "for", "where", "model", "stage", "product"] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const FIELD_LABEL: Record<FactField, string> = { does: "What it does", for: "Who it's for", where: "Where", model: "How it makes money", stage: "How far along", product: "A product" };

/** One thing known, in a sentence, with the page it was read on (a person's own has none). */
export interface MarketLine {
  id: string;
  text: string;
  field?: FactField;
  url?: string;
  title?: string;
  /** The page's own words that bear it out, found there by code. */
  quote?: string;
  by: MarketBy;
  at: number;
}

export interface Competitor {
  id: string;
  name: string;
  url?: string;
  lines: MarketLine[];
  by: MarketBy;
  at: number;
}

export interface Market {
  company: MarketLine[];
  competitors: Competitor[];
  /** What companies in the domain usually aim for and measure. */
  aims: MarketLine[];
  /** What their customers usually struggle with, complain about or ask for. */
  struggles: MarketLine[];
  /** Competitors they took off (lowercased names): never proposed again. */
  gone: string[];
}

export const emptyMarket = (): Market => ({ company: [], competitors: [], aims: [], struggles: [], gone: [] });

export const MARKET_LIMITS = { company: 14, competitors: 8, perCompetitor: 4, domain: 8, text: 300, name: 80, quote: 400, title: 160 } as const;

/** Anything known at all. */
export const knowsMarket = (m: Market | null | undefined) => !!m && (m.company.length > 0 || m.competitors.length > 0 || m.aims.length > 0 || m.struggles.length > 0);
