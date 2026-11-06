import { useEffect, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Pencil, Plus, X } from "lucide-react";
import type { Term } from "@/terms/types";
import { editTerm, loadTerms, useTerms } from "@/org/terms";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";

/*
 * The project's words in the Company panel (hub/terms.md): each term, what it means, and the words
 * to avoid for it. A person adds, fixes or takes one off; one Qalam AI proposed shows here once they
 * keep it. Qalam AI uses them, and asks when a word is used two ways.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

interface Draft {
  term: string;
  means: string;
  avoid: string[];
}

const avoidOf = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** A term's three parts as they're written: Enter in the last keeps them, Esc lets them go. */
function TermForm({ start, onDone }: { start?: Draft; onDone: (d: Draft | null) => void }) {
  const [term, setTerm] = useState(start?.term ?? "");
  const [means, setMeans] = useState(start?.means ?? "");
  const [avoid, setAvoid] = useState(start?.avoid.join(", ") ?? "");
  const ready = term.trim() && means.trim();
  const keep = () => onDone(ready ? { term: term.trim(), means: means.trim(), avoid: avoidOf(avoid) } : null);
  const keys = (e: KeyboardEvent, last: boolean) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDone(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && last) {
      e.preventDefault();
      keep();
    }
  };
  return (
    <div className="q-sheet flex flex-col gap-[6px] rounded-lg p-[8px]">
      <label className={r.field}>
        <input aria-label="The word" autoFocus dir="auto" placeholder="The word, e.g. Basket" className={r.fieldInput} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => keys(e, false)} />
      </label>
      <textarea aria-label="What it means" rows={2} dir="auto" placeholder="What it is, in a sentence" className={clsx(r.textarea, "w-full text-body")} value={means} onChange={(e) => setMeans(e.target.value)} onKeyDown={(e) => keys(e, false)} />
      <label className={r.field}>
        <input aria-label="Words to avoid" dir="auto" placeholder="Words to avoid, with commas (optional)" className={r.fieldInput} value={avoid} onChange={(e) => setAvoid(e.target.value)} onKeyDown={(e) => keys(e, true)} />
      </label>
      <div className="flex items-center justify-end gap-[6px]">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready} onClick={keep}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function TermLine({ term }: { term: Term }) {
  const [fixing, setFixing] = useState(false);
  if (fixing)
    return (
      <TermForm
        start={term}
        onDone={(d) => {
          setFixing(false);
          if (d) void editTerm({ op: "fix", id: term.id, term: d.term, means: d.means, avoid: d.avoid });
        }}
      />
    );
  return (
    <div className="group relative flex flex-col gap-[2px]">
      <p className="text-body leading-[20px] text-fg" dir="auto">
        <span className="font-medium">{term.term}</span> <span className="text-fg-muted">{term.means}</span>
      </p>
      {term.avoid.length > 0 && (
        <p className="text-micro text-fg-subtle" dir="auto">
          Avoid: {term.avoid.join(", ")}
        </p>
      )}
      <span className="absolute top-0 right-0 flex items-center gap-[2px] rounded-md bg-app opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconBtn size="sm" label={`Fix ${term.term}`} onClick={() => setFixing(true)}>
          <Pencil size={12} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label={`Take off ${term.term}`} onClick={() => void editTerm({ op: "remove", id: term.id })}>
          <X size={12} {...ICON} />
        </IconBtn>
      </span>
    </div>
  );
}

export function WordsGroup() {
  const { terms, loaded, error } = useTerms();
  const [adding, setAdding] = useState(false);
  useEffect(() => void loadTerms(), []);
  return (
    <section aria-labelledby="space-words" className="flex flex-col gap-[8px]">
      <div className="flex h-[24px] items-center justify-between gap-[8px]">
        <h3 id="space-words" className={r.sectionTitle}>
          Words
        </h3>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={14} {...ICON} className="mr-[4px]" />
            Add a word
          </Button>
        )}
      </div>
      <p className="text-caption text-fg-muted">The project&apos;s own words. Qalam AI uses them, and asks when one is used two ways.</p>
      {loaded && !terms.terms.length && !adding && <p className="text-caption text-fg-subtle">Nothing yet. A word you settle while Qalam AI asks you something is offered here.</p>}
      {terms.terms.map((t) => (
        <TermLine key={t.id} term={t} />
      ))}
      {adding && (
        <TermForm
          onDone={(d) => {
            setAdding(false);
            if (d) void editTerm({ op: "add", ...d });
          }}
        />
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
