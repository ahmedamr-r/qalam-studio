import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { countsEvents } from "@/connectors/analytics";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { numberLine, passageLine, passagesFor, toolConnected, toolsForAsk, type ToolAsk } from "@/connectors/suggest";
import { connectorsDb, numbersDb, type ConnectorState } from "@/org/connectors";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Browse, useConnectorView } from "../chat/SourcePicker";
import { ConnectActions, type View } from "../connections/Connectors";
import { EventPicker } from "../numbers/EventPicker";
import { Button, IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { StatusDot } from "../viz";

/*
 * Under a question a tool could answer better than memory: the tools that fit. One that isn't
 * connected connects right here; a connected one is searched for the question, and what the person
 * picks goes in their answer, for them to read and change. Nothing is fetched until they ask.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const LINE = "q-item flex w-full flex-col items-start gap-[2px] rounded-md px-[6px] py-[4px] text-left hover:bg-hover disabled:opacity-60";

export function ToolSuggestion({ ask, question, onFill }: { ask: ToolAsk; question: string; onFill: (line: string) => void }) {
  const { view, setView } = useConnectorView();
  const [openId, setOpenId] = useState<string | null>(null);
  // What was connected on Connections since this window last asked.
  useEffect(() => void connectorsDb.list().then(setView, () => {}), []);
  const tools = view ? toolsForAsk(ask, view.connectors) : [];
  const open = tools.find((c) => c.id === openId) ?? null;
  if (!tools.length) return null;
  return (
    // Its own keys: Enter on a button here isn't the card's Next, and 1–9 aren't its options.
    <div className="flex flex-col gap-[6px] border-t border-line-subtle pt-[10px]" onKeyDown={(e) => e.stopPropagation()}>
      <div role="group" aria-label={ask.kind === "numbers" ? "Get it from your analytics" : "Get it from your docs"} className="flex flex-wrap items-center gap-[6px]">
        <span className="text-micro text-fg-subtle">{ask.kind === "numbers" ? "Your analytics may have this" : "Your docs may have this"}</span>
        {tools.map((c) => (
          <button key={c.id} type="button" aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)} className={r.composerPill}>
            <ConnectorLogo id={c.id} size={16} decorative />
            {c.label}
            {toolConnected(c) && <StatusDot tone="ok" />}
          </button>
        ))}
      </div>
      {open && (
        <div className="flex flex-col gap-[6px] border-t border-line-subtle pt-[6px]">
          <div className="flex items-center gap-[6px]">
            <span className="min-w-0 flex-1 text-caption text-fg-muted">{toolConnected(open) ? `From ${open.label}` : `Connect ${open.label} to fetch it. Qalam only reads.`}</span>
            <IconBtn size="sm" label={`Close ${open.label}`} onClick={() => setOpenId(null)}>
              <X {...ICON} />
            </IconBtn>
          </div>
          {!toolConnected(open) ? <ConnectActions c={open} onView={(v: View) => setView(v)} /> : ask.kind === "numbers" ? <FetchNumber key={open.id} c={open} first={ask.lookFor ?? ""} onFill={onFill} /> : <FetchDoc key={open.id} c={open} asked={`${question} ${ask.lookFor ?? ""}`.trim()} onFill={onFill} onClose={() => setOpenId(null)} />}
        </div>
      )}
    </div>
  );
}

/** One thing at a time, saying what, with the tool's own words when it fails. */
function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

/** Reached through Claude Code, a call starts its servers first. */
const slow = (c: ConnectorState) => (c.via === "claude-code" ? " About a minute through Claude Code." : "");

function Status({ busy, error }: { busy: string | null; error: string | null }) {
  return (
    <>
      {busy && (
        <p className="inline-flex items-center gap-[6px] text-micro text-fg-muted">
          <Spinner size={12} /> <span className="q-shimmer-text">{busy}</span>
        </p>
      )}
      {error && <p className="text-micro text-danger">{error}</p>}
    </>
  );
}

function SearchBox({ query, set, busy, label, onSearch }: { query: string; set: (q: string) => void; busy: boolean; label: string; onSearch: () => void }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch();
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-[6px]">
      <span className={clsx(r.field, "flex-1")}>
        <input value={query} onChange={(e) => set(e.target.value)} placeholder={label} aria-label={label} className={r.fieldInput} />
      </span>
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        Find
      </Button>
    </form>
  );
}

/** Once, as it opens (a ref, as development runs effects twice). */
function useOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) fn();
    done.current = true;
  }, []);
}

