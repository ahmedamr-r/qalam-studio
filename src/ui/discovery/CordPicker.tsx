import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { boardLane } from "@/engine/ost-tools";
import { cardOf } from "@/discovery/ops";
import { partOf } from "@/discovery/origin";
import { rankQuotes } from "@/discovery/near";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { attachQuotes } from "./drop";
import { QuoteList, toggled } from "./QuoteList";
import { useSources } from "./sources";
import { useDiscovery } from "./store";

/*
 * A cord drawn from a lane source's port onto a card, in place of the right panel: which of the
 * source's words the card rests on, nearest the card first (src/discovery/near.ts). Attaching them is
 * one undo step, and the cord is the wire the lane then draws; nothing picked, no cord.
 */

const ICON = { size: 13, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function CordPicker() {
  const pick = useDiscovery((s) => s.cordPick);
  const doc = useStudio((s) => s.doc);
  const list = useSources((s) => s.list);
  const visiting = useSources((s) => s.visiting);
  const item = pick ? boardLane().items.find((i) => i.key === pick.key) : undefined;
  const card = pick ? cardOf(doc, pick.card) : null;
  const source = item ? (list.find((s) => s.id === item.sourceId) ?? visiting.find((s) => s.id === item.sourceId)) : undefined;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const close = () => useDiscovery.setState({ cordPick: null });
  // The card or its source went away meanwhile: nothing to pick.
  useEffect(() => {
    if (pick && (!item || !card || !source)) close();
  }, [pick, item, card, source]);
  const quotes = useMemo(() => {
    if (!pick || !card || !source || !item) return [];
    // A setup's part offers only its own words.
    const mine = item.part ? source.quotes.filter((q) => partOf([item.part!], q) === 0) : source.quotes;
    const parentId = doc.nodes[pick.card]?.parentId;
    const parent = parentId ? cardOf(doc, parentId)?.title ?? "" : "";
    const on = new Set(card.evidence.flatMap((e) => (e.piece?.startsWith("hub:quote:") ? [e.piece.slice(10)] : [])));
    return rankQuotes(mine, { id: pick.card, title: card.title, description: card.description }, parent, on);
  }, [pick, card, source, item, doc]);
  if (!pick || !item || !card || !source) return null;
  const n = chosen.size;
  return (
    <aside aria-label="Pick the quotes the card rests on" className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line-subtle bg-panel">
      <div className={clsx(r.panelHeader, "justify-between pl-[12px]")}>
        <span className="truncate text-caption font-semibold text-fg">Rest it on {item.title}</span>
        <IconBtn size="sm" label="Close" onClick={close}>
          <X {...ICON} />
        </IconBtn>
      </div>
      <p className="px-[12px] pt-[8px] text-caption text-fg-muted">
        Pick the words that back <span className="text-fg">“{card.title || "Untitled"}”</span>. Nearest first.
      </p>
      {quotes.length ? (
        <QuoteList quotes={quotes.map((q) => ({ id: q.id, text: q.text, ...(q.speaker ? { note: q.speaker } : {}) }))} chosen={chosen} onToggle={(id, on) => setChosen((c) => toggled(c, id, on))} />
      ) : (
        <p className="flex-1 px-[12px] py-[12px] text-caption text-fg-subtle">Every quote it has is on this card already.</p>
      )}
      <div className="flex items-center gap-[6px] border-t border-line-subtle px-[12px] py-[10px]">
        <Button
          size="sm"
          disabled={!n}
          onClick={() => {
            if (attachQuotes(pick.card, source.id, [...chosen])) studio().select([pick.card]);
            close();
          }}
        >
          {n ? `Attach ${n === 1 ? "1 quote" : `${n} quotes`}` : "Pick the words"}
        </Button>
        <Button size="sm" variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </aside>
  );
}
