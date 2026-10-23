/**
 * The Components page (pure): every component of a design system drawn on the canvas, the way a
 * Figma team keeps a library page. One section per group (the system's own components first,
 * then the catalog's categories in the Assets panel's order); in each, a card per component with
 * its name, what it's for and a cell per option of its main property (variant, tone or size, as
 * the component library shows them), each built by the same builders as the screens.
 *
 * Everything is drawn in the system's own tokens, so the page is the system documenting itself
 * and follows every token edit. Ids are fixed (`cmp:…`), so a rebuild keeps the selection, and
 * every section, card and cell carries `meta.showcase`. Instances carry no `meta.inst`: these
 * drawings are never counted, refreshed or saved as instances (see doc/pages.ts).
 */
import type { SceneNode, ShowcaseMeta } from "@/doc/schema";
import { layoutToNodes } from "@/engine/layout";
import { buildInstance, type BuildCtx, type Inst, type LBox } from "./builders";
import { CATALOG, type ComponentSpec } from "./components";
import { CUSTOM, componentLookup } from "./custom";
import type { Pattern } from "./docs";
import type { TokenSet } from "./resolve";

/** Group labels in the Assets panel's order. */
export const SHOWCASE_GROUPS: { category: ComponentSpec["category"]; label: string }[] = [
  { category: "navigation", label: "Navigation" },
  { category: "input", label: "Inputs & actions" },
  { category: "content", label: "Content" },
  { category: "feedback", label: "Feedback" },
  { category: "layout", label: "Layout" },
  { category: "commerce", label: "Commerce" },
];

/** Components are drawn at a phone screen's content width, as in the component library. */
export const CELL_W = 358;
const CELL_GAP = 24;
const CARD_PAD = 24;
const MAX_COLS = 3;
const CARD_GAP = 32;
const SECTION_PAD = 40;
/** Two widest cards side by side. */
const SECTION_INNER = 2 * (MAX_COLS * CELL_W + (MAX_COLS - 1) * CELL_GAP + 2 * CARD_PAD) + CARD_GAP;
const SECTION_GAP = 160;

export interface ShowcaseSystem {
  id: string;
  name: string;
  updatedAt: number;
  patterns: Pattern[];
}

export interface Showcase {
  /** Root first for each section, in drawing order (parents before children). */
  nodes: SceneNode[];
  roots: string[];
  sig: string;
}

export const showcaseSig = (ds: Pick<ShowcaseSystem, "id" | "updatedAt">) => `${ds.id}@${ds.updatedAt}`;

