/**
 * What can be prototyped on a screen (pure): its affordances, found by role in the design — never
 * by product. A top bar content scrolls under; a row of options (chips, tabs, segments) whose
 * labels name the sections below it; repeated items that each carry an add action; groups of
 * pick-one or pick-any options; a quantity; the action that shows a price. Recipes
 * (proto/recipes.ts) turn these into behaviour; the prototyping agent proposes from them.
 */
import type { Doc, RouteRef, SceneNode } from "@/doc/schema";
import { CATALOG_BY_NAME } from "@/design-system/components";
import { instOf } from "@/design-system/instances";
import { subLayers } from "./items";
import { findMoney } from "./money";

export interface Found {
  /** Spec path of the component. */
  path: string;
  node: string;
  component: string;
}

export interface OptionRow extends Found {
  /** The options' labels, in order, and the one that's picked as designed (-1: none). */
  labels: string[];
  selected: number;
  /** For each option, the section below it that it names (its spec path), or null. */
  sections: (string | null)[];
}

export interface Collection {
  /** A pattern for its items ("body.*.children.*"), their component, and each item's path. */
  pattern: string;
  component: string;
  items: string[];
  /**
   * Where an item's add action sits, relative to the item ("children.1"); empty when it's inside
   * the item's own component (a Custom one, whose layers have no spec paths), where it's the
   * `nth` of the item's actions.
   */
  action: string;
  nth?: number;
}

/** A collection's add action: in every item (its pattern), or in one of them. */
export const addRef = (col: Collection, item = col.pattern): RouteRef =>
  col.action ? { path: `${item}.${col.action}` } : col.nth !== undefined ? { path: item, sub: { role: "action", nth: col.nth } } : { path: item };

/** Its items are tapped themselves (no + of their own). */
export const tappedItems = (col: Collection) => !col.action && col.nth === undefined;

export interface OptionGroup {
  /** The group's rows: a pattern for them, their paths, and pick-one (radio) or pick-any (checkbox). */
  pattern: string;
  rows: string[];
  pick: "one" | "any";
  /** The group's title ("Size · Required"), and whether it reads as required. */
  title: string;
  required: boolean;
  /** The row that's picked as designed (pick-one). */
  picked: string | null;
  /** Each row's name, and the amount it shows, as written: `diff` when it's a difference ("+AED 6.00", "−AED 2.00"). */
  titles: string[];
  prices: ({ amount: number; diff: boolean } | null)[];
}

/**
 * Lines a screen shows (a basket's, an order's): rows with a title and an amount, maybe how many,
 * that aren't items to add. The first stands for them all; in it, the title and the note as written,
 * and the stepper that says how many (by spec path, when the row has paths inside).
 */
export interface Lines {
  rows: string[];
  component: string;
  title: string;
  note: string | null;
  qty: string | null;
}

export interface FrameScan {
  topBar: Found | null;
  lines: Lines | null;
  optionRows: OptionRow[];
  collections: Collection[];
  groups: OptionGroup[];
  quantity: Found | null;
  /** The main action (primary, or danger for a destructive one), and whether its label shows an amount. */
  primary: (Found & { money: boolean; label: string }) | null;
  /** The action beside it that backs out (Cancel, Not now). */
  secondary: (Found & { label: string }) | null;
  /** Every action (button), with its variant: a destructive one may want confirming. */
  actions: (Found & { label: string; variant: string })[];
  /** Its copy (texts and summary values), and the copy that shows an amount (a total, what's sent). */
  texts: (Found & { text: string })[];
  amounts: (Found & { text: string })[];
  /** Body sections with a heading (a titled card or carousel, a stack that opens with a heading): path → title. */
  sections: { path: string; title: string; component: string }[];
  /** The first copy in the body (a description), when it leads it. */
  intro: Found | null;
}

