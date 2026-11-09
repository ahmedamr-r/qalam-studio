import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Check, Pencil, Plus, X } from "lucide-react";
import { sameTopic } from "@/hub/topics";
import { BUSINESS_SECTIONS, SECTION_LABEL, linesIn, type BusinessLine, type BusinessSection } from "@/business/types";
import type { FactField, MarketLine } from "@/market/types";
import { editBusinessLine, loadBusiness, useBusiness } from "@/org/business";
import { useOrgContext } from "@/org/context";
import { useMarket } from "@/org/market";
import { Button, IconBtn } from "../controls";
import { useCurrentOrg } from "../frame/store";
import { r } from "../recipes";
import { doneWithAt, PanelPageHeader, scrollToSection, usePanelEnter } from "../space/page";

/*
 * How the business works (business.md), open in the canvas's panel: its seven sections, each line
 * saying whose words it is, with Keep (a reading of Qalam AI's made theirs), Fix and Take off. What's
 * known elsewhere shows in its section beside them (a fact read on the web, the About's audience),
 * never copied: Keep as yours adds it as their line.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** Where a company fact read on the web belongs on the page. */
const FACT_SECTION: Partial<Record<FactField, BusinessSection>> = { for: "serves", model: "earns", stage: "stands" };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a page";
  }
};

/** A line's words as they're written: Enter keeps them, Esc lets them go. */
function LineForm({ start, label, onDone }: { start?: string; label: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(start ?? "");
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDone(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onDone(text.trim() || null);
    }
  };
  return (
    <div className="q-sheet flex flex-col gap-[6px] rounded-lg p-[8px]">
      <textarea aria-label={label} autoFocus rows={2} dir="auto" placeholder="In your words" className={clsx(r.textarea, "w-full text-body")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
      <div className="flex items-center justify-end gap-[6px]">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!text.trim()} onClick={() => onDone(text.trim())}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function LineRow({ line }: { line: BusinessLine }) {
  const [fixing, setFixing] = useState(false);
  if (fixing)
    return (
      <LineForm
        start={line.text}
        label={`Fix: ${line.text}`}
        onDone={(text) => {
          setFixing(false);
          if (text && text !== line.text) void editBusinessLine({ op: "fix", id: line.id, text });
        }}
      />
    );
  const reading = line.by === "qalam";
  return (
    <div className="group relative flex flex-col gap-[2px] pr-[72px]">
      <p className="text-body leading-[20px] text-fg" dir="auto">
        {line.text}
      </p>
      <p className="text-micro text-fg-subtle">{reading ? "Qalam AI's reading of your answers" : line.by === "said" ? "Your words, from an answer" : "Your words"}</p>
      <span className="absolute top-0 right-0 flex items-center gap-[2px] rounded-md bg-app opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {reading && (
          <IconBtn size="sm" label={`Keep as yours: ${line.text}`} onClick={() => void editBusinessLine({ op: "keep", id: line.id })}>
            <Check size={12} {...ICON} />
          </IconBtn>
        )}
        <IconBtn size="sm" label={`Fix: ${line.text}`} onClick={() => setFixing(true)}>
          <Pencil size={12} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label={`Take off: ${line.text}`} onClick={() => void editBusinessLine({ op: "remove", id: line.id })}>
          <X size={12} {...ICON} />
        </IconBtn>
      </span>
    </div>
  );
}

/** Something known elsewhere that belongs in this section: shown beside the lines, theirs only once they keep it. */
function LinkedRow({ text, from, url, section }: { text: string; from: string; url?: string; section: BusinessSection }) {
  return (
    <div className="flex items-start justify-between gap-[8px] rounded-md px-[8px] py-[6px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <p className="text-body leading-[20px] text-fg-muted" dir="auto">
          {text}
        </p>
        <p className="text-micro text-fg-subtle">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
              {from}
            </a>
          ) : (
            from
          )}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => void editBusinessLine({ op: "add", section, text })}>
        Keep as yours
      </Button>
    </div>
  );
}

function SectionPart({ section, lines, linked }: { section: BusinessSection; lines: BusinessLine[]; linked: { text: string; from: string; url?: string }[] }) {
  const [adding, setAdding] = useState(false);
  const id = `business-${section}`;
  return (
    <section aria-labelledby={id} data-at={section} className="flex flex-col gap-[8px]">
      <div className="flex h-[24px] items-center justify-between gap-[8px]">
        <h3 id={id} className={r.sectionTitle}>
          {SECTION_LABEL[section]}
        </h3>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={14} {...ICON} className="mr-[4px]" />
            Add a line
          </Button>
        )}
      </div>
      {lines.map((l) => (
        <LineRow key={l.id} line={l} />
      ))}
      {linked.map((x) => (
        <LinkedRow key={`${x.from}:${x.text}`} {...x} section={section} />
      ))}
      {!lines.length && !linked.length && !adding && <p className="text-caption text-fg-subtle">Not known yet.</p>}
      {adding && (
        <LineForm
          label={`Add to ${SECTION_LABEL[section]}`}
          onDone={(text) => {
            setAdding(false);
            if (text) void editBusinessLine({ op: "add", section, text });
          }}
        />
      )}
    </section>
  );
}

export default function BusinessView({ at }: { at: string | null }) {
  const enter = usePanelEnter();
  const { business, loaded, error } = useBusiness();
  const facts = useMarket((s) => s.market.company);
  const about = useOrgContext((s) => s.about);
  const org = useCurrentOrg();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => void loadBusiness(), []);
  useEffect(() => {
    if (loaded && at && scrollToSection(root.current, at)) doneWithAt();
  }, [loaded, at]);
  const name = org?.name ?? "the business";
  useEffect(() => {
    const was = document.title;
    document.title = `How ${name} works · Qalam`;
    return () => void (document.title = was);
  }, [name]);

  // What's known elsewhere, by section, unless a line of theirs says it already.
  const linked = (s: BusinessSection) => {
    const lines = linesIn(business, s);
    const said = (text: string) => lines.some((l) => sameTopic(l.text, text) || l.text.toLowerCase() === text.toLowerCase());
    const out: { text: string; from: string; url?: string }[] = [];
    if (s === "serves" && about.audience.trim() && !said(about.audience)) out.push({ text: about.audience.trim(), from: "From your About" });
    for (const f of facts as MarketLine[]) {
      if (!f.field || FACT_SECTION[f.field] !== s || said(f.text)) continue;
      out.push({ text: f.text, from: f.url ? `Read on ${hostOf(f.url)}` : "From what you told Qalam AI", ...(f.url ? { url: f.url } : {}) });
    }
    return out;
  };

  return (
    <div ref={root} className={clsx("q-page-sections @container flex flex-col gap-[20px] px-[16px] py-[14px]", enter)}>
      <PanelPageHeader kind="Business" title={`How ${name} works`} />
      <p className="text-body text-fg-muted">Who it serves, how it earns and what it takes to run, as you tell it. Qalam AI notes it as you talk, and marks a reading of its own as its own.</p>
      {!loaded ? (
        <div className={clsx(r.skeleton, "h-[120px] rounded-lg")} aria-hidden />
      ) : (
        BUSINESS_SECTIONS.map((s) => <SectionPart key={s} section={s} lines={linesIn(business, s)} linked={linked(s)} />)
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
