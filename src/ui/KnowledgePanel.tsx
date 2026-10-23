import { useEffect, useState } from "react";
import clsx from "clsx";
import { BookOpen, Check, LucideProvider, Trash2, X } from "lucide-react";
import { useStudio, studio } from "@/doc/store";
import { revealLayers } from "./pages";
import { BRIEF_TOPICS, TOPIC_LABEL, emptyBrief, removeAnswer, updateScreen } from "@/doc/brief";
import type { GoalVerdict, ProjectBrief, ScreenBrief } from "@/doc/schema";
import { MAX_QUESTIONS } from "@/ai/critique";
import { Button, Field, Tag } from "./controls";
import { r } from "./recipes";
import { QalamAIGlyph } from "./brand/ai-glyph";
import { confirmDialog } from "./surfaces/dialog";
import { resetKnowledge, showCard, startCritique, useCritique, type CritiqueSession } from "./ai/critiqueSession";
import { openWhy, verdictDecision } from "./knowledge/why";
import { openWorkspace } from "./workspace/store";

/** Left-panel tab: what the AI critic has learned about the project, stored in the document. */
export default function KnowledgePanel() {
  const doc = useStudio((s) => s.doc);
  const session = useCritique((s) => s.session);
  const brief = doc.brief;
  const screens = Object.entries(brief?.screens ?? {}).filter(([id]) => doc.nodes[id]);
  const empty = !brief || (!brief.summary && !brief.answers.length && !screens.length);

  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
    <div className="flex flex-col gap-[16px] px-[12px] pt-[4px] pb-[16px]">
      <p className="rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        What Qalam AI has learned about this project from your answers to its critique questions. Saved in the document and used in every critique, so later screens get a verdict faster.{" "}
        <button type="button" className="text-fg underline underline-offset-2" onClick={() => openWorkspace("knowledge")}>
          See everything it knows
        </button>
      </p>
      {session && <SessionStrip s={session} />}
      {empty ? (
        <div className="q-rise flex flex-col items-center gap-[8px] px-[8px] py-[24px] text-center">
          <span className="grid size-[36px] place-items-center rounded-lg bg-muted text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <BookOpen size={18} />
          </span>
          <p className="max-w-[220px] text-caption text-fg-muted">
            Select a screen and click <b className="font-medium text-fg">Critique</b>. Your answers to Qalam AI&apos;s questions collect here.
          </p>
        </div>
      ) : (
        <>
          <Group title="What the project solves">
            <CommitText
              multiline
              value={brief?.summary ?? ""}
              placeholder="Qalam AI fills this in from your answers. You can edit it."
              onCommit={(summary) => setBrief((b) => ({ ...b, summary: summary.slice(0, 2000) }))}
            />
          </Group>
          {brief!.answers.length > 0 && (
            <Group title={`Answers · ${brief!.answers.length}`}>
              {BRIEF_TOPICS.filter((t) => brief!.answers.some((a) => a.topic === t)).map((t) => (
                <div key={t} className="flex flex-col gap-[6px]">
                  <div className="px-[4px] text-caption font-semibold text-fg">{TOPIC_LABEL[t]}</div>
                  {brief!.answers
                    .filter((a) => a.topic === t)
                    .map((a) => (
                      <div key={a.id} className={clsx(card, "group relative py-[8px] pr-[28px] pl-[10px] text-caption")}>
                        <div className="text-fg-subtle" dir="auto">
                          {a.question}
                        </div>
                        <div className="mt-[2px] text-body font-medium text-fg" dir="auto">
                          {a.answer}
                        </div>
                        {a.screenIds.some((id) => doc.nodes[id]) && (
                          <div className="mt-[4px] truncate text-micro text-fg-subtle">{a.screenIds.flatMap((id) => (doc.nodes[id] ? [doc.nodes[id].name] : [])).join(", ")}</div>
                        )}
                        <button
                          type="button"
                          aria-label="Delete answer"
                          onClick={() => setBrief((b) => removeAnswer(b, a.id, Date.now()))}
                          className="q-item absolute top-[6px] right-[6px] grid size-[20px] place-items-center rounded-sm text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-danger-subtle hover:text-danger focus-visible:opacity-100"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                </div>
              ))}
            </Group>
          )}
          {screens.length > 0 && (
            <Group title={`Screens · ${screens.length}`}>
              {screens.map(([id, s]) => (
                <ScreenEntry key={id} id={id} s={s} />
              ))}
            </Group>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-danger hover:bg-danger-subtle hover:text-danger"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Reset the Knowledge hub?",
                body: "This removes every saved answer, summary and verdict from the document. It can't be undone.",
                confirmLabel: "Reset knowledge",
                danger: true,
              });
              if (ok) resetKnowledge();
            }}
          >
            <Trash2 size={12} /> Reset knowledge
          </Button>
        </>
      )}
    </div>
    </LucideProvider>
  );
}

