import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Plus, X } from "lucide-react";
import { formatKeys } from "@/commands/registry";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r } from "../recipes";
import { Button, Checkbox, Kbd, Tag } from "../controls";
import { Dictated } from "../voice/MicButton";
import {
  CUSTOM_MAX,
  OTHER,
  REVIEW,
  addCustom,
  answerOf,
  currentOf,
  optionAt,
  position,
  reduceFlow,
  removeCustom,
  setGroup,
  summarize,
  toggleValue,
  type Answer,
  type Answers,
  type FlowAction,
  type FlowState,
  type MultiGroup,
  type MultiQuestion,
  type Question,
  type SingleQuestion,
} from "./questionFlow";

/**
 * Questions in the AI chat, one step at a time: progress, Back and Next, Qalam AI's recommended
 * answer, several answers where that makes sense, a free-text "Other…", and a review step where
 * any answer can be changed before submitting. Controlled: the state lives with the caller (a chat
 * turn), so it survives a reload. Keys: 1–9 pick an option, Enter goes on (Shift+Enter: a new line in a text answer).
 */

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * The AI question-card language (the critique card on the canvas uses the same strings): a lilac
 * card with a hairline in the AI tone, the glyph + step caption, a medium-weight question, option
 * cards on raised fills (the picked one tinted like every selected option card), invert radios.
 */
export const qr = {
  card: "flex flex-col gap-[10px] rounded-lg bg-ai-subtle p-[12px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ai)_18%,transparent)]",
  caption: "flex items-center gap-[6px] text-micro font-medium text-ai tnum",
  question: "text-body leading-[20px] font-medium text-fg",
  why: "text-caption text-fg-muted",
  /** Option card: add `optionIdle` or `optionSelected` (they set the fill and the ring). */
  option: "q-item flex w-full items-start gap-[10px] rounded-lg px-[10px] py-[8px] text-left",
  optionIdle: "bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-elevated light:hover:bg-muted",
  optionSelected: r.optionCardSelected,
  radio: "mt-[2px] grid size-[14px] shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-colors duration-quick",
  radioOn: "bg-inverse shadow-none",
  radioDot: "size-[6px] rounded-full bg-fg-inverse q-fade",
  inset: "rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
  textBtn: "q-item inline-flex h-[22px] items-center gap-[2px] rounded-sm px-[6px] text-caption font-medium text-fg-muted hover:bg-hover hover:text-fg",
} as const;

/** Groups with more options than this start folded. */
const FOLD_AT = 8;
const ENTER = formatKeys({ key: "Enter" });

export interface QuestionnaireProps {
  questions: Question[];
  state: FlowState;
  onChange: (s: FlowState) => void;
  /** All answered: the final state (answers resolved, `submitted` set). */
  onSubmit: (s: FlowState) => void;
  /** A last step listing every answer, with room for extra settings. */
  review?: { title?: string; submitLabel: string; extra?: ReactNode; footnote?: ReactNode };
  /** Shown beside the step counter, e.g. "Before I extract". */
  title?: string;
}

