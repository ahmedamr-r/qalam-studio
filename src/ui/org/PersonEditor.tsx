import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { create } from "zustand";
import { feedback } from "@/commands/feedback";
import type { Person } from "@/hub/people";
import { knownSegments, newPerson, removePerson, savePerson } from "@/org/people";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";

/**
 * A person the organization hears from: their name, the kinds of customer they are (the
 * organization's and its products' segments, or one of their own), what they do, notes. Saved as
 * people/<slug>.md. Opened from a source (who said it) and from the home's People tab.
 */

type Open = { person: Person | null; name?: string; product?: string | null; resolve: (p: Person | null) => void };

const useEditor = create<{ open: Open | null }>(() => ({ open: null }));

/** Edit a person, or make one (named `name`): resolves the person as saved, or null when cancelled. */
export function editPerson(person: Person | null, opts: { name?: string; product?: string | null } = {}): Promise<Person | null> {
  return new Promise((resolve) => useEditor.setState({ open: { person, ...opts, resolve } }));
}

/** The editor, as a dialog. Mount once (the home, and the studio's surfaces). */
export function PersonEditorHost() {
  const open = useEditor((s) => s.open);
  if (!open) return null;
  const close = (p: Person | null) => {
    open.resolve(p);
    useEditor.setState({ open: null });
  };
  return <Editor key={open.person?.id ?? "new"} open={open} onClose={close} />;
}

function Editor({ open, onClose }: { open: Open; onClose: (p: Person | null) => void }) {
  const start = open.person;
  const [name, setName] = useState(start?.name ?? open.name ?? "");
  const [segments, setSegments] = useState<string[]>(start?.segments ?? []);
  const [other, setOther] = useState("");
  const [role, setRole] = useState(start?.role ?? "");
  const [notes, setNotes] = useState(start?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const known = [...new Set([...knownSegments(open.product), ...segments])];

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => before?.focus({ preventScroll: true });
  }, []);

  const toggle = (s: string) => setSegments((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const save = async () => {
    if (!name.trim()) return;
    const extra = other.trim() && !segments.some((s) => s.toLowerCase() === other.trim().toLowerCase()) ? [other.trim()] : [];
    const p: Person = { ...(start ?? newPerson(name)), name: name.replace(/\s+/g, " ").trim(), segments: [...segments, ...extra] };
    if (role.trim()) p.role = role.trim();
    else delete p.role;
    if (notes.trim()) p.notes = notes.trim();
    else delete p.notes;
    setBusy(true);
    try {
      await savePerson(p);
      onClose(p);
    } catch (e) {
      feedback(`Couldn't save them: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "org.person" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!start) return;
    const ok = await confirmDialog({ title: `Forget ${start.name}?`, body: "What they said stays in its sources, as an unnamed voice. Their file is deleted.", confirmLabel: "Forget them", danger: true });
    if (!ok) return;
    await removePerson(start.id);
    onClose(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(null);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  const title = start ? start.name : "New person";
  return (
    <>
      <div data-state="open" className={clsx(r.overlay, "z-[70]")} onPointerDown={() => onClose(null)} aria-hidden />
      <div ref={card} role="dialog" aria-modal="true" aria-label={title} data-state="open" onKeyDown={onKeyDown} className={clsx(r.modal, "fixed left-1/2 top-[10vh] z-[71] flex max-h-[80vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden outline-none")}>
        <div className="flex flex-col gap-[14px] overflow-y-auto px-[20px] pt-[18px] pb-[16px]">
          <h2 className="text-title font-semibold text-fg">{title}</h2>
          <p className="text-body text-fg-muted">Someone the organization hears from. Saying who said what lets Qalam count people, not quotes, and tell segments apart.</p>
          <label className="flex flex-col gap-[4px]">
            <span className="text-caption font-medium text-fg">Name</span>
            <span className={clsx(r.field, "h-[32px]")}>
              <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sara Ahmed" className={clsx(r.fieldInput, "text-body")} />
            </span>
          </label>
          <fieldset className="flex flex-col gap-[6px]">
            <legend className="mb-[4px] text-caption font-medium text-fg">Segments</legend>
            {known.length > 0 && (
              <div className="flex flex-wrap gap-[6px]">
                {known.map((s) => (
                  <button key={s} type="button" aria-pressed={segments.includes(s)} onClick={() => toggle(s)} className={clsx("q-item h-[26px] rounded-md px-[8px] text-caption font-medium", segments.includes(s) ? "bg-inverse text-fg-inverse" : "bg-raised text-fg-muted shadow-button hover:text-fg")}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <span className={clsx(r.field, "h-[28px]")}>
              <input aria-label="Another segment" value={other} onChange={(e) => setOther(e.target.value)} placeholder={known.length ? "Another segment" : "A kind of customer, like “Parents of young children”"} className={clsx(r.fieldInput, "text-caption")} />
            </span>
          </fieldset>
          <label className="flex flex-col gap-[4px]">
            <span className="text-caption font-medium text-fg">What they do</span>
            <span className={clsx(r.field, "h-[32px]")}>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Office manager at a 40-person startup" className={clsx(r.fieldInput, "text-body")} />
            </span>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-caption font-medium text-fg">Notes</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={r.textarea} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-[8px] border-t border-line-subtle bg-muted px-[16px] py-[12px]">
          <span>
            {start && (
              <button type="button" onClick={() => void remove()} className={clsx(r.button, r.buttonGhost, "text-danger hover:text-danger")}>
                Forget them…
              </button>
            )}
          </span>
          <span className="flex items-center gap-[8px]">
            <button type="button" onClick={() => onClose(null)} className={clsx(r.button, r.buttonSecondary)}>
              Cancel
            </button>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className={clsx(r.button, r.buttonPrimary)}>
              Save
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