/** Edits to the brief stay out of undo history, like the critique's own writes. */
function setBrief(fn: (b: ProjectBrief) => ProjectBrief) {
  const next = fn(studio().doc.brief ?? emptyBrief());
  studio().mutate((d) => {
    d.brief = { ...next, updatedAt: Date.now() };
  }, { history: false });
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[6px]">
      <h3 className={clsx(r.eyebrow, "px-[4px] tnum")}>{title}</h3>
      {children}
    </section>
  );
}

/** Text field that commits on blur (typing per keystroke would repaint the canvas). */
function CommitText({ value, onCommit, placeholder, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setV(value);
  }, [value, focused]);
  const props = {
    value: v,
    dir: "auto" as const,
    placeholder,
    onFocus: () => setFocused(true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => {
      setFocused(false);
      if (v.trim() !== value) onCommit(v.trim());
    },
  };
  return multiline ? <textarea {...props} rows={4} className="ds-textarea w-full resize-y" /> : <input {...props} className="ds-input w-full" onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />;
}

/** Answer, screen and session cards: a hairline box, no fill, so the text leads. */
const card = "rounded-lg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";

const VERDICT: Record<GoalVerdict, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  meets: { label: "Meets goal", tone: "success" },
  partially: { label: "Partially", tone: "warning" },
  misses: { label: "Misses goal", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};

function ScreenEntry({ id, s }: { id: string; s: ScreenBrief }) {
  const name = useStudio((st) => st.doc.nodes[id]?.name ?? s.name);
  const lc = s.lastCritique;
  const set = (patch: Partial<ScreenBrief>) => setBrief((b) => updateScreen(b, id, name, patch, Date.now()));
  return (
    <div className={clsx(card, "flex flex-col gap-[8px] p-[10px]")}>
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={() => revealLayers([id])}
          className="min-w-0 flex-1 truncate text-left text-body font-medium text-fg underline-offset-2 hover:underline"
          dir="auto"
        >
          {name}
        </button>
        {lc && (
          <Tag tone={VERDICT[lc.verdict].tone} icon={lc.verdict === "meets" ? <Check size={12} /> : undefined}>
            {VERDICT[lc.verdict].label}
          </Tag>
        )}
      </div>
      <Field label="Goal">
        <CommitText value={s.goal} placeholder="Not stated yet" onCommit={(goal) => set({ goal: goal.slice(0, 400) })} />
      </Field>
      <Field label="Must be noticed first">
        <CommitText value={s.firstNotice} placeholder="Not stated yet" onCommit={(firstNotice) => set({ firstNotice: firstNotice.slice(0, 400) })} />
      </Field>
      <Field label="Primary action">
        <CommitText value={s.primaryAction} placeholder="Not stated yet" onCommit={(primaryAction) => set({ primaryAction: primaryAction.slice(0, 400) })} />
      </Field>
      {lc && (
        <div className="text-caption text-fg-muted">
          <span dir="auto">{lc.headline}</span> <span className="text-fg-subtle tnum">· {new Date(lc.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>{" "}
          <button
            type="button"
            className="text-fg-subtle underline underline-offset-2 hover:text-fg"
            onClick={() => {
              const d = verdictDecision(id);
              openWhy(d.ref, d.at);
            }}
          >
            Why this verdict?
          </button>
          {lc.keyIssues.length > 0 && (
            <ul className="mt-[4px] flex list-disc flex-col gap-[2px] pl-[16px] text-fg-subtle marker:text-fg-faint">
              {lc.keyIssues.map((k, i) => (
                <li key={i} dir="auto">
                  {k}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        onClick={() => {
          studio().select([id]);
          startCritique([id]);
        }}
      >
        <QalamAIGlyph size={12} /> Critique again
      </Button>
    </div>
  );
}

function SessionStrip({ s }: { s: CritiqueSession }) {
  const names = useStudio((st) => s.screenIds.map((id) => st.doc.nodes[id]?.name ?? s.names[id]).join(", "));
  const status =
    s.fix?.status === "running" ? "Fixing…" : s.fix?.status === "done" ? "Fixed; critique again to check" : s.status === "busy" ? "Thinking…" : s.status === "asking" ? `Question ${s.transcript.length + 1} of ${MAX_QUESTIONS} is waiting` : s.status === "done" ? "Verdict ready" : "Needs a retry";
  return (
    <div className="q-rise flex items-center gap-[10px] rounded-lg bg-ai-subtle py-[8px] pr-[8px] pl-[10px]">
      <QalamAIGlyph size={16} done={s.status === "done"} />
      <div className="min-w-0 flex-1 text-caption">
        <div className="truncate font-medium text-fg">Critiquing {names}</div>
        <div className={clsx("text-fg-muted", s.status === "busy" && "q-shimmer-text")}>{status}</div>
      </div>
      <Button size="sm" variant="secondary" onClick={showCard}>
        Show card
      </Button>
    </div>
  );
}