export function Questionnaire({ questions, state, onChange, onSubmit, review, title }: QuestionnaireProps) {
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const step = useRef<HTMLDivElement>(null);
  const acted = useRef(false);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const cur = currentOf(state, questions);
  const q = questions.find((x) => x.id === cur);
  const { index, total } = position(state, questions, !!review);

  const dispatch = (a: FlowAction) => {
    acted.current = true;
    const res = reduceFlow(state, a, questions, !!review);
    setError(res.error ?? null);
    if (res.done) onSubmit(res.state);
    else if (res.state !== state) onChange(res.state);
  };
  const answer = (a: Answer) => q && dispatch({ type: "answer", id: q.id, answer: a });
  const next = () => dispatch(cur === REVIEW ? { type: "submit" } : { type: "next" });

  // A new step: bring its top into view, and keep keyboard focus in the card (never take it from
  // the canvas: only after the designer acted here).
  useEffect(() => {
    if (!acted.current) return;
    const raf = requestAnimationFrame(() => {
      head.current?.scrollIntoView({ block: "nearest" });
      const active = document.activeElement;
      // A text answer takes the caret straight away; otherwise the step (for 1–9 and Enter).
      if (!active || active === document.body || box.current?.contains(active)) (step.current?.querySelector("textarea") ?? step.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [cur]);

  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      next();
      return;
    }
    const n = Number(e.key);
    if (q?.kind === "single" && n >= 1 && n <= 9) {
      const v = optionAt(q, n);
      if (!v) return;
      e.preventDefault();
      e.stopPropagation();
      const a = answerOf(q, state.answers);
      answer({ kind: "single", value: v, other: a.kind === "single" ? a.other : undefined });
    }
  };

  return (
    <div ref={box} className={qr.card} onKeyDown={onKey}>
      <div ref={head} className="flex flex-col gap-[8px]">
        <div className="flex items-center justify-between gap-[8px]">
          <span className={qr.caption} aria-live="polite">
            <QalamAIGlyph size={12} />
            {cur === REVIEW ? `Review · step ${index} of ${total}` : `Step ${index} of ${total}`}
          </span>
          {title && <span className="truncate text-micro text-fg-subtle">{title}</span>}
        </div>
        <div className="flex gap-[3px]" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={clsx("h-[3px] flex-1 rounded-full transition-colors duration-base", i + 1 < index ? "bg-ai" : i + 1 === index ? "bg-ai/45" : "bg-ai/15")} />
          ))}
        </div>
      </div>

      {/* Each step rises in; the one before is gone at once. */}
      <div ref={step} key={cur} tabIndex={-1} className="q-rise flex flex-col gap-[10px] outline-none">
        {cur === REVIEW || !q ? (
          <ReviewStep questions={questions} answers={state.answers} title={review?.title} onEdit={(id) => dispatch({ type: "edit", id })}>
            {review?.extra}
            {review?.footnote && <p className="rounded-md bg-muted/70 px-[10px] py-[8px] text-caption text-fg-muted">{review.footnote}</p>}
          </ReviewStep>
        ) : (
          <>
            <div className="flex flex-col gap-[4px]">
              {q.source === "ai" && (
                <span className="mb-[2px]">
                  <Tag tone="ai">Qalam AI asks</Tag>
                </span>
              )}
              <p className={qr.question} dir="auto">
                {q.title}
              </p>
              {q.why && (
                <p className={qr.why} dir="auto">
                  {q.why}
                </p>
              )}
            </div>
            {q.kind === "single" && <SingleStep q={q} a={answerOf(q, state.answers)} onAnswer={answer} />}
            {q.kind === "multi" && <MultiStep q={q} a={answerOf(q, state.answers)} onAnswer={answer} />}
            {q.kind === "text" && (
              <Dictated field={textArea} set={(text) => answer({ kind: "text", text })}>
                <textarea
                  ref={textArea}
                  rows={3}
                  dir="auto"
                  className="ds-textarea block w-full resize-none placeholder:text-fg-faint"
                  placeholder={q.placeholder}
                  maxLength={q.maxLength}
                  value={(() => {
                    const a = answerOf(q, state.answers);
                    return a.kind === "text" ? a.text : "";
                  })()}
                  onChange={(e) => answer({ kind: "text", text: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter goes on, as everywhere in the card; Shift+Enter starts a new line.
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
                      e.preventDefault();
                      e.stopPropagation();
                      next();
                    }
                  }}
                />
              </Dictated>
            )}
          </>
        )}
      </div>

      {error && (
        <p key={error} className="q-shake flex items-center gap-[6px] text-caption text-danger" role="alert">
          <CircleAlert size={12} {...icon} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-[6px]">
        {index > 1 && (
          <Button size="sm" variant="ghost" className="-ml-[4px] pl-[4px] [&>svg]:-mr-[4px]" onClick={() => dispatch({ type: "back" })}>
            <ChevronLeft size={14} {...icon} /> Back
          </Button>
        )}
        <div className="flex-1" />
        {q?.optional && cur !== REVIEW && (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "skip" })}>
            Skip
          </Button>
        )}
        <Button size="sm" className="gap-[6px] pr-[4px]" onClick={next}>
          {cur === REVIEW ? (review?.submitLabel ?? "Submit") : state.editing ? "Done" : "Next"}
          <Kbd keys={ENTER} size="sm" onInverse />
        </Button>
      </div>
    </div>
  );
}

export function Radio({ on }: { on: boolean }) {
  return <span className={clsx(qr.radio, on && qr.radioOn)}>{on && <span className={qr.radioDot} />}</span>;
}

