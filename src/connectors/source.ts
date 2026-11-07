import type { OstMetric } from "@/discovery/types";
import { connectorDef } from "./catalog";

/*
 * Where a goal's number was read from, as a person says it (pure): a saved chart in an analytics
 * tool, a metric the team confirmed in its database, or a document that measured it. Code reads the
 * number in each case; this says where, and whether it can be read again from there (a document's
 * number stays as it was read).
 */

export type NumberSource = NonNullable<OstMetric["source"]>;

export type SourceKind = "analytics" | "database" | "document" | "other";

export interface SourceInfo {
  kind: SourceKind;
  /** Where it's from: "PostHog", "your database", "a document". */
  from: string;
  /** What it is there: the chart's, the metric's or the document's name. */
  what: string;
  /** It can be read again where it came from. */
  readsAgain: boolean;
}

/** The connector id a number read from the team's database goes by. */
export const DATABASE = "database";

export function sourceOf(s: NumberSource): SourceInfo {
  const what = s.label?.trim() || s.ref;
  if (s.connector === DATABASE) return { kind: "database", from: "your database", what, readsAgain: true };
  if (s.connector === "document") return { kind: "document", from: "a document", what, readsAgain: false };
  const def = connectorDef(s.connector);
  if (def?.numbers) return { kind: "analytics", from: def.label, what, readsAgain: true };
  return { kind: "other", from: def?.label ?? s.connector, what, readsAgain: false };
}

/** "PostHog · Weekly orders · Orders placed": where, what, and which of its numbers when that says more. */
export function sourceLine(s: NumberSource): string {
  const i = sourceOf(s);
  const from = i.from.charAt(0).toUpperCase() + i.from.slice(1);
  return [from, i.what, ...(s.series && s.series !== s.label && s.series !== "Value" ? [s.series] : [])].join(" · ");
}
