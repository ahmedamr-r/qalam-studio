import type { EdgeKind, HubPiece, PieceType } from "./pieces";

/**
 * The organization's knowledge as a graph (pure): its pieces and the links that hold now, for one
 * product (with what's the whole organization's) or for all of it. The Knowledge hub draws it;
 * search walks the same links (server/index/search.ts).
 */

export interface OrgGraphNode {
  ref: string;
  type: PieceType;
  sub?: string;
  /** Short, for the graph. */
  label: string;
  text: string;
  product: string | null;
  board?: string;
  at: number;
}

export interface OrgGraph {
  nodes: OrgGraphNode[];
  edges: { from: string; to: string; kind: EdgeKind }[];
}

const clip = (t: string, n = 56) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/** What the graph shows a piece as: a card by its title, words by their start (and who said them). */
export function labelOf(p: Pick<HubPiece, "type" | "text" | "title" | "speaker">): string {
  if (p.type === "card" && p.title) return clip(p.title);
  if ((p.type === "quote" || p.type === "evidence") && p.speaker) return `${p.speaker}: “${clip(p.text, 44)}”`;
  return clip(p.text);
}

type Piece = Pick<HubPiece, "ref" | "type" | "text" | "product" | "at"> & { sub?: string | null; title?: string | null; speaker?: string | null; board?: string | null };

/** `product` set: that product's pieces and the whole organization's (null: only the organization's). */
export function orgGraph(pieces: Piece[], links: { from: string; to: string; kind: string }[], opts: { product?: string | null } = {}): OrgGraph {
  const keep = (p: Piece) => opts.product === undefined || p.product === null || p.product === opts.product;
  const nodes: OrgGraphNode[] = [];
  const refs = new Set<string>();
  for (const p of pieces) {
    if (!keep(p)) continue;
    refs.add(p.ref);
    nodes.push({
      ref: p.ref,
      type: p.type,
      ...(p.sub ? { sub: p.sub } : {}),
      label: labelOf({ type: p.type, text: p.text, title: p.title ?? undefined, speaker: p.speaker ?? undefined }),
      text: p.text,
      product: p.product,
      ...(p.board ? { board: p.board } : {}),
      at: p.at,
    });
  }
  const seen = new Set<string>();
  const edges: OrgGraph["edges"] = [];
  for (const l of links) {
    const key = `${l.from}\u0000${l.to}\u0000${l.kind}`;
    if (!refs.has(l.from) || !refs.has(l.to) || seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: l.from, to: l.to, kind: l.kind as EdgeKind });
  }
  return { nodes, edges };
}
