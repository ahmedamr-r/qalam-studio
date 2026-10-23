/**
 * A screen as the prototyping agent reads it (pure): what's on it by role and copy — its top bar,
 * rows of options, items and their prices, groups of choices, actions, the parts it already
 * opens — and what code can build there, by candidate id. The model only ever points at these
 * ids; it never sees or names a layer.
 */
import type { Doc } from "@/doc/schema";
import { instOf } from "@/design-system/instances";
import { itemRecord } from "../items";
import { findMoney } from "../money";
import { partFrames, routeOf } from "../routes";
import { scanFrame, tappedItems } from "../scan";
import { RECIPE_NAMES } from "../recipes";
import type { Candidate } from "./candidates";

const q = (s: string) => `"${s.replace(/\s+/g, " ").trim().slice(0, 80)}"`;

/** The first amount of money an element shows, as written. */
function moneyIn(doc: Doc, id: string): string | null {
  const n = doc.nodes[id];
  if (!n) return null;
  if (n.type === "text") return findMoney(n.text.content)?.text ?? null;
  for (const c of n.children) {
    const m = moneyIn(doc, c);
    if (m) return m;
  }
  return null;
}

/** A layer by spec path in a frame. */
function at(doc: Doc, frame: string, path: string): string | null {
  const stack = [...(doc.nodes[frame]?.children ?? [])];
  while (stack.length) {
    const id = stack.shift()!;
    const n = doc.nodes[id];
    if (!n) continue;
    if (n.meta.specPath === path) return id;
    stack.unshift(...n.children);
  }
  return null;
}

/** The screen, by role: a few lines. */
export function describeScreen(doc: Doc, screen: string): string {
  const n = doc.nodes[screen];
  const spec = n?.meta.spec as { platform?: string; lang?: string; dir?: string } | undefined;
  const scan = scanFrame(doc, screen);
  const lines: string[] = [`Screen ${q(n?.name ?? "")} (${spec?.platform ?? "mobile"}, ${spec?.lang ?? "en"}${spec?.dir === "rtl" ? ", right to left" : ""})`];
  if (scan.topBar) lines.push(`- top bar ${q(String(instOf(doc, scan.topBar.node)?.props?.title ?? ""))}`);
  for (const r of scan.optionRows) lines.push(`- a row of ${r.component === "ChipGroup" ? "chips" : r.component === "Tabs" ? "tabs" : "segments"}: ${r.labels.map(q).join(", ")}${r.selected >= 0 ? ` (${q(r.labels[r.selected])} picked)` : ""}`);
  if (scan.sections.length) lines.push(`- sections: ${scan.sections.map((s) => q(s.title)).join(", ")}`);
  for (const col of scan.collections) {
    const sample = col.items.slice(0, 3).map((p, i) => {
      const id = at(doc, screen, p);
      const r = id ? itemRecord(doc, id, p, i) : null;
      const price = id ? moneyIn(doc, id) : null;
      return r ? `${q(r.title)}${price ? ` at ${q(price)}` : ""}` : "";
    });
    lines.push(`- ${col.items.length} items, ${tappedItems(col) ? "each with a price, tapped to choose it" : "each with a +"}, e.g. ${sample.filter(Boolean).join("; ")}`);
  }
  for (const g of scan.groups) lines.push(`- ${g.pick === "one" ? "pick one" : "pick any"}${g.title ? ` ${q(g.title)}` : ""}: ${g.titles.join(", ")}`);
  // The items' prices say it best (a fee in a banner may drop the decimals).
  const priced = scan.collections.map((col) => at(doc, screen, col.items[0])).map((id) => (id ? moneyIn(doc, id) : null));
  const money = priced.find(Boolean) ?? scan.texts.map((t) => findMoney(t.text)?.text).find(Boolean) ?? scan.actions.map((a) => findMoney(a.label)?.text).find(Boolean);
  if (money) lines.push(`- money is written like ${q(money)}`);
  for (const a of scan.actions) lines.push(`- ${a.variant} button ${q(a.label)}`);
  const parts = partFrames(doc, screen);
  if (parts.length) lines.push(`- it already opens or shows: ${parts.map((p) => `a ${p.kind} ${q(doc.nodes[p.frame]?.name ?? p.part)}`).join(", ")}`);
  const steps = routeOf(doc, screen)?.steps ?? [];
  if (steps.length) lines.push(`- already prototyped: ${steps.map((s) => q(s.label)).join("; ")}`);
  return lines.join("\n");
}

/** The candidates, one line each, for the model to pick from by id. */
export function describeCandidates(cs: Candidate[]): string {
  return cs
    .map((c) =>
      [
        `${c.id}: ${RECIPE_NAMES[c.recipe] ?? c.recipe} — ${c.what}.`,
        c.needs ? ` Needs a new ${c.needs.kind} (you'll say what's in it).` : "",
        c.after ? ` Only after ${c.after}.` : "",
        c.instead ? ` An alternative to ${c.instead}: offer one of the two.` : "",
        c.main ? " On the main path." : "",
      ].join(""),
    )
    .join("\n");
}
