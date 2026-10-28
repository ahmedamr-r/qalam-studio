import { useState } from "react";
import clsx from "clsx";
import { Star, Target, X } from "lucide-react";
import { metricLine } from "@/goals/goals-md";
import { readOutline, withoutGoal, type ShapedGoal } from "@/goals/outline";
import { useOrgContext } from "@/org/context";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, IconBtn } from "../controls";
import { ErrorNote, Progress } from "../ai/common";
import { Questionnaire, qr } from "../ai/Questionnaire";
import { initialFlow, resolvedAnswers, type FlowState, type Question } from "../ai/questionFlow";
import { r } from "../recipes";
import { addShapedGoals, shapeGoals, stopSetup, useSetup } from "./setup";

/**
 * "I know our goals": they write their goals down as they say them, the North Star first, each
 * indented under the goal it feeds (src/goals/outline.ts). Qalam AI reads each line's number; code
 * asks only for what's missing (where it stands, where it should get to, by when), then shows the
 * tree to add. The words and the tree are theirs.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const PLACEHOLDER = `2M dirhams a month in orders by end of Q2
  More customers reorder every week: 1.2 a week now, 1.5 by March
  More first orders become second orders
    Fewer first orders arrive late`;
const MAX_QUESTIONS = 8;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One question for each goal whose number is missing a part, about just that part. */
export function missingQuestions(goals: ShapedGoal[]): Question[] {
  return goals
    .filter((g) => g.missing.some((m) => m !== "when"))
    .slice(0, MAX_QUESTIONS)
    .map((g): Question => {
      const name = g.metric?.name;
      // No number at all: by when is unsaid too.
      const when = g.missing.includes("when") || g.missing.includes("number");
      const title = g.missing.includes("number")
        ? `How would you know “${g.title}” is moving? The number, where it is today, and where it should get to${when ? " by when" : ""}.`
        : g.missing.includes("today") && g.missing.includes("target")
          ? `Where does “${name}” stand today, and where should it get to${when ? " by when" : ""}?`
          : g.missing.includes("today")
            ? `Where does “${name}” stand today?`
            : `Where should “${name}” get to${when ? ", and by when" : ""}?`;
      return { kind: "text", id: g.ref, title, why: "Qalam AI takes a number only as you write it.", placeholder: "Weekly reorders per customer: 1.2 now, 1.5 by March", maxLength: 600, optional: true };
    });
}