function SingleStep({ q, a, onAnswer }: { q: SingleQuestion; a: Answer; onAnswer: (a: Answer) => void }) {
  const value = a.kind === "single" ? a.value : "";
  const other = a.kind === "single" ? (a.other ?? "") : "";
  const otherInput = useRef<HTMLInputElement>(null);
  const cardCls = (on: boolean) => clsx(qr.option, on ? qr.optionSelected : qr.optionIdle);
  return (
    <div className="flex flex-col gap-[6px]" role="radiogroup" aria-label={q.title}>
      {q.options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onAnswer({ kind: "single", value: o.value, other })} className={cardCls(value === o.value)}>
          <Radio on={value === o.value} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-[6px]">
              <span className="text-body font-medium text-fg" dir="auto">
                {o.label}
              </span>
              {q.recommended === o.value && <Tag tone="ai">Recommended</Tag>}
            </span>
            {o.description && (
              <span className="mt-[2px] block text-caption text-fg-muted" dir="auto">
                {o.description}
              </span>
            )}
          </span>
          <Kbd keys={String(i + 1)} size="sm" className="mt-[1px]" />
        </button>
      ))}
      {q.other && (
        <div className={clsx(cardCls(value === OTHER), "flex-col gap-[8px]")}>
          <button
            type="button"
            role="radio"
            aria-checked={value === OTHER}
            className="flex w-full items-start gap-[10px] text-left outline-offset-4"
            onClick={() => {
              onAnswer({ kind: "single", value: OTHER, other });
              requestAnimationFrame(() => otherInput.current?.focus());
            }}
          >
            <Radio on={value === OTHER} />
            <span className="flex-1 text-body font-medium text-fg">{q.other.label}</span>
            <Kbd keys={String(q.options.length + 1)} size="sm" className="mt-[1px]" />
          </button>
          {value === OTHER && (
            <Dictated field={otherInput} set={(t) => onAnswer({ kind: "single", value: OTHER, other: t })} className="ml-[24px]">
              <input
                ref={otherInput}
                className="ds-input q-fade w-full placeholder:text-fg-faint"
                dir="auto"
                maxLength={CUSTOM_MAX}
                placeholder={q.other.placeholder ?? "Your answer"}
                value={other}
                aria-label="Your answer"
                onChange={(e) => onAnswer({ kind: "single", value: OTHER, other: e.target.value })}
              />
            </Dictated>
          )}
        </div>
      )}
    </div>
  );
}

