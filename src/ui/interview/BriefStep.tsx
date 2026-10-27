import { SAMPLE_ANSWERS } from "@/ai/fixtures-interview";
import type { FlowState } from "../ai/questionFlow";
import { initialFlow, REVIEW, type Answers } from "../ai/questionFlow";
import { Questionnaire } from "../ai/Questionnaire";
import { ErrorNote, Progress } from "../ai/common";
import { Button } from "../controls";
import { QalamAIGlyph } from "../brand";
import { runRead } from "./ai";
import { BRIEF_QUESTIONS, briefAnswers, followUpAnswers, followUpQuestions, practicalFacts } from "./brief";
import { StepHead } from "./InterviewApp";
import { busy, cancelBusy, interview, renameTo, update, useInterview } from "./store";

/**
 * The brief, in the designer's own words. Qalam AI reads it and, only when answers contradict each
 * other or are too vague to place, asks up to three follow-ups before reading it back.
 */

/** Read the brief (round 0), or again with the follow-ups answered (round 1). */
async function read(flow: FlowState, follow?: FlowState, sample?: boolean) {
  const answers = briefAnswers(BRIEF_QUESTIONS, flow.answers);
  const fq = interview().state.brief?.followUps;
  const followUps = fq && follow ? followUpAnswers(followUpQuestions(fq.questions), follow) : undefined;
  const res = await busy(follow ? "Reading your answers again" : "Reading your brief", (signal, onProgress) =>
    runRead(answers, followUps, follow ? 1 : 0, practicalFacts(flow.answers), { signal, onProgress, sample: sample ?? interview().state.sample }),
  );
  if (!res) return;
  if (res.followUps.length && !follow) {
    const questions = followUpQuestions(res.followUps);
    update((s) => ({ ...s, sample: res.sample, brief: { flow, followUps: { questions: res.followUps, flow: initialFlow(questions) } } }));
    return;
  }
  const name = answers.find((a) => a.id === "name")?.answer || res.read.slots.brand;
  renameTo(name);
  update((s) => ({ ...s, sample: res.sample, read: res.read, stage: "read", directions: undefined, brief: { ...s.brief!, flow } }));
}

/** Fill the brief with the recorded sample and read it (no AI needed). */
function trySample() {
  const answers: Answers = Object.fromEntries(
    SAMPLE_ANSWERS.filter((a) => a.id !== "where").map((a) => [a.id, a.answer ? { kind: "text" as const, text: a.answer } : { kind: "skipped" as const }]),
  );
  answers.where = { kind: "multi", values: ["mobile", "en", "ar"], custom: [] };
  const flow: FlowState = { current: REVIEW, answers, visited: BRIEF_QUESTIONS.map((q) => q.id), editing: false, submitted: true };
  update((s) => ({ ...s, sample: true, brief: { flow } }));
  void read(flow, undefined, true);
}

export function BriefStep() {
  const state = useInterview((s) => s.state);
  const working = useInterview((s) => s.busy);
  const error = useInterview((s) => s.error);
  const flow = state.brief?.flow ?? initialFlow(BRIEF_QUESTIONS);
  const follow = state.brief?.followUps;
  const fresh = !state.brief || Object.keys(flow.answers).length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-[20px] px-[16px] py-[40px]">
        <StepHead eyebrow="Design system · Brief" title="Tell Qalam AI about your brand">
          Answer in your own words, the way you would brief a brand designer. Qalam AI reads your answers back, then proposes three directions you can shape on real screens.
        </StepHead>

        {working ? (
          <div className="flex flex-col gap-[8px]">
            <Progress tokens={working.tokens} started={working.started} label={working.label} />
            <Button variant="ghost" size="sm" className="self-start" onClick={cancelBusy}>
              Stop
            </Button>
          </div>
        ) : follow ? (
          <Questionnaire
            questions={followUpQuestions(follow.questions)}
            state={follow.flow}
            title="A few things to clear up"
            onChange={(f) => update((s) => ({ ...s, brief: { ...s.brief!, followUps: { ...follow, flow: f } } }))}
            onSubmit={(f) => {
              update((s) => ({ ...s, brief: { ...s.brief!, followUps: { ...follow, flow: f } } }));
              void read(flow, f);
            }}
            review={{ title: "Ready?", submitLabel: "Read my brief", footnote: "Qalam AI asked these because your answers left them open." }}
          />
        ) : (
          <Questionnaire
            questions={BRIEF_QUESTIONS}
            state={flow}
            title="Your brand"
            onChange={(f) => update((s) => ({ ...s, brief: { ...s.brief, flow: f } }))}
            onSubmit={(f) => {
              update((s) => ({ ...s, brief: { flow: f } }));
              void read(f);
            }}
            review={{ title: "Ready for Qalam AI to read this?", submitLabel: "Read my brief", footnote: "You can change any answer later." }}
          />
        )}

        {error && <ErrorNote message={error} onSample={() => trySample()} />}

        {fresh && !working && (
          <div className="flex items-center gap-[10px] rounded-lg px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <QalamAIGlyph size={14} />
            <p className="min-w-0 flex-1 text-caption text-fg-muted">Want to see how it works first? Try a ready-made brief for a fictional savings app.</p>
            <Button variant="secondary" size="sm" onClick={trySample}>
              Try a sample brief
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