/** Every component in a frame with its spec path, in reading order. */
function components(doc: Doc, frame: string): (Found & { props: Record<string, unknown> })[] {
  const out: (Found & { props: Record<string, unknown> })[] = [];
  const walk = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const n = doc.nodes[c];
      if (!n?.visible) continue;
      const p = n.meta.specPath;
      if (p !== undefined && !out.some((o) => o.path === p)) {
        const inst = instOf(doc, c);
        out.push({ path: p, node: c, component: inst?.component ?? (n.meta.component ?? "").split("/")[0], props: (inst?.props ?? {}) as Record<string, unknown> });
      }
      walk(c);
    }
  };
  walk(frame);
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The paths' common pattern: segments that differ become "*" ("body.2.children.0", "body.3.children.2" → "body.*.children.*"). */
export function patternOf(paths: string[]): string | null {
  if (!paths.length) return null;
  const split = paths.map((p) => p.split("."));
  if (split.some((s) => s.length !== split[0].length)) return null;
  return split[0].map((seg, i) => (split.every((s) => s[i] === seg) ? seg : "*")).join(".");
}

const ADD_ICON = /^(plus|add|plus-circle|circle-plus)$/;
const ADD_LABEL = /^(add|\+)/i;
const isAdd = (c: { component: string; props: Record<string, unknown> }) =>
  (c.component === "IconButton" && ADD_ICON.test(String(c.props.icon ?? ""))) || (c.component === "Button" && ADD_LABEL.test(String(c.props.label ?? "")));

/** An add action drawn inside a component of the design's own, read off its layers: a + icon button, a button that says Add. */
function isAddLayer(doc: Doc, id: string): boolean {
  const n = doc.nodes[id];
  const family = (n?.meta.component ?? "").split("/")[0];
  const below = (x: SceneNode): SceneNode[] => x.children.flatMap((c) => (doc.nodes[c] ? [doc.nodes[c], ...below(doc.nodes[c])] : []));
  if (family === "IconButton") return below(n).some((k) => k.type === "icon" && ADD_ICON.test(k.name));
  if (family === "Button") return below(n).some((k) => k.type === "text" && ADD_LABEL.test(k.text.content.trim()));
  return false;
}

/** Text styles a section's heading isn't written in. */
const RUNNING_TEXT = /^(body|caption)$/;

