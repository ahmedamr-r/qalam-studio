import { useMemo, useState } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { answersOf, currentRound, settledOf } from "@/asking/engine";
import type { AskRound as Round, AskingState, Lookup } from "@/asking/types";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { Questionnaire } from "../ai/Questionnaire";
import { toQuestion } from "../ai/plan";
import type { FlowState } from "../ai/questionFlow";

/*
 * The interview's parts, the same wherever a flow asks before it generates (src/asking/): the round in
 * the box with "Use Qalam AI's picks" and "Stop asking" under it, the lookups running beside it, a
 * lookup put to them first, What we settled before it generates, and each round answered in the thread.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const WHERE = { project: "in your project", web: "on the web" } as const;

/** The lookups running for the next turn, each with Stop: what waited on one is asked again without it. */
export function Waiting({ lookups, onStop }: { lookups: readonly Lookup[]; onStop: (id: string) => void }) {
  const running = lookups.filter((l) => l.state === "running" && l.waits !== "draft");
  if (!running.length) return null;
  return (
    <div className="flex flex-col gap-[2px] px-[4px]" aria-live="polite">
      {running.map((l) => (
        <div key={l.id} className={clsx(r.chatStatus, "flex items-center gap-[6px] text-fg-muted")}>
          <Spinner size={12} />
          <span className="min-w-0 flex-1 truncate">
            Looking {WHERE[l.kind]}
            {l.query ? ` for “${l.query}”` : " for what people do about this"} while you answer
          </span>
          <IconBtn size="sm" label="Stop this lookup" onClick={() => onStop(l.id)}>
            <X size={12} {...ICON} />
          </IconBtn>
        </div>
      ))}
    </div>
  );
}

export interface AskRoundProps {
  state: AskingState;
  /** Shown beside the step counter. */
  title?: string;
  onKeep: (form: FlowState) => void;
  onSend: (form: FlowState) => void;
  onPicks: (form: FlowState) => void;
  onStop: (form: FlowState | null) => void;
  onStopLookup: (id: string) => void;
  onLookItUp: () => void;
  onAskMe: () => void;
}

/** The round being asked, or the lookup put to them; and what's looking things up meanwhile. */
export function AskRound(p: AskRoundProps) {
  const round = currentRound(p.state);
  const offer = p.state.offer;
  return (
    <div className="flex flex-col gap-[6px]">
      <Waiting lookups={p.state.lookups} onStop={p.onStopLookup} />
      {offer && !round ? <Offer query={offer.query} onYes={p.onLookItUp} onNo={p.onAskMe} onStop={() => p.onStop(null)} /> : round ? <RoundBox key={p.state.rounds.length} round={round} n={p.state.rounds.length} {...p} /> : null}
    </div>
  );
}

function RoundBox({ round, n, title, onKeep, onSend, onPicks, onStop }: AskRoundProps & { round: Round; n: number }) {
  const questions = useMemo(() => round.questions.map(toQuestion), [round]);
  const [form, setForm] = useState<FlowState>(round.form);
  const recommends = round.questions.some((q) => q.recommended.length > 0 && q.options.length > 1);
  return (
    <div className="flex flex-col gap-[4px]">
      <Questionnaire
        title={title ?? `Round ${n}`}
        questions={questions}
        state={form}
        onChange={(f) => {
          setForm(f);
          onKeep(f);
        }}
        onSubmit={onSend}
        review={{ submitLabel: "Send answers" }}
      />
      <div className="flex flex-wrap items-center gap-[2px] px-[2px]">
        {recommends && (
          <button type="button" className={r.replyChip} title="Every question you haven't answered takes Qalam AI's recommendation, kept as its pick, never as your words" onClick={() => onPicks(form)}>
            <QalamAIGlyph size={12} className="mr-[4px]" /> Use Qalam AI&apos;s picks
          </button>
        )}
        <button type="button" className={r.replyChip} onClick={() => onStop(form)}>
          Stop asking
        </button>
      </div>
    </div>
  );
}

/** After two turns of only looking things up, the next lookup is theirs to say yes to. */
function Offer({ query, onYes, onNo, onStop }: { query: string; onYes: () => void; onNo: () => void; onStop: () => void }) {
  return (
    <div className="q-sheet flex flex-col gap-[8px] rounded-xl p-[12px]">
      <p className="flex items-start gap-[6px] text-body leading-[20px] text-fg">
        <Search size={14} {...ICON} className="mt-[3px] shrink-0 text-fg-muted" />
        <span>Look up “{query}” on the web too, before asking you more?</span>
      </p>
      <div className="flex flex-wrap items-center gap-[4px]">
        <button type="button" className={r.replyChipPrimary} onClick={onYes}>
          Look it up
        </button>
        <button type="button" className={r.replyChip} onClick={onNo}>
          Ask me instead
        </button>
        <button type="button" className={r.replyChip} onClick={onStop}>
          Stop asking
        </button>
      </div>
    </div>
  );
}

const HOW_NOTE = { pick: "Qalam AI's pick, which you agreed to", left: "Left" } as const;

