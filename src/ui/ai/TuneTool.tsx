import { noteTuneApplied, noteTuneUndone } from "../knowledge/record";
import { useState } from "react";
import clsx from "clsx";
import { Check, CircleAlert, Hexagon, Minus, MoveRight, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { getSystem, useSystems } from "@/design-system/registry";
import { guidanceLabel } from "@/design-system/tune";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r } from "../recipes";
import { Button, Checkbox, Swatch, Tag } from "../controls";
import { ErrorNote } from "./common";
import { boundRoots, moveScreens } from "../workspace/editing";
import { patchTurn, send, useChats } from "./chats";
import type { ChatTurn } from "./chatTypes";
import { applyTune, undoTune, type ProposedChange, type TuneOutcome } from "./tune";

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
/** A filled note (the diagnosis, the sample notice). */
const noteBox = "rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
/** Something to look at (always with its icon). */
const warnBox = "flex items-start gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-fg [&>svg]:mt-[2px] [&>svg]:shrink-0 [&>svg]:text-warning";
/** Applied. */
const doneBox = "flex flex-col gap-[8px] rounded-lg bg-success-subtle px-[10px] py-[10px] text-caption text-fg";
const quietBtn = "q-item inline-flex h-[22px] shrink-0 items-center rounded-sm px-[6px] text-caption font-medium text-fg-muted hover:bg-hover hover:text-fg";