function MultiStep({ q, a, onAnswer }: { q: MultiQuestion; a: Answer; onAnswer: (a: Answer) => void }) {
  const m = a.kind === "multi" ? a : { kind: "multi" as const, values: [], custom: [] };
  return (
    <div className="flex flex-col gap-[6px]">
      {q.groups.map((g, i) => (
        <GroupBox key={g.id} g={g} a={m} first={i === 0} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

function GroupBox({ g, a, first, onAnswer }: { g: MultiGroup; a: { kind: "multi"; values: string[]; custom: string[] }; first: boolean; onAnswer: (a: Answer) => void }) {
  const foldable = g.options.length > FOLD_AT;
  const [open, setOpen] = useState(!foldable || first);
  const [draft, setDraft] = useState("");
  const own = useRef<HTMLInputElement>(null);
  const picked = g.options.filter((o) => a.values.includes(o.value)).length + (g.custom ? a.custom.length : 0);
  const count = g.options.length + (g.custom ? a.custom.length : 0);
  const full = g.max !== undefined && picked >= g.max;
  const wide = g.options.some((o) => o.label.length > 18);
  const add = () => {
    if (!draft.trim() || full) return;
    onAnswer(addCustom(a, draft));
    setDraft("");
  };
  return (
    <div className={qr.inset}>
      <div className="flex h-[32px] items-center gap-[8px] pr-[4px] pl-[10px]">
        <span className="min-w-0 truncate text-caption font-medium text-fg">
          {g.label}{" "}
          <span className="font-normal text-fg-subtle tnum">
            · {picked} of {g.max !== undefined ? Math.min(g.max, Math.max(count, picked)) : count}
          </span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-[2px]">
          {g.options.length > 1 && (
            <>
              <button type="button" className={qr.textBtn} onClick={() => onAnswer(setGroup(a, g, true))}>
                All
              </button>
              <button type="button" className={qr.textBtn} onClick={() => onAnswer(setGroup(a, g, false))}>
                None
              </button>
            </>
          )}
          {foldable && (
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={clsx(qr.textBtn, "pr-[4px]")}>
              {open ? "Hide" : "Show"} <ChevronDown size={12} {...icon} className="q-chevron" />
            </button>
          )}
        </div>
      </div>
      {g.hint && <p className="-mt-[4px] px-[10px] pb-[4px] text-caption text-fg-subtle">{g.hint}</p>}
      {open && g.options.length > 0 && (
        <div className={clsx("q-fade grid gap-x-[8px] px-[10px] pb-[6px]", wide ? "grid-cols-1" : "grid-cols-2")}>
          {g.options.map((o) => {
            const on = a.values.includes(o.value);
            return (
              <div key={o.value} title={o.description} className="min-w-0">
                <Checkbox
                  checked={on}
                  onChange={(v) => (!v || !full ? onAnswer(toggleValue(a, o.value, v)) : undefined)}
                  label={
                    <span className="flex min-w-0 items-baseline gap-[4px]">
                      <span className="truncate" dir="auto">
                        {o.label}
                      </span>
                      {o.badge && <span className="shrink-0 text-micro text-fg-subtle tnum">{o.badge}</span>}
                    </span>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
      {g.custom && (
        <div className="flex flex-col gap-[6px] border-t border-line-subtle px-[10px] py-[8px]">
          {a.custom.length > 0 && (
            <div className="flex flex-wrap gap-[4px]">
              {a.custom.map((n, k) => (
                <span key={n} style={{ "--i": k } as CSSProperties} className="q-fade inline-flex min-h-[22px] max-w-full items-center gap-[4px] rounded-md bg-active py-[2px] pr-[2px] pl-[8px] text-caption text-fg" dir="auto">
                  <span className="min-w-0 break-words">{n}</span>
                  <button type="button" aria-label={`Remove ${n}`} className="q-item grid size-[18px] place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg" onClick={() => onAnswer(removeCustom(a, n))}>
                    <X size={12} {...icon} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-[6px]">
            <Dictated field={own} set={setDraft} className="flex-1">
              <input
                ref={own}
                className="ds-input h-[28px] w-full placeholder:text-fg-faint"
                dir="auto"
                placeholder={full ? `Up to ${g.max}` : g.custom.placeholder}
                value={draft}
                maxLength={CUSTOM_MAX}
                disabled={full}
                aria-label={g.custom.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    add();
                  }
                }}
              />
            </Dictated>
            <Button variant="secondary" onClick={add} disabled={!draft.trim() || full}>
              <Plus size={14} {...icon} /> Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewStep({ questions, answers, title, onEdit, children }: { questions: Question[]; answers: Answers; title?: string; onEdit: (id: string) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <p className={qr.question}>{title ?? "Check your answers"}</p>
      <div className={clsx(qr.inset, "flex flex-col py-[2px]")}>
        {questions.map((q, i) => (
          <div key={q.id} className={clsx("flex items-start gap-[8px] py-[7px] pr-[6px] pl-[10px]", i > 0 && "border-t border-line-subtle")}>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-caption text-fg-subtle" dir="auto">
                {q.title}
              </div>
              <div className="text-body text-fg" dir="auto">
                {summarize(q, answerOf(q, answers))}
              </div>
            </div>
            <button type="button" className={qr.textBtn} onClick={() => onEdit(q.id)}>
              Edit
            </button>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

/** Submitted answers, folded, for the chat history. */
export function AnswersSummary({ questions, answers, label: text = "Your answers" }: { questions: Question[]; answers: Answers; label?: string }) {
  return (
    <details className="group/answers rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} {...icon} className="shrink-0 text-fg-subtle transition-transform duration-fast group-open/answers:rotate-90" />
        {text} <span className="font-normal text-fg-subtle tnum">({questions.length})</span>
      </summary>
      <dl className="flex flex-col gap-[6px] pb-[8px] pl-[18px]">
        {questions.map((q) => (
          <div key={q.id}>
            <dt className="text-fg-subtle" dir="auto">
              {q.title}
            </dt>
            <dd className="text-fg" dir="auto">
              {summarize(q, answerOf(q, answers))}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
