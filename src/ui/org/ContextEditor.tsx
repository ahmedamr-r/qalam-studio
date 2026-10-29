import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { create } from "zustand";
import { feedback } from "@/commands/feedback";
import type { ContextFields, Product } from "@/org/context-md";
import { removeProduct, saveAbout, saveProduct } from "@/org/context";
import { Button } from "../controls";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";

/**
 * What a product, or the organization, is: who it's for, its segments, the rest worth knowing.
 * Shown on the home and given to Qalam AI with every board that's for it. Saved as Markdown
 * (products/<slug>.md, about.md), so it can be edited there too. What it's trying to move is in
 * the goal tree (goals.md).
 */

type Target = { kind: "product"; product: Product } | { kind: "org"; name: string; about: ContextFields };

const useEditor = create<{ target: Target | null; closed?: () => void }>(() => ({ target: null }));
/** Open the editor; settles once it closes (saved, deleted or left). */
export const editContext = (target: Target) => new Promise<void>((closed) => useEditor.setState({ target, closed }));

const lines = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function Fields({ c }: { c: ContextFields }) {
  const rows: [string, ReactNode][] = [];
  if (c.audience.trim()) rows.push(["Who it's for", c.audience]);
  if (c.context.trim()) rows.push(["Context", c.context]);
  if (c.segments.length) rows.push(["Segments", c.segments.join(" · ")]);
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-[16px] gap-y-[8px] text-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-caption text-fg-subtle">{k}</dt>
          <dd className="whitespace-pre-wrap text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const isEmpty = (c: ContextFields) => !c.audience.trim() && !c.context.trim() && !c.segments.length;

/**
 * The card on the home: what this product (or the organization) is, in one line (who it's for,
 * and its segments as chips); the rest opens on a click. Edit opens the editor.
 */
export function ContextCard({ title, context, onEdit, empty }: { title: string; context: ContextFields; onEdit: () => void; empty: string }) {
  const [open, setOpen] = useState(false);
  const none = isEmpty(context);
  const line = context.audience.trim() || context.context.trim();
  return (
    <section aria-label={title} className="flex flex-col gap-[10px] rounded-lg bg-panel px-[16px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[12px]">
        <button type="button" aria-expanded={open} disabled={none} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-[10px] text-left">
          <h2 className="shrink-0 text-title font-medium text-fg">{title}</h2>
          <span className="min-w-0 truncate text-caption text-fg-muted">{none ? empty : open ? "" : line}</span>
          {!open && !!context.segments.length && (
            <span className="hidden shrink-0 items-center gap-[4px] md:flex">
              {context.segments.slice(0, 3).map((g) => (
                <span key={g} className={r.chip}>
                  {g}
                </span>
              ))}
            </span>
          )}
        </button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          {none ? "Describe it" : "Edit"}
        </Button>
      </div>
      {open && !none && <Fields c={context} />}
    </section>
  );
}

/** The editor, as a dialog over the home. Mount once. */
export function ContextEditorHost() {
  const target = useEditor((s) => s.target);
  if (!target) return null;
  const close = () => {
    useEditor.getState().closed?.();
    useEditor.setState({ target: null, closed: undefined });
  };
  return <Editor key={target.kind === "product" ? target.product.id : "org"} target={target} onClose={close} />;
}

function Editor({ target, onClose }: { target: Target; onClose: () => void }) {
  const start = target.kind === "product" ? target.product : target.about;
  const [name, setName] = useState(target.kind === "product" ? target.product.name : target.name);
  const [audience, setAudience] = useState(start.audience);
  const [context, setContext] = useState(start.context);
  const [segments, setSegments] = useState(start.segments.join("\n"));
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const title = target.kind === "product" ? "Product" : `About ${target.name}`;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => before?.focus({ preventScroll: true });
  }, []);

  const save = async () => {
    const fields: ContextFields = { ...(target.kind === "product" ? target.product : target.about), audience: audience.trim(), context: context.trim(), segments: lines(segments) };
    setBusy(true);
    try {
      if (target.kind === "product") {
        if (!name.trim()) return;
        await saveProduct({ ...target.product, ...fields, name: name.trim() });
      } else await saveAbout(fields);
      onClose();
    } catch (e) {
      feedback(`Couldn't save it: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "org.context" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (target.kind !== "product") return;
    const ok = await confirmDialog({ title: `Delete “${target.product.name}”?`, body: "Its boards and sources stay, for the whole organization. Its description is deleted.", confirmLabel: "Delete product", danger: true });
    if (!ok) return;
    await removeProduct(target.product.id);
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    } else if (e.key === "Tab") {
      const items = [...(card.current?.querySelectorAll<HTMLElement>("input, textarea, button:not([disabled])") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next]?.focus();
    }
  };

  const field = (label: string, hint: string, el: ReactNode) => (
    <label className="flex flex-col gap-[4px]">
      <span className="text-caption font-medium text-fg">{label}</span>
      {el}
      <span className="text-micro text-fg-subtle">{hint}</span>
    </label>
  );
  const area = (value: string, set: (v: string) => void, rows: number, ref?: typeof first) => <textarea ref={ref} rows={rows} value={value} onChange={(e) => set(e.target.value)} className={r.textarea} />;

  return (
    <>
      <div data-state="open" className={clsx(r.overlay, "z-[70]")} onPointerDown={onClose} aria-hidden />
      <div ref={card} role="dialog" aria-modal="true" aria-label={title} data-state="open" onKeyDown={onKeyDown} className={clsx(r.modal, "fixed left-1/2 top-[8vh] z-[71] flex max-h-[84vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden outline-none")}>
        <div className="flex flex-col gap-[14px] overflow-y-auto px-[20px] pt-[18px] pb-[16px]">
          <h2 className="text-title font-semibold text-fg">{title}</h2>
          <p className="text-body text-fg-muted">Qalam AI reads this with every board that's for {target.kind === "product" ? "this product" : "the whole organization"}. It's saved as Markdown in the organization's folder.</p>
          {target.kind === "product" &&
            field(
              "Name",
              "",
              <span className={clsx(r.field, "h-[32px]")}>
                <input ref={first} value={name} onChange={(e) => setName(e.target.value)} className={clsx(r.fieldInput, "text-body")} />
              </span>,
            )}
          {field("Who it's for", "The customers it serves, in a sentence or two.", area(audience, setAudience, 2, target.kind === "org" ? first : undefined))}
          {field("Context", "The market, the business, constraints: anything a new teammate should know.", area(context, setContext, 4))}
          {field("Segments", "Kinds of customers worth telling apart. One per line.", area(segments, setSegments, 2))}
        </div>
        <div className="flex items-center justify-between gap-[8px] border-t border-line-subtle bg-muted px-[16px] py-[12px]">
          <span>
            {target.kind === "product" && (
              <button type="button" onClick={() => void remove()} className={clsx(r.button, r.buttonGhost, "text-danger hover:text-danger")}>
                Delete product…
              </button>
            )}
          </span>
          <span className="flex items-center gap-[8px]">
            <button type="button" onClick={onClose} className={clsx(r.button, r.buttonSecondary)}>
              Cancel
            </button>
            <button type="button" disabled={busy || (target.kind === "product" && !name.trim())} onClick={() => void save()} className={clsx(r.button, r.buttonPrimary)}>
              Save
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
