import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowUp, X } from "lucide-react";
import { create } from "zustand";
import { feedback } from "@/commands/feedback";
import { contextEmpty, goalId, type ContextFields, type OrgGoal, type Product } from "@/org/context-md";
import { removeProduct, saveAbout, saveProduct } from "@/org/context";
import { Button } from "../controls";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";

/**
 * What a product, or the organization, is: who it's for, what the team is trying to move (the
 * goal that leads first, each with how it's measured, by when and whose it is), how it means to
 * win, what customers use instead, what it won't do, the rest worth knowing. Shown on the home and
 * given to Qalam AI with every board that's for it. Saved as Markdown (products/<slug>.md,
 * about.md), so it can be edited there too.
 */

type Target = { kind: "product"; product: Product } | { kind: "org"; name: string; about: ContextFields };

const useEditor = create<{ target: Target | null }>(() => ({ target: null }));
export const editContext = (target: Target) => useEditor.setState({ target });

const lines = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** A goal's details in a line ("Measured by weekly reorders · by March · owner: Sara"). */
export const goalDetails = (g: OrgGoal) => [g.measure?.trim() && `Measured by ${g.measure.trim()}`, g.by?.trim() && `by ${g.by.trim()}`, g.owner?.trim() && `owner: ${g.owner.trim()}`].filter(Boolean).join(" · ");

