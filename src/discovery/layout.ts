/*
 * The tidy tree (pure): where every card of a tree goes, given each card's size. Each subtree is
 * laid out on its own, then its siblings are packed as close as their boxes allow (a subtree only
 * clears the cards it would actually touch, depth band by depth band, not its whole width), and a
 * parent is centred over its first and last child. Cards of different heights don't share rows: a
 * child sits a fixed gap below its own parent. Left-to-right is the same tree turned on its side.
 */

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
  /** Laid out in order; a folded branch is passed with none. */
  kids: LayoutNode[];
}

export type Orientation = "tb" | "lr";

export interface LayoutOptions {
  orientation: Orientation;
  /** Between two cards with nothing under them. */
  siblingGap?: number;
  /** Between two subtrees when either holds more cards. */
  branchGap?: number;
  /** From a card to its children. */
  levelGap?: number;
}

export const GAPS: Record<Orientation, Required<Omit<LayoutOptions, "orientation">>> = {
  tb: { siblingGap: 24, branchGap: 40, levelGap: 56 },
  lr: { siblingGap: 16, branchGap: 28, levelGap: 72 },
};

/** One card's box in a subtree's frame: breadth (across the levels) and depth (down the levels). */
interface Band {
  /** Depth range. */
  d0: number;
  d1: number;
  /** Breadth range. */
  lo: number;
  hi: number;
}

interface Placed {
  /** Every card's box, relative to the subtree root's breadth centre and depth start. */
  bands: Band[];
  /** Each card's centre (breadth) and start (depth), same frame. */
  at: Map<string, { c: number; s: number }>;
}

/** Top-left of every card, relative to the root card's top-left (the root is at 0,0). */
export function layoutTree(root: LayoutNode, opts: LayoutOptions): Map<string, { x: number; y: number }> {
  const tb = opts.orientation === "tb";
  const gaps = { ...GAPS[opts.orientation], ...stripUndefined(opts) };
  const breadth = (n: LayoutNode) => (tb ? n.w : n.h);
  const depth = (n: LayoutNode) => (tb ? n.h : n.w);

  const place = (n: LayoutNode): Placed => {
    const b = breadth(n);
    const d = depth(n);
    const self: Band = { d0: 0, d1: d, lo: -b / 2, hi: b / 2 };
    if (!n.kids.length) return { bands: [self], at: new Map([[n.id, { c: 0, s: 0 }]]) };
    const start = d + gaps.levelGap;
    const subs = n.kids.map(place);
    // Pack the children left to right: each as close to the ones before as their cards allow.
    const offsets: number[] = [];
    const packed: Band[] = [];
    subs.forEach((sub, i) => {
      if (i === 0) offsets.push(0);
      else {
        const busy = n.kids[i - 1].kids.length > 0 || n.kids[i].kids.length > 0;
        const gap = busy ? gaps.branchGap : gaps.siblingGap;
        let off = -Infinity;
        for (const a of packed) for (const c of sub.bands) if (a.d0 < c.d1 && c.d0 < a.d1) off = Math.max(off, a.hi + gap - c.lo);
        // Nothing in the way (a shallow subtree beside a deep one): still keep the siblings in order.
        offsets.push(Number.isFinite(off) ? off : offsets[i - 1] + gap);
      }
      for (const c of sub.bands) packed.push({ d0: c.d0, d1: c.d1, lo: c.lo + offsets[i], hi: c.hi + offsets[i] });
    });
    // The parent sits centred over its first and last child.
    const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
    const at = new Map<string, { c: number; s: number }>([[n.id, { c: 0, s: 0 }]]);
    // The connectors' bus between the parent and its children is kept clear too, so a taller
    // neighbour never sits across the lines.
    const bus: Band = { d0: d, d1: start, lo: offsets[0] - mid, hi: offsets[offsets.length - 1] - mid };
    const bands: Band[] = [self, bus];
    subs.forEach((sub, i) => {
      const shift = offsets[i] - mid;
      for (const [id, p] of sub.at) at.set(id, { c: p.c + shift, s: p.s + start });
      for (const c of sub.bands) bands.push({ d0: c.d0 + start, d1: c.d1 + start, lo: c.lo + shift, hi: c.hi + shift });
    });
    return { bands, at };
  };

  const sizes = new Map<string, LayoutNode>();
  const index = (n: LayoutNode) => {
    sizes.set(n.id, n);
    n.kids.forEach(index);
  };
  index(root);
  const { at } = place(root);
  const rootB = breadth(root);
  const out = new Map<string, { x: number; y: number }>();
  for (const [id, p] of at) {
    const n = sizes.get(id)!;
    // Centre (breadth) → top-left, relative to the root's top-left.
    const across = p.c - breadth(n) / 2 + rootB / 2;
    out.set(id, tb ? { x: round(across), y: round(p.s) } : { x: round(p.s), y: round(across) });
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

function stripUndefined(o: LayoutOptions): Partial<LayoutOptions> {
  const out: Partial<LayoutOptions> = {};
  if (o.siblingGap !== undefined) out.siblingGap = o.siblingGap;
  if (o.branchGap !== undefined) out.branchGap = o.branchGap;
  if (o.levelGap !== undefined) out.levelGap = o.levelGap;
  return out;
}