/** What a frame (a screen, or a part of one) offers to prototype. */
export function scanFrame(doc: Doc, frame: string): FrameScan {
  const all = components(doc, frame);
  const byPath = new Map(all.map((c) => [c.path, c]));
  const top = all.find((c) => c.component === "TopBar" && c.path.startsWith("header.")) ?? null;

  // Sections: body sections with a heading — a titled container (a card, a carousel, a panel), or a stack that opens with a heading and holds more.
  const sections = all
    .filter((c) => /^body\.\d+$/.test(c.path))
    .flatMap((c) => {
      if (CATALOG_BY_NAME.get(c.component)?.container && typeof c.props.title === "string" && c.props.title.trim()) return [{ path: c.path, title: c.props.title, component: c.component }];
      const head = byPath.get(`${c.path}.children.0`);
      if (c.component === "Stack" && head?.component === "Text" && typeof head.props.text === "string" && !RUNNING_TEXT.test(String(head.props.style ?? "body")) && byPath.has(`${c.path}.children.1`))
        return [{ path: c.path, title: head.props.text, component: c.component }];
      return [];
    });

  // Rows of options whose labels name sections below them.
  const optionRows: OptionRow[] = [];
  for (const c of all) {
    const labels = (c.component === "ChipGroup" ? c.props.chips : c.component === "Tabs" ? c.props.tabs : c.component === "SegmentedControl" ? c.props.options : null) as unknown;
    if (!Array.isArray(labels) || labels.length < 2) continue;
    const ls = labels.map(String);
    // Sections are body sections below the row.
    const at = Number(c.path.split(".")[1] ?? -1);
    const after = sections.filter((s) => Number(s.path.split(".")[1]) > at);
    const matched = ls.map((l) => after.find((s) => norm(s.title) === norm(l))?.path ?? null);
    // Chips may have none picked; tabs and segments always have one.
    const sel = Number(c.props.selected ?? (c.component === "ChipGroup" ? -1 : 0));
    optionRows.push({ path: c.path, node: c.node, component: c.component, labels: ls, selected: Number.isInteger(sel) && sel < ls.length ? sel : -1, sections: matched });
  }

  // Repeated items that each carry an add action. An item is the action's container that its
  // siblings repeat — another of them has an add action in the same place: a dish's row, not the
  // price stack inside it, nor the section around it.
  const adds = all.filter(isAdd);
  const addAt = new Set(adds.map((a) => a.path));
  const siblings = (item: string): string[] => {
    const at = item.lastIndexOf(".");
    const prefix = item.slice(0, at);
    return [...byPath.keys()].filter((p) => p !== item && p.startsWith(`${prefix}.`) && /^\d+$/.test(p.slice(prefix.length + 1)));
  };
  const groupsByAction = new Map<string, { items: string[]; adds: string[]; action: string; component: string }>();
  const join = (add: string, item: string, rel: string) => {
    const comp = byPath.get(item)!.component;
    const k = `${rel}|${comp}|${item.split(".").length}`;
    const g = groupsByAction.get(k) ?? { items: [], adds: [], action: rel, component: comp };
    g.items.push(item);
    g.adds.push(add);
    groupsByAction.set(k, g);
  };
  const lone: string[] = [];
  for (const a of adds) {
    const segs = a.path.split(".");
    let hit = false;
    for (let cut = segs.length - 2; cut >= 2 && !hit; cut -= 2) {
      const item = segs.slice(0, cut).join(".");
      const rel = segs.slice(cut).join(".");
      if (byPath.has(item) && siblings(item).some((x) => addAt.has(`${x}.${rel}`))) {
        join(a.path, item, rel);
        hit = true;
      }
    }
    if (!hit) lone.push(a.path);
  }
  // An item alone in its section (no sibling repeats it, so it matched a whole section) joins the items it looks like.
  for (const [k, g] of [...groupsByAction]) if (g.items.length === 1) {
    groupsByAction.delete(k);
    lone.push(g.adds[0]);
  }
  for (const add of lone) {
    const home = [...groupsByAction.values()].find((g) => {
      const item = add.endsWith(`.${g.action}`) ? add.slice(0, -g.action.length - 1) : null;
      return !!item && byPath.get(item)?.component === g.component && item.split(".").length === g.items[0].split(".").length;
    });
    if (home) {
      home.items.push(add.slice(0, -home.action.length - 1));
      home.adds.push(add);
    }
  }
  // Items that are components of the design's own (a dish row made for this screen): the add action is one of the item's actions, the same one in each.
  const custom = new Map<string, { items: string[]; nth: number }>();
  for (const c of all) {
    if (c.component !== "Custom") continue;
    const nth = subLayers(doc, c.node, "action").findIndex((id) => isAddLayer(doc, id));
    if (nth < 0) continue;
    const k = `${nth}|${c.path.split(".").length}`;
    custom.set(k, { items: [...(custom.get(k)?.items ?? []), c.path], nth });
  }
  const collections: Collection[] = [];
  for (const g of groupsByAction.values()) {
    if (g.items.length < 2) continue;
    const pattern = patternOf(g.items);
    if (pattern) collections.push({ pattern, component: g.component, items: g.items, action: g.action });
  }
  for (const g of custom.values()) {
    const pattern = g.items.length >= 2 ? patternOf(g.items) : null;
    // Items of one component are listed by it (a carousel of tiles with no + isn't); several kinds that all have the + (tiles and rows) by being the design's own.
    const kinds = new Set(g.items.map((p) => doc.nodes[byPath.get(p)!.node]?.meta.component ?? "Custom"));
    if (pattern) collections.push({ pattern, component: kinds.size === 1 ? [...kinds][0] : "Custom", items: g.items, action: "", nth: g.nth });
  }
  // No add actions: items of one kind that each show a price are picked from by tapping the item
  // itself (a dish row that opens its options) — unless the screen sums them up (a basket's lines).
  if (!collections.length && !all.some((c) => c.component === "SummaryRow")) {
    const tapped = pricedItems(doc, all);
    if (tapped) collections.push(tapped);
  }
  // In reading order: the one a person meets first leads.
  const order = new Map(all.map((c, i) => [c.path, i]));
  collections.sort((a, b) => (order.get(a.items[0]) ?? 0) - (order.get(b.items[0]) ?? 0));

  // Groups of options: rows with a radio (pick one) or checkbox (pick any) in the same container.
  const groups: OptionGroup[] = [];
  const rowsByParent = new Map<string, typeof all>();
  for (const c of all) {
    if (c.component !== "ListItem" || (c.props.trailing !== "radio" && c.props.trailing !== "checkbox")) continue;
    const parent = c.path.split(".").slice(0, -2).join(".");
    rowsByParent.set(parent, [...(rowsByParent.get(parent) ?? []), c]);
  }
  for (const [parent, rows] of rowsByParent) {
    const pattern = patternOf(rows.map((r) => r.path));
    if (!pattern || rows.length < 1) continue;
    const pick = rows.every((r) => r.props.trailing === "radio") ? "one" : "any";
    const title = String(byPath.get(parent)?.props.title ?? "");
    const prices = rows.map((r) => {
      const m = typeof r.props.trailingText === "string" ? findMoney(r.props.trailingText) : null;
      return m ? { amount: m.amount, diff: m.signed } : null;
    });
    groups.push({
      pattern,
      rows: rows.map((r) => r.path),
      pick,
      title,
      required: /required|choose|pick/i.test(title) || pick === "one",
      picked: pick === "one" ? (rows.find((r) => r.props.checked === true)?.path ?? null) : null,
      titles: rows.map((r) => String(r.props.title ?? "")),
      prices,
    });
  }

  const quantity = all.find((c) => c.component === "Stepper") ?? null;
  const lines = linesIn(doc, all, collections);
  const variant = (c: { props: Record<string, unknown> }) => String(c.props.variant ?? "primary");
  const buttons = all.filter((c) => c.component === "Button" && (variant(c) === "primary" || variant(c) === "danger"));
  const primary = buttons.find((b) => b.path.startsWith("footer.")) ?? buttons[buttons.length - 1] ?? null;
  const backs = all.filter((c) => c.component === "Button" && (variant(c) === "secondary" || variant(c) === "tertiary"));
  const secondary = backs.find((b) => b.path.startsWith("footer.")) ?? backs[0] ?? null;
  const texts = all.flatMap((c) => {
    const text = c.component === "Text" ? c.props.text : c.component === "SummaryRow" ? c.props.value : undefined;
    return typeof text === "string" ? [{ path: c.path, node: c.node, component: c.component, text }] : [];
  });
  const actions = all.filter((c) => c.component === "Button").map((c) => ({ path: c.path, node: c.node, component: c.component, label: String(c.props.label ?? ""), variant: variant(c) }));
  return {
    topBar: top,
    lines,
    optionRows,
    collections,
    groups,
    quantity,
    primary: primary ? { path: primary.path, node: primary.node, component: primary.component, label: String(primary.props.label ?? ""), money: !!findMoney(String(primary.props.label ?? "")) } : null,
    secondary: secondary ? { path: secondary.path, node: secondary.node, component: secondary.component, label: String(secondary.props.label ?? "") } : null,
    actions,
    texts,
    amounts: texts.filter((t) => findMoney(t.text)),
    sections,
    intro: all.find((c) => c.path === "body.0" && c.component === "Text") ?? null,
  };
}