/** A saved chart's number: find the chart, read it, pick which number (the only one goes straight in). */
function FetchNumber({ c, first, onFill }: { c: ConnectorState; first: string; onFill: (line: string) => void }) {
  const [query, setQuery] = useState(first);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [read, setRead] = useState<{ hit: Hit; numbers: InsightNumbers } | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  /** Counting one of its events instead: where it has no saved chart that fits, or they asked. */
  const [events, setEvents] = useState(false);
  const canCount = countsEvents(c.id);
  const find = (q: string) =>
    run(`Looking in ${c.label}…${slow(c)}`, async () => {
      const found = (await numbersDb.insights(q, c.id)).hits;
      setHits(found);
      if (!found.length && canCount) setEvents(true);
    });
  useOnce(() => void find(first));
  const use = (hit: Pick<Hit, "title">, numbers: Pick<InsightNumbers, "name">, s: InsightNumbers["series"][number]) => {
    onFill(numberLine(s.value, { series: s.label, chart: numbers.name ?? hit.title, tool: c.label }));
    setUsed(`${s.value} went in your answer. Change it there if it's not right.`);
    setRead(null);
  };
  const open = (hit: Hit) =>
    run(`Reading “${hit.title}”…${slow(c)}`, async () => {
      const numbers = await numbersDb.read(hit.id, c.id);
      if (!numbers.series.length) throw new Error("This chart has no one number to read. Pick another, or type the number.");
      if (numbers.series.length === 1) return use(hit, numbers, numbers.series[0]);
      setRead({ hit, numbers });
    });
  if (events)
    return (
      <div className="flex flex-col gap-[4px]">
        {hits && !hits.length && <p className="px-[6px] text-micro text-fg-subtle">{query.trim() ? "No saved chart by that name" : `${c.label} has no saved charts yet`}, so count an event instead.</p>}
        <EventPicker tool={c} onCharts={() => setEvents(false)} onPick={(picked, count) => (use(picked, {}, count), setEvents(false))} />
        {used && <Done>{used}</Done>}
      </div>
    );
  return (
    <div className="flex flex-col gap-[4px]">
      <SearchBox query={query} set={setQuery} busy={!!busy} label="A saved chart's name" onSearch={() => void find(query)} />
      {read ? (
        <>
          <span className="px-[6px] text-micro text-fg-subtle">Which of its numbers is it?</span>
          {read.numbers.series.map((s) => (
            <button key={s.label} type="button" className={clsx(LINE, "flex-row items-center justify-between gap-[8px]")} onClick={() => use(read.hit, read.numbers, s)}>
              <span className="min-w-0 truncate text-caption text-fg">{s.label}</span>
              <span className="tnum text-caption text-fg-muted">{s.value}</span>
            </button>
          ))}
        </>
      ) : (
        hits?.map((h) => (
          <button key={h.id} type="button" disabled={!!busy} className={LINE} onClick={() => void open(h)}>
            <span className="w-full truncate text-caption text-fg">{h.title}</span>
            {h.snippet && <span className="w-full truncate text-micro text-fg-subtle">{h.snippet}</span>}
          </button>
        ))
      )}
      {hits && !hits.length && !busy && !error && <p className="px-[6px] text-micro text-fg-subtle">{query.trim() ? "No saved chart by that name." : `${c.label} has no saved charts yet. Save one there, or type the number.`}</p>}
      {canCount && !read && !busy && (
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "self-start")} onClick={() => setEvents(true)}>
          Count an event instead
        </button>
      )}
      {used && <Done>{used}</Done>}
      <Status busy={busy} error={error} />
    </div>
  );
}

/** Pages' words: browse to them or let Qalam AI look, read what's picked (no tokens), and put the passages that answer it in the answer. The whole pages can stay as sources. */
function FetchDoc({ c, asked, onFill, onClose }: { c: ConnectorState; asked: string; onFill: (line: string) => void; onClose: () => void }) {
  const [pages, setPages] = useState<{ hit: Hit; passages: string[] }[] | null>(null);
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  const open = (hits: Hit[]) =>
    run(`Reading ${hits.length === 1 ? `“${hits[0].title}”` : `${hits.length} pages`}…${slow(c)}`, async () => {
      const items = await connectorsDb.read(c.id, hits);
      const read = items.flatMap((it) => {
        const hit = hits.find((h) => h.id === it.id);
        const passages = it.ingested && hit ? passagesFor(it.ingested.text, asked) : [];
        return hit && passages.length ? [{ hit, passages }] : [];
      });
      if (!read.length) throw new Error(items.find((it) => it.why)?.why ?? "There's too little on that page to use.");
      setUsed(new Set());
      setKept(null);
      setPages(read);
    });
  const keep = (read: { hit: Hit }[]) =>
    run("Keeping it in your sources…", async () => {
      const res = await connectorsDb.bringIn(c.id, read.map((p) => p.hit), () => {});
      if (res.failed.length) throw new Error(res.failed[0].why);
      setKept(res.added.length ? "It's in your sources now, read and filed." : "It's in your sources already.");
    });
  if (!pages)
    return (
      <div className="flex flex-col gap-[4px]">
        <div className="flex h-[320px] flex-col overflow-hidden rounded-md bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <Browse c={c} about={asked} addLabel="Read" onClose={onClose} onAdd={(hits) => void open(hits)} />
        </div>
        <Status busy={busy} error={error} />
      </div>
    );
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[6px]">
        <span className="min-w-0 flex-1 text-micro text-fg-subtle">Which part answers it?</span>
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => setPages(null)}>
          Other pages
        </button>
      </div>
      {pages.map(({ hit, passages }) => (
        <div key={hit.id} className="flex flex-col gap-[2px]">
          <span className="truncate px-[6px] text-micro text-fg-subtle">{hit.title}</span>
          {passages.map((p) => (
            <button
              key={p}
              type="button"
              disabled={used.has(p)}
              className={LINE}
              onClick={() => {
                onFill(passageLine(p, { title: hit.title, tool: c.label }));
                setUsed((u) => new Set(u).add(p));
              }}
            >
              <span className="flex w-full items-start gap-[6px] text-caption text-fg" dir="auto">
                {used.has(p) && <Check {...ICON} className="mt-[2px] shrink-0 text-fg-muted" />}
                <span className="line-clamp-3 min-w-0">{p}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
      {kept ? (
        <Done>{kept}</Done>
      ) : (
        <button type="button" disabled={!!busy} className={clsx(r.buttonSm, r.buttonGhost, "self-start")} onClick={() => void keep(pages)}>
          Keep {pages.length === 1 ? "the whole page" : "these pages"} in your sources
        </button>
      )}
      <Status busy={busy} error={error} />
    </div>
  );
}

function Done({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-[6px] px-[6px] text-micro text-fg-muted">
      <StatusDot tone="ok" /> {children}
    </p>
  );
}
