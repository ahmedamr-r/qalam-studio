import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, RotateCcw, Scale } from "lucide-react";
import type { Challenge, ChallengeRun } from "@/challenge/types";
import type { Proposal } from "@/discovery/proposals";
import { r } from "../recipes";
import { decide, keptChallenges, shownChallenges } from "./challenges";
import { frameReview, useReview } from "./review";
import { openSource } from "./sources";

/*
 * What the project's own evidence says against what's under review, beside the proposals: each
 * challenge in a line, the proposals it's on, what it rests on (the source's own words, opening the
 * source there), what would settle it, and Keep · Change · Drop. What's kept goes onto the cards
 * they accept; what's dropped isn't raised again from the same evidence.
 */

const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

const titleOf = (id: string, proposals: readonly Proposal[]) => {
  const p = proposals.find((x) => x.id === id);
  return p?.kind === "card" || p?.kind === "goal" ? p.card.title : "";
};

/** The challenges on a round of proposals, with what to do about each; `again` proposes again with what was kept. */
export function ChallengeList({ run, again, className }: { run: ChallengeRun; again?: { label: string; go: () => void }; className?: string }) {
  const proposals = useReview((s) => s.proposals);
  const shown = shownChallenges(run);
  const dropped = run.challenges.length - shown.length;
  if (!run.challenges.length) return null;
  const kept = keptChallenges(run);
  return (
    <div className={clsx("q-sheet flex w-full flex-col gap-[10px] rounded-xl p-[14px]", className)} data-challenges>
      <p className="flex items-center gap-[6px] text-caption font-medium text-fg-muted">
        <Scale {...SMALL} /> What your own evidence says
      </p>
      {shown.map((c) => (
        <Row key={c.id} c={c} proposals={proposals} />
      ))}
      {dropped > 0 && (
        <p className="flex flex-wrap items-center gap-[6px] text-caption text-fg-subtle">
          {dropped === 1 ? "One you dropped" : `${dropped} you dropped`}: not raised again from the same evidence.
          <button type="button" className="inline-flex items-center gap-[2px] hover:text-fg" onClick={() => run.challenges.filter((c) => c.state === "dropped").forEach((c) => void decide(c.id, null))}>
            <RotateCcw {...SMALL} /> Bring {dropped === 1 ? "it" : "them"} back
          </button>
        </p>
      )}
      {again && kept.length > 0 && (
        <div>
          <button type="button" className={r.replyChip} onClick={again.go}>
            {again.label}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ c, proposals }: { c: Challenge; proposals: readonly Proposal[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const on = c.on.map((id) => ({ id, title: titleOf(id, proposals) })).filter((x) => x.title);
  const cardIds = (ids: string[]) => proposals.flatMap((p) => (ids.includes(p.id) ? [p.cardId] : []));
  const settled = c.state === "kept" || c.state === "changed";
  return (
    <div className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" data-challenge={c.kind}>
      {editing !== null ? (
        <textarea className="min-h-[60px] w-full resize-y rounded-md bg-raised p-[8px] text-body leading-[20px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)]" value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="The challenge, in your words" dir="auto" />
      ) : (
        <p className="text-body leading-[20px] text-fg" dir="auto">
          {c.words ?? c.line}
          {c.state === "changed" && <span className="text-caption text-fg-muted"> · your words</span>}
        </p>
      )}
      {on.length > 0 ? (
        <p className="flex flex-wrap items-center gap-[4px] text-caption text-fg-muted">
          On
          {on.map((x) => (
            <button key={x.id} type="button" className="max-w-[220px] truncate rounded-sm bg-active px-[6px] text-micro font-medium text-fg-muted hover:text-fg" title="Show it on the canvas" onClick={() => frameReview(cardIds([x.id]))}>
              {x.title}
            </button>
          ))}
        </p>
      ) : (
        <p className="text-caption text-fg-muted">On what's proposed as a whole.</p>
      )}
      {c.settle && (
        <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
          To settle it: {c.settle}
        </p>
      )}
      <button type="button" aria-expanded={open} className="flex items-center gap-[4px] self-start text-caption text-fg-subtle hover:text-fg" onClick={() => setOpen(!open)}>
        What it rests on
        <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("q-chevron", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="flex flex-col gap-[4px]">
          {c.cites.map((x, i) => (
            <li key={i} className="text-caption leading-[18px] text-fg" dir="auto">
              <span className="text-fg-subtle">
                {x.whose} · {x.from}:{" "}
              </span>
              {x.sourceId ? (
                <button type="button" className="text-left hover:underline" onClick={() => openSource(x.sourceId!, x.quoteId)}>
                  “{x.text}”
                </button>
              ) : (
                <>“{x.text}”</>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== null ? (
        <div className="flex flex-wrap items-center gap-[4px]">
          <button
            type="button"
            className={r.replyChipPrimary}
            disabled={!editing.trim()}
            onClick={() => {
              void decide(c.id, "changed", editing.trim());
              setEditing(null);
            }}
          >
            Keep it in these words
          </button>
          <button type="button" className={r.replyChip} onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      ) : settled ? (
        <p className="flex flex-wrap items-center gap-[6px] text-caption text-fg-muted">
          {c.on.length ? "Kept: it goes onto the cards you accept, with what it rests on." : "Kept."}
          <button type="button" className="inline-flex items-center gap-[2px] text-fg-subtle hover:text-fg" onClick={() => void decide(c.id, null)}>
            <RotateCcw {...SMALL} /> Undo
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-[4px]">
          <button type="button" className={r.replyChip} onClick={() => void decide(c.id, "kept")}>
            Keep
          </button>
          <button type="button" className={r.replyChip} onClick={() => setEditing(c.words ?? c.line)}>
            Change
          </button>
          <button type="button" className={r.replyChip} onClick={() => void decide(c.id, "dropped")}>
            Drop
          </button>
        </div>
      )}
    </div>
  );
}

/** How many challenges are on these proposals, for a proposal's bar on the canvas. */
export const challengesOn = (run: ChallengeRun | null, ids: readonly string[]) => shownChallenges(run).filter((c) => c.on.some((id) => ids.includes(id)));
