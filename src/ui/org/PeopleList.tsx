import { useMemo } from "react";
import { UserRound } from "lucide-react";
import type { SourceRecord } from "@/discovery/sources";
import { voicesByQuote, type Person } from "@/hub/people";
import { ago } from "../time";
import { editPerson } from "./PersonEditor";

/**
 * The people the organization hears from: who they are, the segments they're in, how much of what
 * customers said is theirs, and when they were last heard. Sources say who is in them (a source's
 * Who said it); a person opens to be edited.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function PeopleList({ people, sources, product }: { people: Person[]; sources: SourceRecord[]; product: string | null }) {
  const heard = useMemo(() => {
    const out = new Map<string, { quotes: number; sources: Set<string>; last: number }>();
    for (const v of voicesByQuote(sources, people).values()) {
      if (!v.person) continue;
      const h = out.get(v.person.id) ?? { quotes: 0, sources: new Set<string>(), last: 0 };
      h.quotes++;
      h.sources.add(v.source);
      h.last = Math.max(h.last, v.at);
      out.set(v.person.id, h);
    }
    return out;
  }, [people, sources]);
  if (!people.length)
    return <p className="text-body text-fg-muted">No one yet. Open a source on a board and say who said it, or add a person here: Qalam then counts people behind each need, not quotes, and tells segments apart.</p>;
  const sorted = [...people].sort((a, b) => (heard.get(b.id)?.last ?? 0) - (heard.get(a.id)?.last ?? 0) || a.name.localeCompare(b.name));
  return (
    <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {sorted.map((p) => {
        const h = heard.get(p.id);
        return (
          <li key={p.id}>
            <button type="button" onClick={() => void editPerson(p, { product })} className="q-item flex w-full items-start gap-[10px] px-[12px] py-[10px] text-left hover:bg-hover">
              <span className="mt-[2px] text-fg-subtle">
                <UserRound {...ICON} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-body text-fg">{p.name}</span>
                <span className="text-caption text-fg-muted">{[p.segments.join(", ") || "No segment yet", p.role].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right text-caption text-fg-subtle">{h ? `${plural(h.quotes, "quote")} in ${plural(h.sources.size, "source")} · ${ago(h.last)}` : "Nothing of theirs yet"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
