import type { CallContext } from "@/ai/discovery";
import { entry, mergeManifest, type Manifest } from "@/knowledge/trace";
import { orgFetch } from "./client";

/**
 * What the organization already knows that bears on a call, packed by its search index into a
 * budget of tokens (server/index/search.ts packFor). The call sends `context`; `pieces` say what
 * each id is (a quote's source, to attach it); the manifest checks the ids the answer cites.
 */

export interface PackedPiece {
  k: string;
  ref: string;
  whole: boolean;
  type: string;
  sub: string | null;
  text: string;
  title: string | null;
  product: string | null;
  source: string | null;
  speaker: string | null;
  board: string | null;
  card: string | null;
  stage: string | null;
}

export interface OrgContext {
  context: CallContext;
  pieces: PackedPiece[];
  manifest: Manifest;
}

export interface PackRequest {
  query: string;
  /** The card in hand (its ref): what's linked to it comes first. */
  anchor?: string;
  /** The product in hand (none: the whole organization's knowledge, ranked as one). */
  product?: string | null;
  budget: number;
  wholeTop?: number;
  /** Only pieces of these types. */
  types?: string[];
  /** What the call already carries: left out. */
  exclude?: string[];
}

/** Null when there's nothing to add, or no index here (Node without full-text search): the call goes without. */
export async function orgContext(r: PackRequest): Promise<OrgContext | null> {
  try {
    const res = await orgFetch("/pack", { method: "POST", json: { ...r, query: r.query.slice(0, 4000) } });
    const p = (await res.json()) as { block: string; items: PackedPiece[] };
    if (!p.items?.length) return null;
    return {
      context: { block: p.block, ids: p.items.map((i) => i.k), quotes: p.items.filter((i) => i.type === "quote").map((i) => i.k) },
      pieces: p.items,
      manifest: mergeManifest(p.items.map((i) => entry(i.k, i.ref, i.text))),
    };
  } catch {
    return null;
  }
}

/** A quote piece's quote id (hub:quote:<id>). */
export const quoteIdOf = (ref: string) => (ref.startsWith("hub:quote:") ? ref.slice("hub:quote:".length) : null);
