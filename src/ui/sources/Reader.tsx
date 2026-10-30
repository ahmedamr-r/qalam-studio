import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowUpRight, ExternalLink, FlaskConical, Lightbulb, Target, TriangleAlert, X } from "lucide-react";
import { connectorDef } from "@/connectors/catalog";
import { partLine } from "@/discovery/origin";
import { segmentsOf } from "@/discovery/segments";
import type { SourceQuote } from "@/discovery/sources";
import type { SetupDoc } from "@/org/setup";
import { IconBtn, Spinner } from "../controls";
import { MarkedText } from "../discovery/MarkedText";
import { SourceMark } from "../onboarding/SetupCanvas";

/*
 * Reading a source with the words behind each card marked (the setup's canvas and a board's
 * sources lane both open it): where it came from (its connector, kind, when, a link to open it
 * there), what it backs as chips, and its text, or its own part of a brain dump, with each card's
 * quotes in that card's colour. A chip marks only its own words; where there's a board to go to,
 * a pressed chip can take you to its card.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export type BackKind = "problem" | "goal" | "solution" | "test";

export interface Back {
  id: string;
  kind: BackKind;
  title: string;
  quotes: string[];
}

const TONE: Record<BackKind, { mark: string; chip: string; icon: typeof Target }> = {
  problem: { mark: "bg-warning-subtle", chip: "bg-warning-subtle text-warning", icon: TriangleAlert },
  goal: { mark: "bg-kh-you/20", chip: "bg-kh-you/15 text-kh-you", icon: Target },
  solution: { mark: "bg-ai-subtle", chip: "bg-ai-subtle text-ai", icon: Lightbulb },
  test: { mark: "bg-selection-subtle", chip: "bg-selection-subtle text-selection", icon: FlaskConical },
};

const webAddress = (s: string | undefined) => (s && /^https?:\/\//i.test(s) ? s : null);

export function Reader({
  title,
  doc,
  line,
  text,
  quotes,
  pages,
  range,
  backs,
  loading,
  error,
  onClose,
  onPick,
  close = "back",
  className,
}: {
  title: string;
  /** Where it came from: a part of a brain dump, or a whole source as its mark and address. */
  doc?: SetupDoc;
  /** Where it came from in words (default: the part's). */
  line?: string;
  text: string;
  quotes: readonly SourceQuote[];
  pages?: number[];
  range?: [number, number];
  backs: readonly Back[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Take the person to a card it backs (a board). */
  onPick?: (id: string) => void;
  close?: "back" | "close";
  className?: string;
}) {
  const [only, setOnly] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const shown = only ? backs.filter((b) => b.id === only) : backs;
  // Each marked quote's tint: the first card it backs.
  const tone = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of shown) for (const q of b.quotes) if (!m.has(q)) m.set(q, TONE[b.kind].mark);
    return m;
  }, [shown]);
  const marked = useMemo(() => quotes.filter((q) => tone.has(q.id)), [quotes, tone]);
  const segments = useMemo(() => segmentsOf(text, marked, { pages, range }), [text, marked, pages, range]);
  const first = segments.find((s) => s.quote)?.quote;
  useEffect(() => {
    if (first) body.current?.querySelector(`[data-quote="${first}"]`)?.scrollIntoView({ block: "center" });
  }, [first, only]);
  const link = webAddress(doc?.origin);
  const where = doc && doc.from !== "said" && doc.from !== "page" && doc.from !== "computer" ? connectorDef(doc.from)?.label : null;
  const when = doc?.at && Number.isFinite(Date.parse(doc.at)) ? new Date(doc.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <section
      aria-label={`Reading ${title}`}
      className={clsx("q-rise flex flex-col bg-panel", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex shrink-0 flex-col gap-[8px] border-b border-line-subtle px-[12px] pt-[10px] pb-[10px]">
        <div className="flex items-center gap-[8px]">
          {close === "back" && (
            <IconBtn size="sm" label="Back to the canvas" onClick={onClose}>
              <ArrowLeft size={14} {...ICON} />
            </IconBtn>
          )}
          <SourceMark doc={doc} />
          <h3 className="min-w-0 flex-1 truncate text-body font-medium text-fg" dir="auto">
            {title}
          </h3>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-md px-[7px] text-micro font-medium text-fg-muted hover:bg-hover hover:text-fg">
              {where ? `Open in ${where}` : "Open the page"} <ExternalLink size={11} {...ICON} />
            </a>
          )}
          {close === "close" && (
            <IconBtn size="sm" label="Close" onClick={onClose}>
              <X size={14} {...ICON} />
            </IconBtn>
          )}
        </div>
        <p className={clsx("text-micro text-fg-subtle", close === "back" && "pl-[32px]")}>{[line ?? partLine(doc), when, doc?.cut ? "cut short to fit what Qalam AI reads" : null].filter(Boolean).join(" · ")}</p>
        {backs.length > 0 && (
          <div role="group" aria-label="What it backs" className={clsx("flex flex-wrap items-center gap-[6px]", close === "back" && "pl-[32px]")}>
            <span className="text-micro text-fg-subtle">Backs</span>
            {backs.map((b) => {
              const { icon: Icon, chip } = TONE[b.kind];
              const on = only === b.id;
              return (
                <span key={b.id} className="inline-flex max-w-full items-center gap-[2px]">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setOnly(on ? null : b.id)}
                    className={clsx("q-item inline-flex h-[22px] max-w-[220px] items-center gap-[4px] rounded-md px-[6px] text-micro font-medium shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", on ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg", only && !on && "opacity-60")}
                  >
                    <span className={clsx("grid size-[14px] shrink-0 place-items-center rounded-[3px]", chip)}>
                      <Icon size={9} {...ICON} />
                    </span>
                    <span className="truncate" dir="auto">
                      {b.title}
                    </span>
                  </button>
                  {on && onPick && (
                    <IconBtn size="sm" label="Go to it on the board" onClick={() => onPick(b.id)} className="size-[22px]">
                      <ArrowUpRight size={12} {...ICON} />
                    </IconBtn>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </header>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[12px]">
        {error ? (
          <p className="text-caption text-danger">{error}</p>
        ) : loading ? (
          <span className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
            <Spinner size={12} /> Opening it…
          </span>
        ) : (
          <>
            {!backs.length && <p className="mb-[10px] text-caption text-fg-subtle">Nothing in it backs a card yet.</p>}
            <MarkedText text={text} segments={segments} focus={first} toneOf={(q) => tone.get(q)} />
          </>
        )}
      </div>
    </section>
  );
}