/** The property a component's cells show (the component library's rule), with its options. */
export function variantAxis(spec: ComponentSpec): { prop: string; values: string[] } | null {
  const prop = ["variant", "tone", "size"].find((k) => spec.props[k]?.type === "enum");
  const p = prop ? spec.props[prop] : undefined;
  return prop && p?.type === "enum" && p.values.length ? { prop, values: [...p.values] } : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
export const sectionId = (group: string) => `cmp:section:${slug(group)}`;
export const cardId = (component: string, own = false) => `cmp:card:${own ? "own:" : ""}${component}`;
export const cellId = (component: string, value: string | undefined, own = false) => `cmp:cell:${own ? "own:" : ""}${component}:${value ?? "default"}`;

interface Mark {
  id: string;
  meta: ShowcaseMeta;
  name?: string;
}

/** A cell, card or section as an LBox, with what to stamp on its node once laid out. */
type Marked = { box: LBox; marks: Map<LBox, Mark> };

const text = (content: string, type: string, color: string, extra: Partial<LBox> & { maxLines?: number } = {}): LBox => {
  const { maxLines, ...rest } = extra;
  return { kind: "text", name: content.slice(0, 32) || "Text", text: { content, type: `type.${type}`, color, maxLines }, ...rest };
};

function cell(inst: Inst, ctx: BuildCtx, caption: string | null, mark: Mark, marks: Map<LBox, Mark>): LBox | null {
  let box: LBox;
  try {
    box = buildInstance(inst, ctx);
  } catch {
    // A combination its builder can't draw: the card shows the others.
    return null;
  }
  const out: LBox = {
    kind: "frame",
    name: caption ?? "Default",
    direction: "column",
    gap: 8,
    width: CELL_W,
    align: "stretch",
    children: [...(caption ? [text(caption, "caption", "text.tertiary")] : []), box],
  };
  marks.set(out, mark);
  return out;
}

function card(entry: { name: string; description: string; own: boolean; spec?: ComponentSpec }, ctx: BuildCtx, marks: Map<LBox, Mark>): LBox {
  const { name, own, spec } = entry;
  const cells: LBox[] = [];
  const axis = spec ? variantAxis(spec) : null;
  if (spec && axis) {
    for (const v of axis.values) {
      const c = cell({ component: spec.name, props: { ...structuredClone(spec.example), [axis.prop]: v }, children: spec.exampleChildren }, ctx, v, { id: cellId(name, v), meta: { kind: "cell", component: name, prop: axis.prop, value: v } }, marks);
      if (c) cells.push(c);
    }
  } else {
    const inst: Inst = spec ? { component: spec.name, props: structuredClone(spec.example), children: spec.exampleChildren } : { component: CUSTOM, props: { name } };
    const c = cell(inst, ctx, null, { id: cellId(name, undefined, own), meta: { kind: "cell", component: name, ...(own ? { own } : {}) } }, marks);
    if (c) cells.push(c);
  }
  const cols = Math.max(1, Math.min(MAX_COLS, cells.length));
  const inner = cols * CELL_W + (cols - 1) * CELL_GAP;
  const children: LBox[] = [
    {
      kind: "frame",
      name: "Header",
      direction: "column",
      gap: 4,
      width: "fill",
      children: [text(name, "title", "text.primary"), text(entry.description, "caption", "text.secondary", { maxLines: 2, width: "fill" })],
    },
    cells.length
      ? { kind: "frame", name: "Variants", direction: "row", wrap: true, gap: CELL_GAP, width: inner, align: "start", children: cells }
      : text("Can't be drawn with its example properties", "caption", "text.tertiary"),
  ];
  const out: LBox = {
    kind: "frame",
    name,
    direction: "column",
    gap: 20,
    padding: [CARD_PAD, CARD_PAD, CARD_PAD, CARD_PAD],
    width: inner + 2 * CARD_PAD,
    fill: "bg.surface",
    stroke: { token: "border.subtle", width: 1 },
    radius: "radius.lg",
    children,
  };
  marks.set(out, { id: cardId(name, own), meta: { kind: "card", component: name, ...(own ? { own } : {}) } });
  return out;
}

function section(label: string, cards: LBox[], marks: Map<LBox, Mark>, sig: string): LBox {
  const out: LBox = {
    kind: "frame",
    name: label,
    direction: "column",
    gap: 24,
    padding: [SECTION_PAD, SECTION_PAD, SECTION_PAD, SECTION_PAD],
    width: SECTION_INNER + 2 * SECTION_PAD,
    fill: "bg.canvas",
    radius: "radius.lg",
    children: [
      {
        kind: "frame",
        name: "Title",
        direction: "column",
        gap: 4,
        width: "fill",
        children: [text(label, "display", "text.primary"), text(`${cards.length} ${cards.length === 1 ? "component" : "components"}`, "body", "text.secondary")],
      },
      { kind: "frame", name: "Components", direction: "row", wrap: true, gap: CARD_GAP, width: "fill", align: "start", children: cards },
    ],
  };
  marks.set(out, { id: sectionId(label), meta: { kind: "section", group: label, sig } });
  return out;
}

/** Lay out one section and give its marked nodes their fixed ids and `meta.showcase`. */
function place({ box, marks }: Marked, ctx: BuildCtx, at: { x: number; y: number }): SceneNode[] {
  const nodes = layoutToNodes(box, ctx, at, "user");
  // layoutToNodes emits nodes in the boxes' pre-order: walk the boxes the same way to pair them.
  const order: LBox[] = [];
  const walk = (b: LBox) => {
    order.push(b);
    b.children?.forEach(walk);
  };
  walk(box);
  const rename = new Map<string, string>();
  order.forEach((b, i) => {
    const m = marks.get(b);
    const n = nodes[i];
    if (!m || !n) return;
    rename.set(n.id, m.id);
    n.meta = { ...n.meta, showcase: m.meta };
    delete n.meta.flags;
  });
  const id = (x: string) => rename.get(x) ?? x;
  for (const n of nodes) {
    n.id = id(n.id);
    n.parentId = n.parentId ? id(n.parentId) : null;
    n.children = n.children.map(id);
    // Lint marks don't belong on documentation.
    delete n.meta.flags;
  }
  return nodes;
}

/**
 * Draw a system's components page. `only` limits the catalog (tests). Sections are stacked
 * top to bottom from the origin.
 */
export function buildShowcase(ds: ShowcaseSystem, ts: TokenSet, opts: { only?: string[] } = {}): Showcase {
  const sig = showcaseSig(ds);
  const ctx: BuildCtx = { dir: "ltr", lang: "en", ts, components: componentLookup(ds.patterns, undefined), surface: "bg.surface" };
  const groups: Marked[] = [];
  const catalog = opts.only ? CATALOG.filter((c) => opts.only!.includes(c.name)) : CATALOG;
  if (ds.patterns.length && !opts.only) {
    const marks = new Map<LBox, Mark>();
    const cards = ds.patterns.map((p) => card({ name: p.name, description: p.purpose, own: true }, ctx, marks));
    groups.push({ box: section(`${ds.name} components`, cards, marks, sig), marks });
  }
  for (const g of SHOWCASE_GROUPS) {
    const specs = catalog.filter((c) => c.category === g.category);
    if (!specs.length) continue;
    const marks = new Map<LBox, Mark>();
    const cards = specs.map((spec) => card({ name: spec.name, description: spec.description, own: false, spec }, ctx, marks));
    groups.push({ box: section(g.label, cards, marks, sig), marks });
  }
  const nodes: SceneNode[] = [];
  const roots: string[] = [];
  let y = 0;
  for (const g of groups) {
    const placed = place(g, ctx, { x: 0, y });
    roots.push(placed[0].id);
    nodes.push(...placed);
    y += placed[0].h + SECTION_GAP;
  }
  return { nodes, roots, sig };
}
