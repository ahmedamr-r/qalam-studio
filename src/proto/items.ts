/**
 * Items (pure): a collection's elements and the records code reads off them — a dish's title,
 * caption, price and picture; a size's name and what it adds — so the prototype's data comes from
 * the design itself and can't drift from what it shows. Nothing here is stored: records are read
 * again from the current design whenever they're needed.
 */
import type { Collection, Doc, SceneNode, SubRef } from "@/doc/schema";
import { pathMatches } from "@/doc/proto";
import { instOf } from "@/design-system/instances";
import { findMoney, type MoneyFormat } from "./money";
import type { ExprType } from "./expr";
import { refFrame } from "./routes";

export interface ItemRecord {
  /** Its spec path in its frame ("body.2.children.0"). */
  id: string;
  /** Its place in the collection. */
  index: number;
  title: string;
  caption: string;
  /** The amount it shows (minor units), and what it adds when written with a sign ("+AED 6.00", "−AED 2.00"). */
  money: number;
  delta: number;
  image: string;
}

/** Every item's field, typed (for expressions). */
export const ITEM_FIELDS: Record<keyof ItemRecord, ExprType> = { id: "id", index: "int", title: "text", caption: "text", money: "money", delta: "money", image: "text" };

/** Layers under a node, in reading order (depth first). */
function walk(doc: Doc, id: string, out: SceneNode[] = []): SceneNode[] {
  for (const c of doc.nodes[id]?.children ?? []) {
    const n = doc.nodes[c];
    if (!n?.visible) continue;
    out.push(n);
    walk(doc, c, out);
  }
  return out;
}

/** A collection's elements in its frame: matching its pattern (and component), in reading order. */
export function collectionElements(doc: Doc, screen: string, col: Collection): { id: string; path: string }[] {
  const frame = refFrame(doc, screen, { part: col.of.part });
  if (!frame || !col.of.path) return [];
  const out: { id: string; path: string }[] = [];
  for (const n of walk(doc, frame)) {
    const p = n.meta.specPath;
    if (p === undefined || !pathMatches(col.of.path, p)) continue;
    if (col.component && !(n.meta.component ?? "").startsWith(col.component)) continue;
    if (!out.some((o) => o.path === p)) out.push({ id: n.id, path: p });
  }
  return out;
}

const strong = (n: SceneNode) => n.type === "text" && /strong|title|headline|display/.test(n.text.typeToken ?? "");

/** What an element says, read by role: its props when it's an instance that has them, else its copy. */
export function itemRecord(doc: Doc, id: string, path: string, index: number): ItemRecord {
  const props = (instOf(doc, id)?.props ?? {}) as Record<string, unknown>;
  const texts = walk(doc, id).filter((n): n is Extract<SceneNode, { type: "text" }> => n.type === "text");
  const money = texts.map((t) => findMoney(t.text.content)).find((m) => !!m) ?? (typeof props.trailingText === "string" ? findMoney(props.trailingText) : null);
  const plain = texts.filter((t) => !findMoney(t.text.content));
  const title = (typeof props.title === "string" && props.title) || (typeof props.label === "string" && props.label) || (plain.find(strong) ?? plain[0])?.text.content || "";
  const caption = (typeof props.subtitle === "string" && props.subtitle) || plain.find((t) => t.text.content !== title && /caption|body/.test(t.text.typeToken ?? ""))?.text.content || "";
  const image = walk(doc, id).find((n) => n.type === "image");
  return {
    id: path,
    index,
    title,
    caption,
    money: money?.amount ?? 0,
    delta: money?.signed ? money.amount : 0,
    image: image?.type === "image" ? image.src : "",
  };
}

