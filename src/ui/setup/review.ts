import type { Product } from "@/org/context-md";
import type { SetupField, SetupLine, SetupSession } from "@/org/setup";

/*
 * Qalam AI's proposal by where each line goes (pure): the organization first, then each product,
 * new ones as Qalam AI named them. The goals show apart, as one tree (goalLines in src/org/setup.ts).
 */

export const ORG_FIELD: Record<SetupField, string> = { audience: "Who we serve", context: "What we do", goals: "Goals", segments: "Segments" };
export const PRODUCT_FIELD: Record<SetupField, string> = { audience: "Who it's for", context: "Context", goals: "Goals", segments: "Segments" };
const ORDER: SetupField[] = ["context", "audience", "goals", "segments"];

export interface LineGroup {
  key: string;
  title: string;
  /** A product Qalam AI proposes that isn't there yet. */
  fresh: boolean;
  labels: Record<SetupField, string>;
  lines: SetupLine[];
}

/** The lines that aren't goals, by where they go. */
export function groupsOf(s: SetupSession, org: string, products: readonly Product[]): LineGroup[] {
  const lines = (s.proposal?.lines ?? []).filter((l) => l.field !== "goals");
  const ordered = (to: string) => lines.filter((l) => l.to === to).sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
  const groups: LineGroup[] = [{ key: "org", title: `About ${org}`, fresh: false, labels: ORG_FIELD, lines: ordered("org") }];
  for (const to of [...new Set(lines.map((l) => l.to))].filter((t) => t !== "org")) {
    const made = to.startsWith("new:") ? s.made?.[to.slice(4)] : to;
    const p = products.find((x) => x.id === made);
    const proposed = s.proposal?.products.find((x) => `new:${x.ref}` === to);
    groups.push({ key: to, title: p?.name ?? proposed?.name ?? "A product", fresh: to.startsWith("new:") && !p, labels: PRODUCT_FIELD, lines: ordered(to) });
  }
  return groups.filter((g) => g.lines.length);
}

/** Where a line goes, by name: the organization, or a product (a new one as Qalam AI named it). */
export function placeName(to: string, s: SetupSession, products: readonly Product[]): string {
  if (to === "org") return "The whole organization";
  const made = to.startsWith("new:") ? s.made?.[to.slice(4)] : to;
  const proposed = s.proposal?.products.find((x) => `new:${x.ref}` === to);
  return products.find((x) => x.id === made)?.name ?? (proposed ? `${proposed.name} · a new product` : "A product");
}
