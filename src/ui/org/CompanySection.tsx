import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Link2, Pencil, Plus, X } from "lucide-react";
import { roomIn, type MarketEdit, type MarketSection } from "@/market/edit";
import { knowsMarket, type MarketLine } from "@/market/types";
import { editKnown, loadMarket, useMarket } from "@/org/market";
import { Button, IconBtn } from "../controls";
import { useCurrentOrg, useWords } from "../frame/store";
import { r } from "../recipes";
import { DomainReading, hostOf, LookForRivals, LookUpCompany } from "./CompanyLookUp";

/*
 * What's known about the company on its canvas: the facts and competitors kept, read here on asking
 * (./CompanyLookUp.tsx), and what was read about its domain (hub/market.md). Each line says where it was read, and a person
 * can fix it, take it off or add their own. Qalam AI hears them as context, never as what customers
 * said. The organization's own, so every canvas shows the same.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const edit = (e: MarketEdit) => void editKnown(e);

/** A line's words as they're being written: Enter keeps them, Esc lets them go. */
function LineBox({ label, value, onDone, rows = 2 }: { label: string; value: string; onDone: (text: string | null) => void; rows?: number }) {
  const [text, setText] = useState(value);
  return (
    <textarea
      aria-label={label}
      rows={rows}
      dir="auto"
      autoFocus
      className={clsx(r.textarea, "w-full text-body")}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(text.length, text.length)}
      onBlur={() => onDone(text.trim() ? text : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onDone(text.trim() ? text : null);
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
}

function Actions({ what, onFix, onRemove }: { what: string; onFix?: () => void; onRemove: () => void }) {
  return (
    <span className="absolute top-0 right-0 flex items-center gap-[2px] rounded-md bg-app opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {onFix && (
        <IconBtn size="sm" label={`Fix ${what}`} onClick={onFix}>
          <Pencil size={12} {...ICON} />
        </IconBtn>
      )}
      <IconBtn size="sm" label={`Take off ${what}`} onClick={onRemove}>
        <X size={12} {...ICON} />
      </IconBtn>
    </span>
  );
}

const Whence = ({ line }: { line: MarketLine }) =>
  line.url ? (
    <a href={line.url} target="_blank" rel="noreferrer" title={line.quote ? `“${line.quote}”` : line.url} className="inline-flex max-w-full items-center gap-[3px] text-micro text-fg-subtle hover:text-fg">
      <Link2 size={11} {...ICON} className="shrink-0" />
      <span className="truncate">{hostOf(line.url)}</span>
    </a>
  ) : line.by === "you" ? (
    <span className="text-micro text-fg-subtle">Your words</span>
  ) : null;

function LineRow({ line, small }: { line: MarketLine; small?: boolean }) {
  const [fixing, setFixing] = useState(false);
  if (fixing)
    return (
      <LineBox
        label="The line, in your words"
        value={line.text}
        onDone={(text) => {
          setFixing(false);
          if (text) edit({ kind: "fix", id: line.id, text });
        }}
      />
    );
  return (
    <div className="group relative">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <p className={clsx(small ? "text-caption text-fg-muted" : "text-body text-fg", "leading-[20px]")} dir="auto">
          {line.text}
        </p>
        {!small && <Whence line={line} />}
      </div>
      <Actions what="this line" onFix={() => setFixing(true)} onRemove={() => edit({ kind: "remove", id: line.id })} />
    </div>
  );
}

/** One kind of thing known: its lines, and adding one in a person's own words. */
function Group({ title, section, addLabel, children, empty }: { title: string; section: MarketSection; addLabel: string; children: ReactNode; empty: boolean }) {
  const market = useMarket((m) => m.market);
  const [adding, setAdding] = useState(false);
  return (
    <section className="flex flex-col gap-[8px]">
      <div className="flex h-[24px] items-center justify-between gap-[8px]">
        <h3 className={r.sectionTitle}>{title}</h3>
        {!adding && roomIn(market, section) && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={14} {...ICON} className="mr-[4px]" />
            {addLabel}
          </Button>
        )}
      </div>
      {empty && !adding && <p className="text-caption text-fg-subtle">Nothing yet.</p>}
      {children}
      {adding && (
        <LineBox
          label={addLabel}
          value=""
          rows={section === "competitors" ? 1 : 2}
          onDone={(text) => {
            setAdding(false);
            if (text) edit({ kind: "add", section, text });
          }}
        />
      )}
    </section>
  );
}

export function CompanySection({ close }: { close?: ReactNode }) {
  const org = useCurrentOrg();
  const words = useWords();
  const { market, loaded, error } = useMarket();
  useEffect(() => void loadMarket(), []);
  const look = useMarket((m) => m.session.company);
  const checking = look?.state === "looking" || (look?.state === "ready" && look.facts.length > 0);
  const rivals = useMarket((m) => m.session.competitors);
  const checkingRivals = rivals?.state === "looking" || (rivals?.state === "ready" && rivals.found.length > 0);
  const domain = market.aims.length > 0 || market.struggles.length > 0;
  return (
    <section aria-labelledby="space-company" className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <div className="flex items-center justify-between gap-[8px]">
          <h2 id="space-company" className="min-w-0 truncate text-title font-medium">
            {org?.name ?? words.company}
          </h2>
          {close}
        </div>
        <p className="text-caption text-fg-muted">What&apos;s known about it, from the web and from you. Qalam AI hears it as context, never as what customers said.</p>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      {loaded && (checking || !market.company.length) && <LookUpCompany />}

      <Group title={`The ${words.company.toLowerCase()}`} section="company" addLabel="Add a fact" empty={!market.company.length && !checking}>
        {market.company.map((l) => (
          <LineRow key={l.id} line={l} />
        ))}
      </Group>

      <Group title="Competitors" section="competitors" addLabel="Add one" empty={!market.competitors.length && !checkingRivals}>
        {market.competitors.map((c) => (
          <div key={c.id} className="flex flex-col gap-[2px]">
            <div className="group relative flex items-center gap-[6px]">
              <span className="min-w-0 truncate text-body font-medium text-fg" dir="auto">
                {c.name}
              </span>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[3px] text-micro text-fg-subtle hover:text-fg">
                  <Link2 size={11} {...ICON} className="shrink-0" />
                  <span className="truncate">{hostOf(c.url)}</span>
                </a>
              ) : c.by === "you" ? (
                <span className="shrink-0 text-micro text-fg-subtle">You named it</span>
              ) : null}
              <Actions what={c.name} onRemove={() => edit({ kind: "remove", id: c.id })} />
            </div>
            {c.lines.map((l) => (
              <LineRow key={l.id} line={l} small />
            ))}
          </div>
        ))}
        <LookForRivals offer={!market.competitors.length && !!market.company.length} />
      </Group>

      {(domain || knowsMarket(market)) && (
        <>
          <DomainReading />
          <Group title="What companies like it aim for" section="aims" addLabel="Add" empty={!market.aims.length}>
            {market.aims.map((l) => (
              <LineRow key={l.id} line={l} />
            ))}
          </Group>
          <Group title="What their customers struggle with" section="struggles" addLabel="Add" empty={!market.struggles.length}>
            {market.struggles.map((l) => (
              <LineRow key={l.id} line={l} />
            ))}
          </Group>
        </>
      )}
    </section>
  );
}
