import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { r } from "../recipes";
import { Dictated } from "../voice/MicButton";

/**
 * Text fields for the card panel that save when you leave them (↵ in a one-line field, or a
 * click away), so an edit is one undo step rather than one per keystroke.
 */

export function CommitInput({ value, onCommit, placeholder, ariaLabel, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; ariaLabel: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => v !== value && onCommit(v);
  return (
    <div className={clsx(r.field, className)}>
      <input
        aria-label={ariaLabel}
        className={r.fieldInput}
        value={v}
        placeholder={placeholder}
        dir="auto"
        onChange={(e) => setV(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setV(value);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </div>
  );
}

/** Saves on leave (or ⌘↵); Esc takes it back. `voice`: the mic in its corner (what was said is saved on leave, like typing). */
export function CommitArea({ value, onCommit, placeholder, ariaLabel, rows = 2, voice }: { value: string; onCommit: (v: string) => void; placeholder?: string; ariaLabel: string; rows?: number; voice?: boolean }) {
  const [v, setV] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  const area = (
    <textarea
      ref={box}
      aria-label={ariaLabel}
      className={clsx(r.textarea, "text-body")}
      rows={rows}
      value={v}
      placeholder={placeholder}
      dir="auto"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur());
        }
      }}
    />
  );
  return voice ? (
    <Dictated field={box} set={setV}>
      {area}
    </Dictated>
  ) : (
    area
  );
}

/** A number field that saves on leave; empty means "not known yet". */
export function CommitNumber({ value, onCommit, ariaLabel, placeholder }: { value: number | null; onCommit: (v: number | null) => void; ariaLabel: string; placeholder?: string }) {
  const show = (n: number | null) => (n === null ? "" : String(n));
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value]);
  return (
    <div className={r.field}>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        className={clsx(r.fieldInput, "tnum")}
        value={v}
        placeholder={placeholder ?? "—"}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const t = v.trim().replace(",", ".");
          const n = t === "" ? null : Number(t);
          if (n !== null && !Number.isFinite(n)) return setV(show(value));
          if (n !== value) onCommit(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}
