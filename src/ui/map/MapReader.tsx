import type { Lane, LaneItem } from "@/discovery/lane";
import type { SourceRecord } from "@/discovery/sources";
import type { OstKind } from "@/discovery/types";
import type { Doc } from "@/doc/schema";
import { Reader, type Back } from "../sources/Reader";

/*
 * A source read in place of the map's panel (src/ui/sources/Reader.tsx), as a board's lane reads one: what it
 * backs on the map as chips, its words (or its own part of a brain dump) with each card's quotes
 * marked, and a pressed chip picks its card on the map.
 */

const KIND: Record<OstKind, Back["kind"]> = { outcome: "goal", opportunity: "problem", solution: "solution", test: "test" };

export function MapReader({ item, lane, doc, sources, onClose, onPick }: { item: LaneItem; lane: Lane; doc: Doc; sources: readonly SourceRecord[]; onClose: () => void; onPick: (id: string) => void }) {
  const source = sources.find((s) => s.id === item.sourceId);
  if (!source) return null;
  // A source backs the same card once, however many of its quotes it rests on.
  const backs = lane.edges.flatMap((e): Back[] => {
    const card = e.from === item.key ? doc.nodes[e.to]?.meta.ost : undefined;
    return card ? [{ id: e.to, kind: KIND[card.kind], title: card.title || "Untitled", quotes: e.quotes }] : [];
  });
  return (
    <Reader
      key={item.key}
      title={item.title}
      doc={item.part ?? { from: item.mark, title: item.title, ...(source.origin ? { origin: source.origin } : {}) }}
      line={item.line}
      text={source.text}
      quotes={source.quotes}
      pages={item.part ? undefined : source.pages}
      blocks={source.blocks}
      range={item.part?.span}
      backs={backs}
      onClose={onClose}
      onPick={onPick}
      close="close"
      className="min-h-0 flex-1"
    />
  );
}