/** A line as a row shows it (a basket's): its title, its note, how many, its amount (minor units) and each one's. */
export function lineRecord(doc: Doc, id: string): { title: string; note: string; qty: number; amount: number; unit: number } | null {
  const all = walk(doc, id);
  const texts = all.filter((n): n is Extract<SceneNode, { type: "text" }> => n.type === "text");
  const money = texts.map((t) => findMoney(t.text.content)).find((m) => !!m);
  // How many: the number a stepper in it shows.
  const stepper = all.find((n) => (n.meta.component ?? "").startsWith("Stepper"));
  const count = stepper ? walk(doc, stepper.id).find((n) => n.type === "text" && /^\d{1,3}$/.test(n.text.content.trim())) : undefined;
  const qty = count?.type === "text" ? Math.max(1, Number(count.text.content.trim())) : 1;
  const plain = texts.filter((t) => !findMoney(t.text.content) && t !== count && !/^\d{1,3}$/.test(t.text.content.trim()));
  const title = (plain.find(strong) ?? plain[0])?.text.content ?? "";
  if (!title || !money) return null;
  const note = plain.find((t) => t.text.content !== title)?.text.content ?? "";
  return { title, note, qty, amount: money.amount, unit: Math.round(money.amount / qty) };
}

/** A collection's records, in order. */
export function itemRecords(doc: Doc, screen: string, col: Collection): ItemRecord[] {
  return collectionElements(doc, screen, col).map((e, i) => itemRecord(doc, e.id, e.path, i));
}

/** The money format a collection's prices are written in (the first one that shows one). */
export function collectionMoney(doc: Doc, screen: string, col: Collection): MoneyFormat | null {
  for (const e of collectionElements(doc, screen, col)) {
    for (const n of walk(doc, e.id)) if (n.type === "text") {
      const m = findMoney(n.text.content);
      if (m) return m.format;
    }
  }
  return null;
}

/** The item an element belongs to: the innermost collection element its path is inside (or is) — a dish, not the section card around it. */
export function itemOf(doc: Doc, screen: string, cols: Record<string, Collection>, part: string | undefined, path: string): { collection: string; id: string } | null {
  let best: { collection: string; id: string } | null = null;
  for (const [cid, col] of Object.entries(cols)) {
    if ((col.of.part ?? undefined) !== part) continue;
    for (const e of collectionElements(doc, screen, col)) {
      if ((path === e.path || path.startsWith(`${e.path}.`)) && (!best || e.path.length > best.id.length)) best = { collection: cid, id: e.path };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Layers inside a component, by role

/**
 * Where a layer is, as the compiled module's TAPS name it: its spec path; inside a component,
 * where layers have none, the component's path and its place among the layers in it
 * ("body.2.children.0>5") — so the + in each of ten dish rows is a layer of its own.
 */
export function layerAddress(doc: Doc, id: string): string {
  const n = doc.nodes[id];
  if (!n) return "";
  if (n.meta.specPath !== undefined) return n.meta.specPath;
  let up = n.parentId ? doc.nodes[n.parentId] : undefined;
  while (up && up.meta.specPath === undefined) up = up.parentId ? doc.nodes[up.parentId] : undefined;
  if (!up) return "";
  return `${up.meta.specPath}>${walk(doc, up.id).findIndex((x) => x.id === id)}`;
}

const OPTION = /^(Chip|Tab|Segment)\//;

/** Layers of a role inside a component, in reading order (chips, tabs, segments; a stepper's − and +; a top bar's buttons). */
export function subLayers(doc: Doc, id: string, role: SubRef["role"]): string[] {
  const all = walk(doc, id);
  switch (role) {
    case "option":
      return all.filter((n) => OPTION.test(n.name) && n.meta.interactive !== false).map((n) => n.id);
    case "increase":
      return all.filter((n) => n.name === "Increase").map((n) => n.id);
    case "decrease":
      return all.filter((n) => n.name === "Decrease").map((n) => n.id);
    case "leading":
    case "trailing": {
      // A top bar's own buttons sit first and last in it (a spacer holds an empty side).
      const kids = (doc.nodes[id]?.children ?? []).map((c) => doc.nodes[c]).filter((n): n is SceneNode => !!n?.visible && n.name !== "Border");
      const n = role === "leading" ? kids[0] : kids[kids.length - 1];
      return n?.meta.interactive && kids.length > 1 ? [n.id] : [];
    }
    case "action":
      return all.filter((n) => n.meta.interactive).map((n) => n.id);
  }
}
