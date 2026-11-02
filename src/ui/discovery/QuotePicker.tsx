import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { attachQuoteRefs } from "./drop";
import { QuoteList, toggled } from "./QuoteList";
import { useDiscovery, type FoundQuote } from "./store";

/*
 * What the organization has that could back a card, in place of the right panel (its next steps'
 * "Find what backs it", ./backing.ts): nearest first, each saying whose words they are. The ones
 * ticked attach in one undo step, and the lane draws their wires.
 */

const ICON = { size: 13, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const WHOSE: Record<FoundQuote["whose"], string> = { customers: "Customers", online: "People online", yours: "Your words", measured: "Measured", studied: "Studied", read: "Read elsewhere" };
const keyOf = (q: Pick<FoundQuote, "sourceId" | "quoteId">) => `${q.sourceId}:${q.quoteId}`;

export default function QuotePicker() {
  const pick = useDiscovery((s) => s.quotePick);
  const card = useStudio((s) => (pick ? cardOf(s.doc, pick.card) : null));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const close = () => useDiscovery.setState({ quotePick: null });
  useEffect(() => setChosen(new Set()), [pick]);
  // The card went away meanwhile: nothing to pick for.
  useEffect(() => {
    if (pick && !card) close();
  }, [pick, card]);
  if (!pick || !card) return null;
  const n = chosen.size;
  return (
    <aside aria-label="Pick what backs the card" className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line-subtle bg-panel">
      <div className={clsx(r.panelHeader, "justify-between pl-[12px]")}>
        <span className="truncate text-caption font-semibold text-fg">What backs it, in your organization</span>
        <IconBtn size="sm" label="Close" onClick={close}>
          <X {...ICON} />
        </IconBtn>
      </div>
      <p className="px-[12px] pt-[8px] text-caption text-fg-muted">
        Pick the words that back <span className="text-fg">“{card.title || "Untitled"}”</span>. Nearest first.
      </p>
      <QuoteList quotes={pick.quotes.map((q) => ({ id: keyOf(q), text: q.text, note: [WHOSE[q.whose], q.speaker, q.from].filter(Boolean).join(" · ") }))} chosen={chosen} onToggle={(id, on) => setChosen((c) => toggled(c, id, on))} />
      <div className="flex items-center gap-[6px] border-t border-line-subtle px-[12px] py-[10px]">
        <Button
          size="sm"
          disabled={!n}
          onClick={() => {
            if (attachQuoteRefs(pick.card, pick.quotes.filter((q) => chosen.has(keyOf(q))))) studio().select([pick.card]);
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
