import { useState, type CSSProperties, type FormEvent } from "react";
import clsx from "clsx";
import { Link2 } from "lucide-react";
import { FIELD_LABEL, type Competitor, type MarketLine } from "@/market/types";
import type { CompanyLook, CompetitorsLook } from "@/market/session";
import { loadOrgContext } from "@/org/context";
import { lookForCompetitors, lookUpCompany, settleCompany, settleCompetitors, stopCompany, useMarket } from "@/org/market";
import { qr } from "../ai/Questionnaire";
import { Spinner } from "../controls";
import { useWords } from "../frame/store";
import { r } from "../recipes";

/*
 * Reading what's on the web about the company, from its panel (the lookups run in the core and
 * follow through here, so closing the panel doesn't stop them): its website or a line about it,
 * what was found to keep, fix or drop, and its competitors the same way. What's kept goes into
 * hub/market.md and fills the About's empty fields, and the domain is read from then on.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const isAddress = (t: string) => /^\S+\.\S+$/.test(t.trim());

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A look under way: what it's doing now. */
function Looking({ steps, label, onStop }: { steps: readonly string[]; label: string; onStop?: () => void }) {
  return (
    <div role="status" className="flex items-center gap-[8px] text-caption text-fg-muted">
      <Spinner size={12} />
      <span className="q-shimmer-text min-w-0 flex-1 truncate">{steps.at(-1) ?? label}</span>
      {onStop && (
        <button type="button" className={qr.textBtn} onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}

/** One fact: what it's about, its sentence (theirs once fixed), the page it was read on, and Keep, Fix or Drop. */
function FactRow({ i, f, kept, text, editing, onKeep, onEdit, onText }: { i: number; f: MarketLine; kept: boolean; text: string; editing: boolean; onKeep: (on: boolean) => void; onEdit: (on: boolean) => void; onText: (t: string) => void }) {
  return (
    <li style={{ "--i": i } as CSSProperties} className={clsx(qr.inset, "flex flex-col gap-[4px] px-[10px] py-[8px]", !kept && "opacity-60")}>
      <span className="flex items-center gap-[6px] text-micro text-fg-subtle">
        <span>{f.field ? FIELD_LABEL[f.field] : "About it"}</span>
        {f.url && (
          <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[3px] hover:text-fg" title={f.quote ? `“${f.quote}”` : f.url}>
            <Link2 size={11} {...ICON} />
            <span className="truncate">{hostOf(f.url)}</span>
          </a>
        )}
      </span>
      {editing ? (
        <textarea
          aria-label="The fact, in your words"
          rows={2}
          dir="auto"
          className={clsx(r.textarea, "text-body")}
          value={text}
          autoFocus
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onEdit(false);
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              onEdit(false);
            }
          }}
        />
      ) : (
        <p className={clsx("text-body leading-[20px] text-fg", !kept && "line-through")} dir="auto">
          {text}
        </p>
      )}
      <span className="flex gap-[6px]">
        {kept ? (
          <>
            <button type="button" className={r.replyChip} onClick={() => onEdit(!editing)}>
              {editing ? "Done" : "Fix"}
            </button>
            <button type="button" className={r.replyChip} onClick={() => onKeep(false)}>
              Drop
            </button>
          </>
        ) : (
          <button type="button" className={r.replyChip} onClick={() => onKeep(true)}>
            Keep
          </button>
        )}
      </span>
    </li>
  );
}