const STRONG = /^(body-strong|headline|title|title-lg|label)$/;
const inside = (p: string, row: string) => p === row || p.startsWith(`${row}.`);

/** A screen's lines, when it shows some: the largest set of rows of one kind (see Lines). */
function linesIn(doc: Doc, all: (Found & { props: Record<string, unknown> })[], collections: Collection[]): Lines | null {
  const items = collections.flatMap((c) => c.items);
  const read = (c: Found & { props: Record<string, unknown> }) => {
    if (!c.path.startsWith("body.") || items.some((it) => inside(c.path, it) || inside(it, c.path))) return null;
    const own = all.filter((x) => x.path !== c.path && inside(x.path, c.path));
    if (own.some(isAdd)) return null;
    if (c.component === "ListItem") {
      const title = String(c.props.title ?? "");
      // Its amount as drawn: a trailing text shows with trailing "text".
      const money = [c.props.trailing === "text" ? c.props.trailingText : undefined, c.props.subtitle].some((x) => typeof x === "string" && findMoney(x));
      const sub = typeof c.props.subtitle === "string" && !findMoney(c.props.subtitle) ? c.props.subtitle : null;
      return title && money ? { title, note: sub, qty: null } : null;
    }
    const custom = c.component === "Custom";
    if (!custom && !(c.component === "Stack" && c.props.direction === "horizontal")) return null;
    // Something to add (a suggestion's +) isn't a line.
    if (custom && subLayers(doc, c.node, "action").some((id) => isAddLayer(doc, id))) return null;
    // Its copy: the components' inside it, or a custom one's own layers.
    const node = doc.nodes[c.node];
    const texts = custom
      ? collectTexts(doc, c.node).map((t) => ({ text: t.text, strong: STRONG.test(t.style) }))
      : own.filter((x) => x.component === "Text").map((x) => ({ text: String(x.props.text ?? ""), strong: STRONG.test(String(x.props.style ?? "body")) }));
    if (!node || !texts.some((t) => findMoney(t.text))) return null;
    const plain = texts.filter((t) => !findMoney(t.text) && !/^\d{1,3}$/.test(t.text.trim()));
    const title = (plain.find((t) => t.strong) ?? null)?.text;
    if (!title) return null;
    const note = plain.find((t) => t.text !== title)?.text ?? null;
    const qty = own.find((x) => x.component === "Stepper")?.path ?? null;
    return { title, note, qty };
  };
  const found = all.flatMap((c) => {
    const r = read(c);
    return r ? [{ c, ...r }] : [];
  });
  // The innermost: a card that holds a row isn't one.
  const rows = found.filter((f) => !found.some((g) => g !== f && inside(g.c.path, f.c.path)));
  if (!rows.length) return null;
  const kinds = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.c.component}|${r.c.path.split(".").length}|${r.qty ? "how many" : ""}`;
    kinds.set(k, [...(kinds.get(k) ?? []), r]);
  }
  // Lines say how many (a stepper): they lead over rows that don't (suggestions beside them); then the most.
  const best = [...kinds.values()].sort((a, b) => Number(!!b[0].qty) - Number(!!a[0].qty) || b.length - a.length)[0];
  const first = best[0];
  return { rows: best.map((r) => r.c.path), component: first.c.component, title: first.title, note: first.note, qty: first.qty };
}

/** The kinds of element an item a person taps can be. */
const ITEM_KINDS = new Set(["ListItem", "Custom", "Card", "Stack"]);

/** Items of one kind side by side that each show a price, none with a stepper: the largest set, as a collection tapped by item. */
function pricedItems(doc: Doc, all: (Found & { props: Record<string, unknown> })[]): Collection | null {
  const priced = all.filter((c) => {
    if (!c.path.startsWith("body.") || !ITEM_KINDS.has(c.component)) return false;
    if (c.component === "ListItem") return (c.props.trailing === "text" && typeof c.props.trailingText === "string" && !!findMoney(c.props.trailingText)) || (typeof c.props.subtitle === "string" && !!findMoney(c.props.subtitle));
    const own = all.filter((x) => x.path !== c.path && inside(x.path, c.path));
    if (own.some((x) => x.component === "Stepper" || (x.component === "ListItem" && (x.props.trailing === "radio" || x.props.trailing === "checkbox")))) return false;
    const texts = c.component === "Custom" ? collectTexts(doc, c.node).map((t) => t.text) : own.filter((x) => x.component === "Text").map((x) => String(x.props.text ?? ""));
    return texts.some((t) => findMoney(t));
  });
  // The innermost: a card that holds priced rows isn't an item.
  const items = priced.filter((c) => !priced.some((o) => o !== c && inside(o.path, c.path)));
  const kinds = new Map<string, typeof items>();
  for (const c of items) {
    const kind = c.component === "Custom" ? (doc.nodes[c.node]?.meta.component ?? "Custom") : c.component;
    const k = `${kind}|${c.path.split(".").length}`;
    kinds.set(k, [...(kinds.get(k) ?? []), c]);
  }
  const best = [...kinds.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
  const pattern = best ? patternOf(best.map((c) => c.path)) : null;
  if (!best || !pattern) return null;
  const component = best[0].component === "Custom" ? (doc.nodes[best[0].node]?.meta.component ?? "Custom") : best[0].component;
  return { pattern, component, items: best.map((c) => c.path), action: "" };
}

/** A layer's texts with their style, in reading order. */
function collectTexts(doc: Doc, id: string): { text: string; style: string }[] {
  const out: { text: string; style: string }[] = [];
  const walk = (x: string) => {
    for (const k of doc.nodes[x]?.children ?? []) {
      const n = doc.nodes[k];
      if (!n?.visible) continue;
      if (n.type === "text") out.push({ text: n.text.content, style: (n.text.typeToken ?? "").replace(/^type\./, "") });
      walk(k);
    }
  };
  walk(id);
  return out;
}

export type { SceneNode };
