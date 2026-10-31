import { Checkbox } from "../controls";

/*
 * Quotes to pick for a card, each with a box to tick and a line on who said it or where it's from:
 * a cord's (one source's words, ./CordPicker.tsx) and the organization's (./QuotePicker.tsx).
 */

export interface PickQuote {
  id: string;
  text: string;
  note?: string;
}

export function QuoteList({ quotes, chosen, onToggle }: { quotes: PickQuote[]; chosen: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-[8px] py-[8px]">
      {quotes.map((q) => (
        <li key={q.id} className="rounded-md px-[4px] py-[2px] hover:bg-hover">
          <Checkbox
            checked={chosen.has(q.id)}
            onChange={(on) => onToggle(q.id, on)}
            label={
              <span className="flex min-w-0 flex-col py-[2px]">
                <span className="text-body leading-[20px] text-fg" dir="auto">
                  {q.text}
                </span>
                {q.note && <span className="text-micro text-fg-subtle">{q.note}</span>}
              </span>
            }
          />
        </li>
      ))}
    </ul>
  );
}

/** A set of picked ids with one toggled. */
export const toggled = (c: ReadonlySet<string>, id: string, on: boolean) => {
  const next = new Set(c);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};