/** A round answered, folded in the thread: each answer, Qalam AI's picks marked as its own. */
export function AnsweredRound({ state, index }: { state: AskingState; index: number }) {
  const said = answersOf({ rounds: [state.rounds[index]] });
  if (!said.length || said.every((a) => a.how === "left")) return null;
  return (
    <details className="q-fold group/answers rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">Your answers · round {index + 1}</summary>
      <dl className="flex flex-col gap-[8px] pb-[10px]">
        {said.map((a, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
            <dt className="text-fg-subtle">{a.question}</dt>
            <dd className={a.how === "left" ? "text-fg-subtle" : "text-fg"} dir="auto">
              {a.how === "left" ? HOW_NOTE.left : a.text}
              {a.how === "pick" && <span className="ml-[6px] text-micro text-fg-muted">· {HOW_NOTE.pick}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** What lookups in their project found: their own material, by whose words it holds. */
export function FoundInProject({ state }: { state: AskingState }) {
  const found = state.lookups.filter((l) => l.kind === "project" && l.state === "done" && l.lines?.length);
  if (!found.length) return null;
  const n = found.reduce((t, l) => t + (l.lines?.length ?? 0), 0);
  return (
    <details className="q-fold rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <Search size={12} {...ICON} /> Found in your project · {n} {n === 1 ? "line" : "lines"}
      </summary>
      <div className="flex flex-col gap-[10px] pb-[10px]">
        {found.map((l) => (
          <div key={l.id} className="flex flex-col gap-[4px]">
            <p className="text-fg-subtle">For “{l.query}”</p>
            {l.lines!.map((x) => (
              <p key={x.ref} className="text-fg" dir="auto">
                “{x.text}” <span className="text-fg-subtle">· {x.from}{x.whose ? `, ${x.whose}` : ""}</span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

export interface SettledProps {
  state: AskingState;
  /** The flow's verb: Propose, Place it, Draft them… */
  go: string;
  onGo: () => void;
  onOff: () => void;
  onTerm: (id: string, keep: boolean) => void;
  onChoice?: (id: string, keep: boolean) => void;
}

/** What we settled, before it generates: the points, Qalam AI's picks, words and decisions to keep, what's left open. */
export function SettledCard({ state, go, onGo, onOff, onTerm, onChoice }: SettledProps) {
  const s = settledOf(state);
  return (
    <div className="q-sheet flex flex-col gap-[10px] rounded-xl p-[14px]">
      <p className="flex items-center gap-[6px] text-caption font-medium text-fg-muted">
        <QalamAIGlyph size={12} /> What we settled
      </p>
      {s.points.length > 0 ? (
        <ul className="flex flex-col gap-[4px] pl-[14px] text-body leading-[20px] text-fg">
          {s.points.map((p, i) => (
            <li key={i} className="list-disc" dir="auto">
              {p.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">Nothing more than what you asked: I&apos;ll go by that.</p>
      )}
      {s.picks.length > 0 && (
        <p className="text-caption text-fg-muted" dir="auto">
          My picks you agreed to: {s.picks.map((a) => a.text).join("; ")}. They&apos;re my recommendations, so what rests on them alone shows as assumed.
        </p>
      )}
      {s.terms.map((t) => (
        <div key={t.id} className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <p className="text-body leading-[20px] text-fg" dir="auto">
            <span className="font-medium">{t.term}</span> <span className="text-fg-muted">{t.means}</span>
            {t.avoid.length > 0 && <span className="text-caption text-fg-subtle"> Avoid: {t.avoid.join(", ")}.</span>}
          </p>
          {t.state === "kept" ? (
            <p className="text-caption text-fg-muted">In the project&apos;s words.</p>
          ) : (
            <div className="flex items-center gap-[4px]">
              <button type="button" className={r.replyChip} onClick={() => onTerm(t.id, true)}>
                Add to the project&apos;s words
              </button>
              <button type="button" className={r.replyChip} onClick={() => onTerm(t.id, false)}>
                Leave out
              </button>
            </div>
          )}
        </div>
      ))}
      {onChoice &&
        s.choices.map((c) => (
          <div key={c.id} className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <p className="text-body leading-[20px] text-fg" dir="auto">
              <span className="font-medium">{c.choice}</span> <span className="text-fg-muted">{c.why}</span>
              <span className="text-caption text-fg-subtle"> Instead of: {c.instead}.</span>
            </p>
            {c.state === "kept" ? (
              <p className="text-caption text-fg-muted">Kept with your decisions.</p>
            ) : (
              <div className="flex items-center gap-[4px]">
                <button type="button" className={r.replyChip} onClick={() => onChoice(c.id, true)}>
                  Keep this decision
                </button>
                <button type="button" className={r.replyChip} onClick={() => onChoice(c.id, false)}>
                  Leave out
                </button>
              </div>
            )}
          </div>
        ))}
      {s.left.length > 0 && (
        <p className="text-caption text-fg-muted" dir="auto">
          Left open: {s.left.join("; ")}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-[4px]">
        <button type="button" className={r.replyChipPrimary} onClick={onGo}>
          {go}
        </button>
        <button type="button" className={r.replyChip} onClick={onOff}>
          Something&apos;s off
        </button>
      </div>
    </div>
  );
}
