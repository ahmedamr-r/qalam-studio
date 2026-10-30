import { useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { metricText } from "@/discovery/dump";
import type { Decision } from "@/decisions/model";
import { Button, fieldBox } from "../controls";
import { ago } from "../time";
import { saveWhy } from "./list";

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * One decision: what was decided and when, who proposed it, its why (or a way to add one), and,
 * opened, what the card rested on that day, or what Qalam AI proposed.
 */
export default function DecisionRow({ d, board }: { d: Decision; board?: { name: string; href?: string } | null }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const proposals = Array.isArray(d.detail?.proposals) ? (d.detail.proposals as { line?: string; why?: string }[]).filter((p) => typeof p.line === "string") : [];
  const facts = [d.by === "qalam" ? `Qalam AI proposed it, ${d.who ?? "you"} accepted` : d.who ? `By ${d.who}` : null, d.undone ? "Undone" : null].filter(Boolean).join(" · ");
  return (
    <article className="group/decision flex flex-col gap-[2px] py-[6px]">
      <div className="flex items-baseline gap-[8px]">
        <p className={clsx("min-w-0 flex-1 text-caption", d.undone ? "text-fg-subtle line-through" : "text-fg")} dir="auto">
          {d.what}
        </p>
        <time dateTime={new Date(d.at).toISOString()} title={new Date(d.at).toLocaleString()} className="shrink-0 text-micro text-fg-subtle tnum">
          {ago(d.at)}
        </time>
      </div>
      {(facts || board) && (
        <p className="flex min-w-0 items-center gap-[4px] text-micro text-fg-subtle">
          {board?.href ? (
            <a href={board.href} className="min-w-0 truncate hover:text-fg hover:underline">
              {board.name}
            </a>
          ) : (
            board && <span className="min-w-0 truncate">{board.name}</span>
          )}
          {board && facts && <span aria-hidden>·</span>}
          {facts && <span className="truncate">{facts}</span>}
        </p>
      )}
      {editing ? (
        <WhyEditor d={d} onDone={() => setEditing(false)} />
      ) : d.why ? (
        <button type="button" className="self-start text-left text-caption text-fg-muted hover:text-fg" title="Edit the why" onClick={() => setEditing(true)} dir="auto">
          <span className="text-fg-subtle">Why: </span>
          {d.why}
        </button>
      ) : (
        !d.undone && (
          <button
            type="button"
            className={clsx("self-start text-caption text-fg-subtle hover:text-fg focus-visible:opacity-100", !d.big && "opacity-0 group-hover/decision:opacity-100")}
            onClick={() => setEditing(true)}
          >
            Add why
          </button>
        )
      )}
      {(d.knew || proposals.length > 0) && (
        <button type="button" aria-expanded={open} className="flex items-center gap-[4px] self-start text-micro text-fg-subtle hover:text-fg" onClick={() => setOpen(!open)}>
          <ChevronRight {...ICON} className={clsx("transition-transform", open && "rotate-90")} />
          {d.knew ? "What we knew then" : `What Qalam AI proposed · ${proposals.length}`}
        </button>
      )}
      {open && d.knew && <KnewThen k={d.knew} />}
      {open && !d.knew && (
        <ul className="flex flex-col gap-[4px] pl-[16px]">
          {proposals.map((p, i) => (
            <li key={i} className="text-caption text-fg-muted" dir="auto">
              {p.line}
              {p.why && <span className="block text-micro text-fg-subtle">{p.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function KnewThen({ k }: { k: NonNullable<Decision["knew"]> }) {
  const facts = [k.evidence, k.against && !/against/.test(k.evidence) ? `${k.against} against` : "", k.metric ? metricText(k.metric) : "", k.children ? `${k.children} ${k.children === 1 ? "card" : "cards"} under it` : ""].filter(Boolean);
  return (
    <div className="flex flex-col gap-[4px] pl-[16px]">
      {facts.length > 0 && <p className="text-micro text-fg-muted">{facts.join(" · ")}</p>}
      {k.pieces.map((p, i) => (
        <blockquote key={i} className="text-caption text-fg-muted" dir="auto">
          “{p.text}”{p.from && <span className="text-micro text-fg-subtle"> · {p.from}</span>}
        </blockquote>
      ))}
      {k.tests?.map((t, i) => (
        <p key={i} className="text-micro text-fg-muted">
          Test “{t.title}” · {t.stage}
        </p>
      ))}
    </div>
  );
}

function WhyEditor({ d, onDone }: { d: Decision; onDone: () => void }) {
  const [text, setText] = useState(d.why ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (text.trim() === (d.why ?? "")) return onDone();
    setBusy(true);
    try {
      await saveWhy(d.id, text);
      onDone();
    } catch {
      feedback("Couldn't save the why", { kind: "error", id: "decisions.why" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-center gap-[6px] pt-[2px]"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={`${fieldBox} flex-1 px-[8px]`}>
        <input
          autoFocus
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
          value={text}
          maxLength={500}
          dir="auto"
          placeholder="Why? One line"
          aria-label="Why"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onDone();
          }}
        />
      </label>
      <Button size="sm" type="submit" disabled={busy}>
        Save
      </Button>
    </form>
  );
}
