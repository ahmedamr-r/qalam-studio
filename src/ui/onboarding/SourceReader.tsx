import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ExternalLink, Target, TriangleAlert } from "lucide-react";
import { connectorDef } from "@/connectors/catalog";
import { sourcesDb } from "@/discovery/db";
import { segmentsOf } from "@/discovery/segments";
import type { SourceQuote, SourceRecord } from "@/discovery/sources";
import { topicsDb } from "@/org/topics";
import { IconBtn, Spinner } from "../controls";
import { MarkedText } from "../discovery/MarkedText";
import { backsOf, type Canvas, type CanvasNode } from "./canvas";
import { partLine } from "@/discovery/origin";
import { SourceMark } from "./SetupCanvas";

/*
 * A source read over the canvas: where it came from (its connector, kind, when, a link to open it
 * there), what it backs as chips, and its words with exactly the quotes behind each problem and goal
 * marked, each in its card's colour. A chip marks only its own words. A doc inside the setup's brain
 * dump shows its own part of the text; at the problems door the source is loaded, and each problem
 * page's quotes from it come from the page's citations.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

/** A mark's tint by what it backs: a problem's amber, a goal's blue. */
const TONE = { problem: "bg-warning-subtle", goal: "bg-kh-you/20" } as const;

interface Backing {
  node: CanvasNode;
  quotes: string[];
}

/** The words to read and what they back: the setup's own text, or the problems door's source loaded. */
function useReading(node: CanvasNode, canvas: Canvas, setup: { text: string; quotes: readonly SourceQuote[] } | null) {
  const [loaded, setLoaded] = useState<{ source: SourceRecord; backs: Backing[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problemsDoor = !setup && !!node.sourceId;
  useEffect(() => {
    if (!problemsDoor) return;
    let live = true;
    setLoaded(null);
    const pages = canvas.edges.filter((e) => e.from === node.id).flatMap((e) => canvas.nodes.find((n) => n.id === e.to && n.pageId) ?? []);
    void (async () => {
      try {
        const source = await sourcesDb.get(node.sourceId!);
        const views = await Promise.all(pages.map((p) => topicsDb.get(p.pageId!).catch(() => null)));
        // Each page's quotes from this source, as its lines cite them.
        const backs = pages.map((p, i) => ({ node: p, quotes: Object.values(views[i]?.cited ?? {}).flatMap((c) => (c.source === source.id && c.ref.startsWith("hub:quote:") ? [c.ref.slice("hub:quote:".length)] : [])) }));
        if (live) setLoaded({ source, backs });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [node.id, node.sourceId, problemsDoor]);
  if (setup) return { text: setup.text, quotes: setup.quotes, pages: undefined, range: node.doc?.span, backs: backsOf(canvas, node.id), loading: false, error: null };
  if (loaded) return { text: loaded.source.text, quotes: loaded.source.quotes, pages: loaded.source.pages, range: undefined, backs: loaded.backs, loading: false, error: null };
  return { text: "", quotes: [] as readonly SourceQuote[], pages: undefined, range: undefined, backs: [] as Backing[], loading: !error, error };
}

const webAddress = (s: string | undefined) => (s && /^https?:\/\//i.test(s) ? s : null);

export function SourceReader({ node, canvas, setup, onClose }: { node: CanvasNode; canvas: Canvas; setup: { text: string; quotes: readonly SourceQuote[] } | null; onClose: () => void }) {
  const r = useReading(node, canvas, setup);
  const [only, setOnly] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const doc = node.doc;
  const shown = only ? r.backs.filter((b) => b.node.id === only) : r.backs;
  // Each marked quote's tint: the first card it backs.
  const tone = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of shown) for (const q of b.quotes) if (!m.has(q)) m.set(q, TONE[b.node.kind === "problem" ? "problem" : "goal"]);
    return m;
  }, [shown]);
  const marked = useMemo(() => r.quotes.filter((q) => tone.has(q.id)), [r.quotes, tone]);
  const segments = useMemo(() => segmentsOf(r.text, marked, { pages: r.pages, range: r.range }), [r.text, marked, r.pages, r.range]);
  const first = segments.find((s) => s.quote)?.quote;
  useEffect(() => {
    if (first) body.current?.querySelector(`[data-quote="${first}"]`)?.scrollIntoView({ block: "center" });
  }, [first, only]);
  const link = webAddress(doc?.origin);
  const where = doc && doc.from !== "said" && doc.from !== "page" && doc.from !== "computer" ? connectorDef(doc.from)?.label : null;
  const when = doc?.at && Number.isFinite(Date.parse(doc.at)) ? new Date(doc.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <section
      aria-label={`Reading ${node.title}`}
      className="q-rise absolute inset-0 z-10 flex flex-col bg-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex shrink-0 flex-col gap-[8px] border-b border-line-subtle px-[12px] pt-[10px] pb-[10px]">
        <div className="flex items-center gap-[8px]">
          <IconBtn size="sm" label="Back to the canvas" onClick={onClose}>
            <ArrowLeft size={14} {...ICON} />
          </IconBtn>
          <SourceMark doc={doc} />
          <h3 className="min-w-0 flex-1 truncate text-body font-medium text-fg" dir="auto">
            {node.title}
          </h3>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className={clsx("inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-md px-[7px] text-micro font-medium text-fg-muted hover:bg-hover hover:text-fg")}>
              {where ? `Open in ${where}` : "Open the page"} <ExternalLink size={11} {...ICON} />
            </a>
          )}
        </div>
        <p className="pl-[32px] text-micro text-fg-subtle">{[partLine(doc), when, doc?.cut ? "cut short to fit what Qalam AI reads" : null].filter(Boolean).join(" · ")}</p>
        {r.backs.length > 0 && (
          <div role="group" aria-label="What it backs" className="flex flex-wrap items-center gap-[6px] pl-[32px]">
            <span className="text-micro text-fg-subtle">Backs</span>
            {r.backs.map((b) => {
              const Icon = b.node.kind === "problem" ? TriangleAlert : Target;
              const on = only === b.node.id;
              return (
                <button
                  key={b.node.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOnly(on ? null : b.node.id)}
                  className={clsx("q-item inline-flex h-[22px] max-w-[220px] items-center gap-[4px] rounded-md px-[6px] text-micro font-medium shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", on ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg", only && !on && "opacity-60")}
                >
                  <span className={clsx("grid size-[14px] shrink-0 place-items-center rounded-[3px]", b.node.kind === "problem" ? "bg-warning-subtle text-warning" : "bg-kh-you/15 text-kh-you")}>
                    <Icon size={9} {...ICON} />
                  </span>
                  <span className="truncate" dir="auto">
                    {b.node.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[12px]">
        {r.error ? (
          <p className="text-caption text-danger">{r.error}</p>
        ) : r.loading ? (
          <span className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
            <Spinner size={12} /> Opening it…
          </span>
        ) : (
          <>
            {!r.backs.length && <p className="mb-[10px] text-caption text-fg-subtle">Nothing in it backs a problem or goal yet.</p>}
            <MarkedText text={r.text} segments={segments} focus={first} toneOf={(q) => tone.get(q)} />
          </>
        )}
      </div>
    </section>
  );
}
