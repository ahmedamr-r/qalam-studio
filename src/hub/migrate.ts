import type { Doc } from "@/doc/schema";
import { fromSource, quotePiece, type SourceRecord } from "@/discovery/sources";
import type { OstCard } from "@/discovery/types";

/**
 * Bringing boards made before sources were shared up to date. A card's quote used to point at its
 * source by where the words sat; now it also names the quote itself (OstEvidence.piece), which
 * still finds the words after the source's text changes. Pure: the board applies it when its
 * sources have loaded.
 */

type Card = { meta?: { ost?: OstCard } };

/** The evidence on a board that should name its quote, and the quote it is (by evidence id). */
export function evidenceToLink(doc: Doc, sources: Pick<SourceRecord, "id" | "quotes">[]): Map<string, string> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = new Map<string, string>();
  for (const node of Object.values(doc.nodes) as unknown as Card[]) {
    for (const e of node.meta?.ost?.evidence ?? []) {
      if (e.piece || !fromSource(e) || !e.sourceId || !e.span) continue;
      const q = byId.get(e.sourceId)?.quotes.find((x) => x.span[0] === e.span![0] && x.span[1] === e.span![1]);
      if (q) out.set(e.id, quotePiece(q.id));
    }
  }
  return out;
}

/** Name the quote on each piece of evidence found by evidenceToLink (in place, inside a mutate). */
export function linkEvidenceIn(d: Doc, links: Map<string, string>) {
  for (const node of Object.values(d.nodes) as unknown as Card[]) {
    for (const e of node.meta?.ost?.evidence ?? []) {
      const piece = links.get(e.id);
      if (piece) e.piece = piece;
    }
  }
}