export function GoalsForm({ org, onBack, onDone }: { org: string; onBack: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"write" | "asking" | "review">("write");
  const [goals, setGoals] = useState<ShapedGoal[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [form, setForm] = useState<FlowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const busy = useSetup((s) => s.busy);
  const outline = readOutline(text);

  const read = async () => {
    if (!outline.length || busy) return;
    setError(null);
    try {
      const shaped = await shapeGoals(outline, new Map());
      const qs = missingQuestions(shaped);
      setGoals(shaped);
      setQuestions(qs);
      setForm(qs.length ? initialFlow(qs) : null);
      setPhase(qs.length ? "asking" : "review");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(message(e));
    }
  };
  const answer = async (f: FlowState) => {
    const all = resolvedAnswers(questions, f.answers);
    const answers = new Map(questions.flatMap((q): [string, string][] => (all[q.id]?.kind === "text" && (all[q.id] as { text: string }).text.trim() ? [[q.id, (all[q.id] as { text: string }).text.trim()]] : [])));
    if (!answers.size) return setPhase("review");
    setError(null);
    try {
      // Read again with the answers: the goals as they are now (one taken off stays off).
      const kept = new Set(goals.map((g) => g.ref));
      setGoals((await shapeGoals(outline, answers)).filter((g) => kept.has(g.ref)));
      setPhase("review");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(message(e));
    }
  };
  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      await addShapedGoals(goals);
      onDone();
    } catch (e) {
      setError(`Couldn't add them: ${message(e)}`);
      setAdding(false);
    }
  };

  return (
    <section aria-labelledby="goals-title" className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h1 id="goals-title" className="text-heading font-semibold text-fg">
          {org}&apos;s goals
        </h1>
        <p className="text-body text-fg-muted">The North Star first, then the goals that feed it, each on its own line and indented under the goal it feeds. Add the numbers you have.</p>
      </div>
      {phase === "write" && (
        <>
          <textarea
            aria-label="Your goals"
            autoFocus
            dir="auto"
            rows={8}
            className={clsx(r.textarea, "min-h-[180px] text-body")}
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Tab indents a goal under the one above it.
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const [from, to] = [el.selectionStart, el.selectionEnd];
                const start = el.value.lastIndexOf("\n", from - 1) + 1;
                const next = e.shiftKey ? el.value.slice(0, start) + el.value.slice(start).replace(/^ {1,2}/, "") : `${el.value.slice(0, start)}  ${el.value.slice(start)}`;
                const moved = next.length - el.value.length;
                setText(next);
                requestAnimationFrame(() => el.setSelectionRange(Math.max(start, from + moved), Math.max(start, to + moved)));
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void read();
            }}
          />
          <span className="text-micro text-fg-subtle">Tab puts a goal under the one above it; Shift-Tab takes it back out.</span>
          {error && <ErrorNote message={error} />}
          {busy && (
            <div className="flex flex-col gap-[8px]">
              <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />
              <Button variant="secondary" size="sm" className="self-start" onClick={stopSetup}>
                Stop
              </Button>
            </div>
          )}
          <div className="flex items-center gap-[8px]">
            <button type="button" className={qr.textBtn} onClick={onBack}>
              Back
            </button>
            <span className="flex-1" />
            <Button disabled={!outline.length || !!busy} onClick={() => void read()} title={outline.length ? undefined : "Write a goal first"}>
              <QalamAIGlyph size={12} /> Read {outline.length > 1 ? `${outline.length} goals` : "it"}
            </Button>
          </div>
        </>
      )}
      {phase === "asking" && form && (
        <div className="flex flex-col gap-[10px]">
          {busy ? (
            <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />
          ) : (
            <Questionnaire title="Only what's missing" questions={questions} state={form} onChange={setForm} onSubmit={(f) => void answer(f)} review={{ submitLabel: "Send answers" }} />
          )}
          {error && <ErrorNote message={error} />}
          {!busy && (
            <button type="button" className={clsx(qr.textBtn, "self-start")} onClick={() => setPhase("review")}>
              Skip the questions
            </button>
          )}
        </div>
      )}
      {phase === "review" && <Tree goals={goals} onRemove={(ref) => setGoals((list) => withoutGoal(list, ref))} />}
      {phase === "review" && (
        <div className="flex items-center gap-[8px]">
          <button type="button" className={qr.textBtn} disabled={adding} onClick={() => setPhase("write")}>
            Edit them
          </button>
          <span className="flex-1" />
          {error && <ErrorNote message={error} />}
          <Button disabled={adding || !goals.length} onClick={() => void add()}>
            {adding ? "Adding…" : `Add ${goals.length === 1 ? "this goal" : `these ${goals.length} goals`}`}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The goals as they'll be added: each under the one it feeds, with its product and its number. */
function Tree({ goals, onRemove }: { goals: ShapedGoal[]; onRemove: (ref: string) => void }) {
  const { products } = useOrgContext();
  const depth = (g: ShapedGoal) => {
    let n = 0;
    for (let p = g.parent; p && n < 20; p = goals.find((x) => x.ref === p)?.parent ?? null) n++;
    return n;
  };
  const top = goals.find((g) => !g.parent);
  return (
    <ul aria-label="Your goals" className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {goals.map((g) => {
        const north = g === top;
        const product = !g.product ? "The whole organization" : "id" in g.product ? (products.find((p) => p.id === (g.product as { id: string }).id)?.name ?? "A product") : `${g.product.name} · a new product`;
        return (
          <li key={g.ref} className="group/goal grid grid-cols-[16px_minmax(0,1fr)_28px] items-start gap-x-[10px] py-[8px] pr-[8px]" style={{ paddingLeft: 12 + depth(g) * 20 }}>
            <span className={clsx("pt-[3px]", north ? "text-fg" : "text-fg-subtle")}>{north ? <Star {...ICON} /> : <Target {...ICON} />}</span>
            <span className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-body text-fg" dir="auto">
                {g.title}
              </span>
              <span className="text-caption text-fg-muted tnum">{[north ? "North Star" : null, product, g.metric ? [g.metric.name !== g.title ? g.metric.name : null, metricLine(g.metric)].filter(Boolean).join(": ") : "No number yet"].filter(Boolean).join(" · ")}</span>
            </span>
            <IconBtn size="sm" label="Leave it out" onClick={() => onRemove(g.ref)}>
              <X {...ICON} />
            </IconBtn>
          </li>
        );
      })}
    </ul>
  );
}