function CheckFacts({ look }: { look: CompanyLook }) {
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const facts = look.facts;
  const kept = facts.filter((f) => !dropped.has(f.id)).length;
  const settle = async (decisions: { id: string; keep: boolean; text?: string }[]) => {
    setSaving(true);
    try {
      await settleCompany(decisions);
      // The About's empty fields were filled from them.
      await loadOrgContext();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <ul className="q-stagger flex flex-col gap-[6px]">
        {facts.map((f, i) => (
          <FactRow
            key={f.id}
            i={i}
            f={f}
            kept={!dropped.has(f.id)}
            text={texts[f.id] ?? f.text}
            editing={editing === f.id}
            onKeep={(on) => setDropped((d) => (on ? new Set([...d].filter((x) => x !== f.id)) : new Set([...d, f.id])))}
            onEdit={(on) => setEditing(on ? f.id : null)}
            onText={(t) => setTexts((x) => ({ ...x, [f.id]: t }))}
          />
        ))}
      </ul>
      <button
        type="button"
        disabled={saving}
        className={clsx(r.replyChipPrimary, "self-start")}
        onClick={() => void settle(facts.map((f) => ({ id: f.id, keep: !dropped.has(f.id), ...(texts[f.id] !== undefined && texts[f.id].trim() !== f.text ? { text: texts[f.id] } : {}) })))}
      >
        {kept ? (kept === facts.length ? "That's right" : `Keep these ${kept}`) : "None of these"}
      </button>
    </div>
  );
}

/** Nothing kept about the company yet: its website or a line about it, read on the web; what's found is checked here. */
export function LookUpCompany() {
  const look = useMarket((m) => m.session.company);
  const words = useWords();
  const [text, setText] = useState(look?.site ?? look?.said ?? "");
  if (look?.state === "looking") return <Looking steps={look.steps} label={`Reading about the ${words.company.toLowerCase()}`} onStop={() => void stopCompany()} />;
  if (look?.state === "ready" && look.facts.length) return <CheckFacts key={look.at} look={look} />;
  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t) void lookUpCompany(isAddress(t) ? { site: t } : { said: t });
  };
  return (
    <form className="flex flex-col gap-[8px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" onSubmit={send}>
      <p className="text-caption text-fg-muted">Nothing is kept about it yet. Give Qalam AI its website or a line about it to read up on, or add what matters below.</p>
      {look?.state === "failed" && (look.error || look.noWeb) && (
        <p role="alert" className="text-caption text-danger">
          {look.noWeb ? "There's no web search on this computer yet. Add what matters below in your own words." : look.error}
        </p>
      )}
      <div className="flex items-center gap-[6px]">
        <span className={clsx(r.field, "flex-1")}>
          <input aria-label="Its website, or a line about it" dir="auto" placeholder="example.com, or a line about it" value={text} onChange={(e) => setText(e.target.value)} className={r.fieldInput} />
        </span>
        <button type="submit" disabled={!text.trim()} className={clsx(r.buttonSm, r.buttonSecondary)}>
          Look it up
        </button>
      </div>
    </form>
  );
}

function RivalRow({ i, c, kept, onKeep }: { i: number; c: Competitor; kept: boolean; onKeep: (on: boolean) => void }) {
  return (
    <li style={{ "--i": i } as CSSProperties} className={clsx(qr.inset, "flex flex-col gap-[4px] px-[10px] py-[8px]", !kept && "opacity-60")}>
      <span className="flex min-w-0 items-center gap-[6px]">
        <span className={clsx("truncate text-body font-medium text-fg", !kept && "line-through")}>{c.name}</span>
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[3px] text-micro text-fg-subtle hover:text-fg">
            <Link2 size={11} {...ICON} />
            <span className="truncate">{hostOf(c.url)}</span>
          </a>
        )}
      </span>
      {c.lines.slice(0, 2).map((l) => (
        <p key={l.id} className="text-caption leading-[18px] text-fg-muted" dir="auto" title={l.quote ? `“${l.quote}”` : undefined}>
          {l.text}
        </p>
      ))}
      <span className="flex gap-[6px]">
        <button type="button" className={r.replyChip} onClick={() => onKeep(!kept)}>
          {kept ? "Take it off" : "Keep"}
        </button>
      </span>
    </li>
  );
}

function CheckRivals({ look }: { look: CompetitorsLook }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const kept = look.found.filter((c) => !off.has(c.id));
  return (
    <div className="flex flex-col gap-[8px]">
      <ul className="q-stagger flex flex-col gap-[6px]">
        {look.found.map((c, i) => (
          <RivalRow key={c.id} i={i} c={c} kept={!off.has(c.id)} onKeep={(on) => setOff((d) => (on ? new Set([...d].filter((x) => x !== c.id)) : new Set([...d, c.id])))} />
        ))}
      </ul>
      <button
        type="button"
        disabled={saving}
        className={clsx(r.replyChipPrimary, "self-start")}
        onClick={() => {
          setSaving(true);
          void settleCompetitors(kept.map((c) => c.id)).finally(() => setSaving(false));
        }}
      >
        {kept.length ? (kept.length === 1 ? "Keep this one" : `Keep these ${kept.length}`) : "None of these"}
      </button>
    </div>
  );
}

/** Its competitors read on the web, checked here; a way to ask while none are kept and the company is known. */
export function LookForRivals({ offer }: { offer: boolean }) {
  const look = useMarket((m) => m.session.competitors);
  if (look?.state === "looking") return <Looking steps={look.steps} label="Looking for competitors" />;
  if (look?.state === "ready" && look.found.length) return <CheckRivals key={look.at} look={look} />;
  return (
    <>
      {look?.state === "failed" && look.error && !look.noWeb && (
        <p role="alert" className="text-caption text-danger">
          {look.error}
        </p>
      )}
      {offer && !look?.noWeb && (
        <button type="button" className={clsx(r.buttonSm, r.buttonSecondary, "self-start")} onClick={() => void lookForCompetitors([])}>
          Find them
        </button>
      )}
    </>
  );
}

/** The domain, read once the company's facts are kept. */
export function DomainReading() {
  const look = useMarket((m) => m.session.domain);
  return look?.state === "looking" ? <Looking steps={look.steps} label="Reading what companies like it aim for" /> : null;
}
