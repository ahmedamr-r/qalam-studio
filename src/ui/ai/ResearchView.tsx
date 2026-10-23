import { useState } from "react";
import { ChevronRight, Globe, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { hostOf, type ResearchInfo } from "@/ai/research-shared";
import { r } from "../recipes";

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** One line of the notes with its markdown links as real links (and **bold** unwrapped). */
function Inline({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    out.push(text.slice(at, m.index).replace(/\*\*/g, ""));
    out.push(
      <a key={m.index} href={m[2]} target="_blank" rel="noreferrer" className={r.link} title={m[2]}>
        {m[1]}
      </a>,
    );
    at = m.index + m[0].length;
  }
  out.push(text.slice(at).replace(/\*\*/g, ""));
  return <>{out}</>;
}

export function Notes({ notes }: { notes: string }) {
  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <ul className="flex flex-col gap-[4px]">
      {lines.map((l, i) => {
        const bullet = /^[-*•]\s+/.test(l);
        return (
          <li key={i} className={clsx("text-caption text-fg-muted", bullet && "relative pl-[12px]")} dir="auto">
            {bullet && <span className="absolute left-0 text-fg-faint">•</span>}
            <Inline text={bullet ? l.replace(/^[-*•]\s+/, "") : l.replace(/^#+\s*/, "")} />
          </li>
        );
      })}
    </ul>
  );
}

/** What the research step looked up for a turn, with its notes and sources. */
export function ResearchView({ r }: { r: ResearchInfo }) {
  const [open, setOpen] = useState(false);
  if (r.error)
    return (
      <div className="flex items-start gap-[6px] text-micro text-fg-subtle">
        <TriangleAlert size={12} absoluteStrokeWidth strokeWidth={1.25} className="mt-px shrink-0 text-warning" />
        <span>Couldn't look things up ({r.error.slice(0, 160)}), so Qalam AI answered without it.</span>
      </div>
    );
  if (!r.notes) {
    const failed = r.steps.filter((s) => / failed: |isn't connected/.test(s));
    return (
      <div className="flex flex-col gap-[2px] text-micro text-fg-subtle">
        <div className="flex items-center gap-[6px]">
          <Globe size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0" /> {!r.steps.length ? "Nothing needed looking up." : failed.length ? "Couldn't look things up, so Qalam AI answered without it." : "Looked things up, but found nothing that changes the answer."}
        </div>
        {[...new Set(failed)].map((s) => (
          <span key={s} className="pl-[18px]">
            {s}
          </span>
        ))}
      </div>
    );
  }
  const lookups = r.steps.filter((s) => !/isn't connected|failed|error/i.test(s)).length;
  return (
    <div className="flex flex-col gap-[8px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-[6px] text-left">
        <Globe size={14} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" />
        <span className="flex-1 text-caption font-semibold text-fg">
          Research
          <span className="font-normal text-fg-subtle tnum">
            {lookups ? ` · ${lookups} lookup${lookups > 1 ? "s" : ""}` : ""}
            {r.sources.length ? ` · ${r.sources.length} source${r.sources.length > 1 ? "s" : ""}` : ""}
          </span>
        </span>
        <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("shrink-0 text-fg-subtle transition-transform duration-fast", open && "rotate-90")} />
      </button>
      {r.sources.length > 0 && (
        <div className="flex flex-wrap gap-[4px]">
          {r.sources.slice(0, open ? undefined : 4).map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="q-item inline-flex h-[22px] max-w-[180px] items-center rounded-sm bg-active px-[6px] text-micro text-fg-muted hover:bg-hover hover:text-fg hover:shadow-[inset_0_0_0_1px_var(--color-line)]">
              <span className="truncate">{hostOf(s.url)}</span>
            </a>
          ))}
          {!open && r.sources.length > 4 && (
            <button type="button" onClick={() => setOpen(true)} className="q-item h-[22px] rounded-sm px-[6px] text-micro text-fg-subtle tnum hover:bg-hover hover:text-fg">
              +{r.sources.length - 4}
            </button>
          )}
        </div>
      )}
      {open && (
        <>
          <Notes notes={r.notes} />
          {r.steps.length > 0 && (
            <div className="flex flex-col gap-[2px] border-t border-line-subtle pt-[6px]">
              {r.steps.map((s, i) => (
                <span key={i} className="truncate text-micro text-fg-subtle" title={s}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