function Fields({ c }: { c: ContextFields }) {
  const rows: [string, ReactNode][] = [];
  if (c.audience.trim()) rows.push(["Who it's for", c.audience]);
  if (c.goals.length)
    rows.push([
      "Goals",
      <ol key="g" className="flex flex-col gap-[4px]">
        {c.goals.map((g, i) => (
          <li key={g.id} className="flex flex-col">
            <span>
              {g.text}
              {i === 0 && c.goals.length > 1 && <span className="ml-[6px] text-caption text-fg-subtle">leads</span>}
            </span>
            {goalDetails(g) && <span className="text-caption text-fg-muted">{goalDetails(g)}</span>}
          </li>
        ))}
      </ol>,
    ]);
  if (c.strategy?.trim()) rows.push(["Strategy", c.strategy]);
  if (c.context.trim()) rows.push(["Context", c.context]);
  if (c.segments.length) rows.push(["Segments", c.segments.join(" · ")]);
  if (c.alternatives?.length) rows.push(["Instead, customers use", c.alternatives.join(" · ")]);
  if (c.constraints?.length)
    rows.push([
      "Constraints",
      <ul key="c" className="flex flex-col gap-[2px]">
        {c.constraints.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>,
    ]);
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

const isEmpty = contextEmpty;

/** A goal as the editor holds it: its id kept while its words change, so boards stay linked to it. */
type GoalDraft = OrgGoal & { key: string };
const draftOf = (g: OrgGoal, i: number): GoalDraft => ({ ...g, key: `${g.id}:${i}` });

/** The goals, the one that leads first: each with how it's measured, by when, and whose it is. */
function GoalsEditor({ goals, onChange }: { goals: GoalDraft[]; onChange: (g: GoalDraft[]) => void }) {
  const set = (i: number, patch: Partial<OrgGoal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const small = (i: number, k: "measure" | "by" | "owner", placeholder: string, label: string) => (
    <span className={clsx(r.field, "h-[28px]")}>
      <input aria-label={`${label}, goal ${i + 1}`} value={goals[i][k] ?? ""} placeholder={placeholder} onChange={(e) => set(i, { [k]: e.target.value })} className={clsx(r.fieldInput, "text-caption")} />
    </span>
  );
  return (
    <div className="flex flex-col gap-[10px]">
      {goals.map((g, i) => (
        <div key={g.key} className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[4px]">
            <span className="w-[16px] shrink-0 text-caption text-fg-subtle tnum">{i + 1}</span>
            <span className={clsx(r.field, "h-[32px] flex-1")}>
              <input aria-label={`Goal ${i + 1}`} value={g.text} placeholder={i === 0 ? "More families reorder every week" : "Another goal"} onChange={(e) => set(i, { text: e.target.value })} className={clsx(r.fieldInput, "text-body")} />
            </span>
            <button type="button" aria-label={`Make goal ${i + 1} lead`} title="Make it lead" disabled={i === 0} onClick={() => onChange([g, ...goals.filter((_, j) => j !== i)])} className={clsx(r.iconButtonSm, "disabled:opacity-40")}>
              <ArrowUp size={14} absoluteStrokeWidth strokeWidth={1.25} />
            </button>
            <button type="button" aria-label={`Remove goal ${i + 1}`} title="Remove" onClick={() => onChange(goals.filter((_, j) => j !== i))} className={r.iconButtonSm}>
              <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
            </button>
          </div>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-[4px] pl-[20px] pr-[56px]">
            {small(i, "measure", "Measured by", "How it's measured")}
            {small(i, "by", "By when", "By when")}
            {small(i, "owner", "Owner", "Owner")}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...goals, { id: "", text: "", key: `new:${Date.now()}:${goals.length}` }])} className={clsx(r.buttonSm, r.buttonGhost, "self-start")}>
        Add a goal
      </button>
    </div>
  );
}

/** The goals as saved: blank ones left out, a new one named by its words, each id once. */
function goalsOut(drafts: GoalDraft[]): OrgGoal[] {
  const seen = new Set<string>();
  const out: OrgGoal[] = [];
  for (const { key: _k, ...g } of drafts) {
    const text = g.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    let id = g.id || goalId(text);
    if (seen.has(id)) id = `${goalId(text)}-${out.length + 1}`;
    seen.add(id);
    const tidy = (v?: string) => v?.replace(/\s+/g, " ").trim() || undefined;
    const goal: OrgGoal = { id, text };
    for (const k of ["measure", "by", "owner"] as const) if (tidy(g[k])) goal[k] = tidy(g[k]);
    if (g.more?.trim()) goal.more = g.more;
    out.push(goal);
  }
  return out;
}

/** The card on the home: what this product (or the organization) is, and the way to edit it. */
export function ContextCard({ title, context, onEdit, empty }: { title: string; context: ContextFields; onEdit: () => void; empty: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-[12px] rounded-lg bg-panel p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center justify-between gap-[12px]">
        <h2 className="text-title font-medium text-fg">{title}</h2>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          {isEmpty(context) ? "Describe it" : "Edit"}
        </Button>
      </div>
      {isEmpty(context) ? <p className="text-body text-fg-muted">{empty}</p> : <Fields c={context} />}
    </section>
  );
}

/** The editor, as a dialog over the home. Mount once. */
export function ContextEditorHost() {
  const target = useEditor((s) => s.target);
  if (!target) return null;
  return <Editor key={target.kind === "product" ? target.product.id : "org"} target={target} onClose={() => useEditor.setState({ target: null })} />;
}

function Editor({ target, onClose }: { target: Target; onClose: () => void }) {
  const start = target.kind === "product" ? target.product : target.about;
  const [name, setName] = useState(target.kind === "product" ? target.product.name : target.name);
  const [audience, setAudience] = useState(start.audience);
  const [goals, setGoals] = useState<GoalDraft[]>(() => start.goals.map(draftOf));
  const [strategy, setStrategy] = useState(start.strategy ?? "");
  const [context, setContext] = useState(start.context);
  const [segments, setSegments] = useState(start.segments.join("\n"));
  const [alternatives, setAlternatives] = useState((start.alternatives ?? []).join("\n"));
  const [constraints, setConstraints] = useState((start.constraints ?? []).join("\n"));
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
    const fields: ContextFields = {
      ...(target.kind === "product" ? target.product : target.about),
      audience: audience.trim(),
      goals: goalsOut(goals),
      strategy: strategy.trim(),
      context: context.trim(),
      segments: lines(segments),
      alternatives: lines(alternatives),
      constraints: lines(constraints),
    };
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
          <div className="flex flex-col gap-[4px]">
            <span className="text-caption font-medium text-fg">Goals</span>
            <span className="text-micro text-fg-subtle">What the team is trying to move, the one that leads first. Boards say which goal their outcome serves.</span>
            <GoalsEditor goals={goals} onChange={setGoals} />
          </div>
          {field("Strategy", "How it means to win: the bets you're making.", area(strategy, setStrategy, 3))}
          {field("Context", "The market, the business: anything a new teammate should know.", area(context, setContext, 4))}
          {field("Segments", "Kinds of customers worth telling apart. One per line.", area(segments, setSegments, 2))}
          {field("What customers use instead", "Competitors, workarounds, doing nothing. One per line.", area(alternatives, setAlternatives, 2))}
          {field("Constraints", "What you won't do, or can't: budgets, rules, markets you stay out of. One per line.", area(constraints, setConstraints, 2))}
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