/** Qalam AI's proposed changes to a design system: pick and apply them (screens on the system follow at once), or undo. */
export function TuneView({ chatId, t, o, sample }: { chatId: string; t: ChatTurn; o: TuneOutcome; sample: boolean }) {
  const doc = useStudio((s) => s.doc);
  useSystems((s) => s.systems); // re-render when the system changes (built-in check, deleted copy)
  const busyChat = useChats((s) => s.chats.find((c) => c.id === chatId)?.turns.some((x) => x.status === "running") ?? false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (next: TuneOutcome) => patchTurn(chatId, t.id, { outcome: next });
  const a = o.applied;
  const usable = o.changes.filter((c) => !c.problem);
  const picked = usable.filter((c) => c.picked).length;
  const builtin = getSystem(o.systemId)?.source === "builtin";
  // Changes to the built-in system go into a copy; screens still on the original don't follow until moved.
  const onOriginal = a?.forked ? boundRoots(o.systemId).length : 0;
  void doc; // boundRoots reads the live doc: re-render with it
  const rows = o.changes.map((c, i) => ({ c, i }));
  const tokens = rows.filter((x) => x.c.kind === "token");
  const guidance = rows.filter((x) => x.c.kind === "guidance");

  const toggle = (i: number) => set({ ...o, changes: o.changes.map((c, k) => (k === i ? { ...c, picked: !c.picked } : c)) });
  const pickAll = (on: boolean) => set({ ...o, changes: o.changes.map((c) => (c.problem ? c : { ...c, picked: on })) });

  const apply = () => {
    setError(null);
    try {
      const next = applyTune(o);
      set(next);
      noteTuneApplied(t.id, next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const move = async () => {
    if (!a) return;
    setMoving(true);
    try {
      await moveScreens(o.systemId, a.systemId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoving(false);
    }
  };

  /** Make the tuned system the active one, then run the original brief again (or open Generate). */
  const regenerate = () => {
    if (!a) return;
    useSystems.getState().setActive(a.systemId);
    studio().setAITab("generate");
    if (!o.brief) return;
    studio().select([]);
    void send({ tool: "generate", text: o.brief.text, lang: o.brief.lang, platform: o.brief.platform });
  };

  return (
    <div className="flex flex-col gap-[10px]">
      {sample && <div className={clsx(noteBox, "py-[6px] text-micro text-fg-subtle")}>Recorded sample: AI is off, so these changes are an example.</div>}
      <div className={noteBox}>
        <div className={clsx(r.eyebrow, "mb-[2px] flex items-center gap-[6px]")}>
          <QalamAIGlyph size={12} /> Diagnosis
        </div>
        <p className="text-fg">{o.diagnosis}</p>
      </div>
      {o.limitations.length > 0 && (
        <div className={warnBox}>
          <TriangleAlert size={14} {...icon} />
          <div className="min-w-0">
            <div className="font-medium">The system can&apos;t fix</div>
            <ul className="mt-[2px] flex list-disc flex-col gap-[2px] pl-[16px] text-fg-muted marker:text-fg-subtle">
              {o.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {o.changes.length === 0 ? (
        <div className="text-caption text-fg-subtle">No changes to the system proposed.</div>
      ) : (
        <>
          <div className="mt-[2px] flex h-[24px] items-center justify-between gap-[8px]">
            <span className="flex min-w-0 items-center gap-[6px] text-caption font-medium text-fg">
              <Hexagon size={14} {...icon} className="shrink-0 text-fg-subtle" />
              <span className="truncate">Changes to {a?.systemName ?? o.systemName}</span>
              {!a && usable.length > 0 && (
                <span className="shrink-0 font-normal text-fg-subtle tnum">
                  · {picked} of {usable.length}
                </span>
              )}
            </span>
            {!a && usable.length > 1 && (
              <button type="button" className={clsx(quietBtn, "-mr-[6px]")} onClick={() => pickAll(picked < usable.length)}>
                {picked < usable.length ? "Select all" : "Select none"}
              </button>
            )}
          </div>
          {tokens.length > 0 && <Group label="Tokens & components" rows={tokens} locked={!!a} onToggle={toggle} />}
          {guidance.length > 0 && <Group label="Rules for the generator" rows={guidance} locked={!!a} onToggle={toggle} />}
        </>
      )}

      {error && <ErrorNote message={error} />}

      {!a && o.changes.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <Button size="sm" className="self-start" disabled={!picked} onClick={apply}>
            <Check size={14} {...icon} />
            <span className="tnum">
              Apply {picked} change{picked === 1 ? "" : "s"}
            </span>
          </Button>
          {builtin && <p className="text-caption text-fg-subtle">{o.systemName} is built in, so the changes go into an editable copy that becomes the active system.</p>}
        </div>
      )}

      {a && (
        <div className={clsx(doneBox, "q-rise")}>
          <div className="flex gap-[8px]">
            <Check size={14} {...icon} className="mt-[2px] shrink-0 text-success" />
            <span className="min-w-0 flex-1">
              Applied to <b className="font-medium">{a.systemName}</b>
              {a.forked ? `, a copy of ${o.systemName}` : ""}. Screens on it have been updated, and new screens use it.
            </span>
          </div>
          <div className="flex flex-wrap gap-[6px] pl-[22px]">
            {onOriginal > 0 && (
              <Button size="sm" disabled={moving} onClick={() => void move()}>
                <MoveRight size={14} {...icon} />
                <span className="tnum">
                  Move {onOriginal} {onOriginal === 1 ? "screen" : "screens"} to it
                </span>
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busyChat} onClick={regenerate}>
              <QalamAIGlyph size={12} /> {o.brief ? "Generate the brief again" : `Generate with ${a.systemName}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => {
                set(undoTune(o));
                noteTuneUndone(t.id);
              }}>
              <RotateCcw size={14} {...icon} /> Undo
            </Button>
          </div>
          {onOriginal > 0 && <p className="pl-[22px] text-fg-muted">{onOriginal === 1 ? "A screen still uses" : `${onOriginal} screens still use`} {o.systemName}, so they don&apos;t show the changes yet.</p>}
          {o.brief && <p className="pl-[22px] text-fg-muted">Brief: “{o.brief.text}”</p>}
        </div>
      )}
    </div>
  );
}

function Group({ label, rows, locked, onToggle }: { label: string; rows: { c: ProposedChange; i: number }[]; locked: boolean; onToggle: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className={clsx(r.eyebrow, "px-[2px]")}>{label}</div>
      {rows.map(({ c, i }) => (
        <ChangeRow key={i} c={c} locked={locked} onToggle={() => onToggle(i)} />
      ))}
    </div>
  );
}

/** One proposed change: the whole row is the checkbox's label, so it toggles from anywhere. */
function ChangeRow({ c, locked, onToggle }: { c: ProposedChange; locked: boolean; onToggle: () => void }) {
  const on = c.picked && !c.problem;
  const disabled = locked || !!c.problem;
  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-[2px] py-[1px]">
      {c.kind === "token" ? (
        <>
          <span className="truncate font-mono text-caption font-medium text-fg" title={c.path}>
            {c.path}
          </span>
          <div className="flex min-w-0 items-center gap-[4px] font-mono text-micro text-fg-subtle">
            {c.fromColor && <Swatch color={c.fromColor} size={12} />}
            <span className="max-w-[40%] truncate" title={c.from}>
              {c.from}
            </span>
            <span className="shrink-0 text-fg-subtle">→</span>
            {c.toColor && <Swatch color={c.toColor} size={12} />}
            <span className="min-w-0 truncate font-medium text-fg" title={c.value}>
              {c.value}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-[6px]">
            {c.op === "add" ? (
              <Tag tone="success" icon={<Plus size={12} {...icon} />}>
                Add
              </Tag>
            ) : (
              <Tag tone="danger" icon={<Minus size={12} {...icon} />}>
                Remove
              </Tag>
            )}
            <span className="truncate text-micro font-medium text-fg-muted">{guidanceLabel(c.target)}</span>
          </div>
          <p className={clsx("text-caption text-fg", c.op === "remove" && "line-through decoration-fg-subtle")}>{c.text}</p>
        </>
      )}
      <p className="text-caption text-fg-muted">{c.reason}</p>
      {c.problem && (
        <p className="flex items-start gap-[6px] text-caption text-danger">
          <CircleAlert size={12} {...icon} className="mt-[2px] shrink-0" /> Can&apos;t apply: {c.problem}.
        </p>
      )}
    </div>
  );
  return (
    <fieldset
      disabled={disabled}
      className={clsx(
        "min-w-0 rounded-lg px-[10px] py-[6px] transition-[background-color,box-shadow] duration-fast",
        "[&>label]:items-start [&>label]:gap-[10px] [&>label>button]:mt-[2px]",
        c.problem && "opacity-60",
        disabled && "[&>label]:cursor-default",
        on ? "bg-raised shadow-[inset_0_0_0_1px_var(--color-line)]" : "shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
        !disabled && !on && "hover:bg-hover hover:duration-0",
      )}
    >
      <Checkbox checked={on} onChange={onToggle} label={content} />
    </fieldset>
  );
}
