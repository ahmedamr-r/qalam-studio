import { useEffect } from "react";
import { studio, useStudio } from "@/doc/store";
import { boardLane } from "@/engine/ost-tools";
import type { OstKind } from "@/discovery/types";
import { Reader, type Back } from "../sources/Reader";
import { glideToLayer, onCanvasReady } from "./canvas";
import { useSources } from "./sources";
import { useDiscovery } from "./store";

/*
 * A source from the board's sources lane, read over the canvas (src/ui/sources/Reader.tsx): what
 * it backs on this board as chips, its words, or its own part of a brain dump, with each card's
 * quotes marked, and a pressed chip takes you to its card.
 */

const KIND: Record<OstKind, Back["kind"]> = { outcome: "goal", opportunity: "problem", solution: "solution", test: "test" };

export default function LaneReader() {
  const key = useDiscovery((s) => s.reading);
  const doc = useStudio((s) => s.doc);
  const list = useSources((s) => s.list);
  const visiting = useSources((s) => s.visiting);
  const lane = key ? boardLane() : null;
  const item = lane?.items.find((i) => i.key === key);
  // Its cards moved off this source (or the lane was switched off): nothing to read.
  useEffect(() => {
    if (key && !item) useDiscovery.setState({ reading: null });
  }, [key, item]);
  const source = item ? (list.find((s) => s.id === item.sourceId) ?? visiting.find((s) => s.id === item.sourceId)) : undefined;
  if (!item || !source || !lane) return null;
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
      range={item.part?.span}
      backs={backs}
      onClose={() => useDiscovery.setState({ reading: null })}
      onPick={(id) => {
        studio().select([id]);
        onCanvasReady((c) => glideToLayer(c, id));
      }}
      close="close"
      className="pointer-events-auto absolute top-[12px] right-[12px] bottom-[84px] z-20 w-[min(420px,calc(100%-24px))] overflow-hidden rounded-xl shadow-floating"
    />
  );
}
