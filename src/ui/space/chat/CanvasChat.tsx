import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { PanelLeftClose, SquarePen, X } from "lucide-react";
import { DUMP_MAX_CHARS } from "@/discovery/dump";
import { asking, running, threadOf, type DumpOf } from "@/space/chat";
import { useStudio } from "@/doc/store";
import { useAskingIn } from "../../discovery/ask";
import type { ChatMode } from "@/space/route";
import { useSpaceView } from "@/space/view";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { IconBtn, Spinner } from "../../controls";
import { MenuItem } from "../../menu";
import { toQuestion } from "../../ai/plan";
import { Questionnaire } from "../../ai/Questionnaire";
import { answerWords, initialFlow, type FlowState } from "../../ai/questionFlow";
import type { FindWhat } from "@/space/find";
import { r } from "../../recipes";
import { answerRound, picksRound, resumeDumps, saveRound, sessionOf, skipRest, useDump } from "../../discovery/dump";
import { useSources } from "../../discovery/sources";
import { ChatComposer, ChatThread } from "../../chat/ChatThread";
import { attachFiles, clearAttachments, docsCheck, readyDocs, useAttach } from "../../chat/attach";
import { AttachmentChips, SourceMenu } from "../../chat/SourcePicker";
import { toggleChat, useCurrentOrg, useWords } from "../../frame/store";
import { SampleIntro } from "../../org/SampleIntro";
import type { Space } from "../../frame/spaces";
import { ASK_EVENT, takeAskNext } from "../../org/ask-next";
import { PARTS } from "./parts";
import { clearMode, composeIn, useCompose } from "./compose";
import { answerScanRound, askMeInsteadScan, keepScanRound, lookItUpScan, picksScan, scanRoundOf, stopAskingScan, stopScanLookup, answerBriefRound, askMeInsteadBrief, briefRoundOf, keepBriefRound, lookItUpBrief, picksBrief, stopAskingBrief, stopBriefLookup, answerCanvasPlan, answerDraft, answerFind, answerNumber, answerSteer, ask, askMeInsteadDraft, askMeInsteadPlan, keepDraftRound, lookItUpDraft, picksDraft, stopAskingDraft, stopDraftLookup, clearChat, findQuestionsOf, findWith, keepPlanRound, leaveSteer, lookItUpPlan, numberQuestions, openChat, picksCanvasPlan, resumePlans, send, steerQuestionsOf, stopAskingPlan, stopPlanLookup, stopTurn, turnOf, useCanvasChat } from "./store";
import { AskRound } from "../../asking/AskRound";

/*
 * Qalam AI's chat on the left of a space's canvas, as Figma keeps its panel there: one box for
 * whatever they bring (a question, their thinking, a goal or a problem, what customers said, with
 * docs from this computer or a tool), which code sends where it fits (src/space/route.ts); the
 * thread worked out from the canvas's turns (src/space/chat.ts), kept for the canvas on this
 * computer. ⌘\ folds it; a narrow window draws it over the canvas.
 */

export const CHAT_W = 420;

/** What the box is for when a button set it (src/space/route.ts's modes), in a word on the box. */
const MODE_LABEL: Record<ChatMode, string> = { ask: "A question", dump: "Brain dump", take: "To take in", goal: "A goal", problem: "A problem", scan: "An idea or a product", plan: "A plan" };

export function CanvasChat({ space, over }: { space: Space; over?: boolean }) {
  useEffect(() => void openChat(space), [space]);
  const chat = useCanvasChat((s) => s.chat);
  const loaded = useCanvasChat((s) => s.loaded);
  const sources = useSources((s) => s.list);
  const dumpOf = useMemo<DumpOf>(() => (id) => sessionOf(sources.find((x) => x.id === id)), [sources]);
  const messages = useMemo(() => threadOf(chat, dumpOf), [chat, dumpOf]);
  const dumpBusy = useDump((u) => u.busy?.sourceId ?? null);
  // What's running: an ask or a capture, or a brain dump's call.
  const busy = running(chat) ?? (dumpBusy ? (chat.turns.find((t) => t.job.kind === "dump" && t.job.source === dumpBusy) ?? null) : null);
  // The picked card's questions before its draft show first, so "Show it" beside the card leads to them.
  const picked = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const pickedDraft = useAskingIn((s) => (picked ? s.cards[picked] : null));
  const waiting = asking(chat, dumpOf, pickedDraft);
  // The questions while a scan reads don't wait for it, and it doesn't wait for them.
  const steering = !!waiting && "steer" in waiting;
  const { org } = useWords();
  const sample = useCurrentOrg()?.sample;
  const attached = useAttach((s) => s.items);
  const compose = useCompose();
  // Docs picked for another canvas don't come along.
  useEffect(() => clearAttachments(), [space]);

  // After a reload: a dump's step that didn't finish says so, and the proposals it waited on come back on the canvas.
  const active = useSpaceView((s) => s.active);
  const sourcesLoaded = useSources((s) => s.loaded);
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    const key = space ?? "org";
    if (!loaded || !active || !sourcesLoaded || resumed.current === key) return;
    resumed.current = key;
    void resumeDumps();
    resumePlans();
  }, [loaded, active, sourcesLoaded, space]);

  // A question asked from ⌘K (on this page or another) lands here and is asked.
  const asked = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const take = (q: string | null) => q && void ask(q);
    if (!asked.current) take(takeAskNext());
    asked.current = true;
    const on = (e: Event) => take((e as CustomEvent<string>).detail);
    window.addEventListener(ASK_EVENT, on);
    return () => window.removeEventListener(ASK_EVENT, on);
  }, [loaded]);

  return (
    <section
      aria-label="Qalam AI"
      data-ask-bar
      data-tour="chat"
      className={clsx("q-glass flex shrink-0 flex-col overflow-hidden rounded-xl bg-panel", over ? "absolute top-0 bottom-[8px] left-[8px] z-30 max-w-[calc(100%-16px)] shadow-floating" : "shadow-panel")}
      style={{ width: CHAT_W }}
    >
      <header className="flex h-[40px] shrink-0 items-center gap-[8px] pr-[8px] pl-[16px]">
        <QalamAIGlyph size={14} />
        <h2 className="text-body font-medium text-fg">Qalam AI</h2>
        <span className="flex-1" />
        {chat.turns.length > 0 && (
          <IconBtn size="sm" label="New chat" onClick={clearChat}>
            <SquarePen size={14} absoluteStrokeWidth strokeWidth={1.25} />
          </IconBtn>
        )}
        <IconBtn size="sm" label="Hide Qalam AI" onClick={() => toggleChat(false)}>
          <PanelLeftClose size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </header>
      <div className="min-h-0 flex-1">
        <ChatThread
          messages={messages}
          running={!!busy}
          onCancel={() => busy && stopTurn(busy.id)}
          parts={PARTS}
          empty={
            loaded &&
            (sample ? (
              <SampleIntro />
            ) : (
              <div className="flex flex-col gap-[10px] pt-[8px]">
                <p className="text-body text-fg">Ask what your {org} knows, or bring something to the canvas.</p>
                <button type="button" className={clsx(r.replyChip, "self-start")} onClick={() => composeIn({ mode: "scan" })}>
                  <QalamAIGlyph size={12} /> Look into an idea or a product
                </button>
                <p className="text-caption text-fg-muted">A question is answered from its problem pages, sources, boards and decisions. Reports, research, interviews and tickets go into problems&apos; pages, each saying what it is; your thinking is read and placed as cards; a goal or a problem is worded for the canvas, for you to use or change.</p>
                <div className="flex flex-wrap gap-[6px]">
                  {(["goal", "problem"] as FindWhat[]).map((w) => (
                    <button key={w} type="button" className={r.replyChip} onClick={() => findWith(w, space)}>
                      <QalamAIGlyph size={12} /> Help me find {w === "goal" ? "a goal" : "a problem"}
                    </button>
                  ))}
                </div>
              </div>
            ))
          }
          // The box stays at the bottom wherever it shows (with Stop while a goal's look runs before its questions); a round of questions flows after the thread.
          pinned={!waiting || (!!busy && !steering)}
          footer={
            waiting && (!busy || steering) ? (
              "steer" in waiting ? (
                <SteerRound key={waiting.turn.id} turn={waiting.turn.id} />
              ) : "planning" in waiting ? (
                <CanvasPlanRound key={`${waiting.turn.id}:${waiting.turn.job.kind === "plan" ? waiting.turn.job.rounds.length : 0}`} turn={waiting.turn.id} />
              ) : "brief" in waiting ? (
                <BriefRound key={waiting.turn.id} turn={waiting.turn.id} />
              ) : "number" in waiting ? (
                <NumberRound key={waiting.turn.id} turn={waiting.turn.id} />
              ) : "plan" in waiting ? (
                <PlanRound key={waiting.turn.id} turn={waiting.turn.id} />
              ) : "find" in waiting ? (
                <FindRound key={`${waiting.turn.id}:${waiting.find}`} turn={waiting.turn.id} what={waiting.find} />
              ) : "drafting" in waiting ? (
                <DraftAskRound key={waiting.turn.id} turn={waiting.turn.id} />
              ) : (
                <DumpRound key={`${waiting.source}:${dumpOf(waiting.source)?.buckets.length}`} source={waiting.source} dumpOf={dumpOf} />
              )
            ) : (
            <ChatComposer
              label="Message Qalam AI"
              placeholder="Ask, or paste your thinking…"
              submit="enter"
              disabled={!loaded}
              running={!!busy}
              onStop={() => busy && stopTurn(busy.id)}
              draftKey={`chat:${space ?? "org"}:${compose.key}`}
              draft={compose.text}
              plus={
                <SourceMenu fit="customers" manage>
                  {!busy &&
                    (["goal", "problem"] as FindWhat[]).map((w) => (
                      <MenuItem key={w} icon={<QalamAIGlyph size={14} />} onSelect={() => findWith(w, space)}>
                        Help me find {w === "goal" ? "a goal" : "a problem"}
                      </MenuItem>
                    ))}
                  {!busy && (
                    <MenuItem icon={<QalamAIGlyph size={14} />} onSelect={() => composeIn({ mode: "plan" })}>
                      Work something out as a plan
                    </MenuItem>
                  )}
                </SourceMenu>
              }
              attached={<AttachmentChips kinds />}
              onFiles={attachFiles}
              sendEmpty={readyDocs(attached).length > 0}
              chip={
                compose.mode && (
                  <span className="inline-flex h-[20px] items-center gap-[4px] rounded-sm bg-ai-subtle pr-[2px] pl-[6px] text-micro font-medium whitespace-nowrap text-ai">
                    {MODE_LABEL[compose.mode]}
                    <button type="button" aria-label="Let the chat work out what it is" onClick={clearMode} className="grid size-[16px] place-items-center rounded-sm hover:bg-hover">
                      <X size={10} absoluteStrokeWidth strokeWidth={1.5} />
                    </button>
                  </span>
                )
              }
              check={(t) => {
                if (t.length > DUMP_MAX_CHARS) return `That's over ${DUMP_MAX_CHARS.toLocaleString()} characters: paste the most useful part, or bring it as a doc.`;
                const docs = docsCheck(t, attached, null);
                if (docs) return docs;
                if (compose.mode === "scan") return t.trim().length >= 2 ? null : "Name a product, or say what you want to build.";
                if (compose.mode === "dump" && !readyDocs(attached).length && t.trim().length < 40) return "Write a few sentences more: what you think, and why.";
                return readyDocs(attached).length || t.trim().length >= 3 ? null : "Write a little more.";
              }}
              onSend={(t) => {
                const ok = send(t, readyDocs(attached));
                if (ok) clearAttachments();
                return ok;
              }}
            />
            )
          }
        />
      </div>
    </section>
  );
}

/** "Help me find one"'s opening round: Qalam AI's questions from what's known about the domain, once they're worked out, else code's own. */
function FindRound({ turn, what }: { turn: string; what: FindWhat }) {
  const job = useCanvasChat((s) => s.chat.turns.find((t) => t.id === turn)?.job);
  const loading = job?.kind === "find" && !!job.loading;
  if (loading)
    return (
      <p className={clsx(r.chatStatus, "px-[4px] py-[8px] text-fg-muted")}>
        <Spinner size={12} /> <span className="q-shimmer-text">Qalam AI is working out what to ask, from what's known about it…</span>
      </p>
    );
  return <FindForm key={job?.kind === "find" && job.questions ? "ai" : "code"} turn={turn} what={what} />;
}

function FindForm({ turn, what }: { turn: string; what: FindWhat }) {
  const job = turnOf(turn)?.job;
  const goal = job?.kind === "find" ? job.goal : undefined;
  const questions = useMemo(() => {
    const j = turnOf(turn)?.job;
    return findQuestionsOf(j?.kind === "find" ? j : { what }).map(toQuestion);
  }, [turn, what]);
  const [form, setForm] = useState<FlowState>(() => initialFlow(questions));
  // A choice is their answer in its own words; skipped and empty ones are left out.
  const answerOf = (f: FlowState, q: (typeof questions)[number]) => answerWords(q, f.answers[q.id]).text;
  return (
    <Questionnaire
      title={goal ? "To find the problem to focus on" : what === "goal" ? "To find a goal" : "To find a problem"}
      questions={questions}
      state={form}
      onChange={setForm}
      onSubmit={(f) => void answerFind(turn, Object.fromEntries(questions.map((q) => [q.id, answerOf(f, q)])))}
      review={{ submitLabel: "Send answers" }}
    />
  );
}

/** The questions while a scan reads, each one skippable. If it finishes before they start on them, they go: what's still wanted is asked later. */
function SteerRound({ turn }: { turn: string }) {
  const questions = useMemo(() => steerQuestionsOf(turn).map(toQuestion), [turn]);
  const [form, setForm] = useState<FlowState>(() => initialFlow(questions));
  const untouched = useRef(form);
  const over = useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "scan" && !!j.session && j.session.state !== "reading";
  });
  useEffect(() => {
    if (over && form === untouched.current) leaveSteer(turn);
  }, [over, form, turn]);
  const answerOf = (f: FlowState, q: (typeof questions)[number]) => answerWords(q, f.answers[q.id]).text;
  return <Questionnaire title="While I read" questions={questions} state={form} onChange={setForm} onSubmit={(f) => answerSteer(turn, Object.fromEntries(questions.map((q) => [q.id, answerOf(f, q)])))} />;
}

/** The brief's interview (src/asking/): code's questions first, then what else it needs, for as long as it needs; every one can be skipped. */
function BriefRound({ turn }: { turn: string }) {
  const kept = useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return (j?.kind === "brief" ? j.brief : j?.kind === "scan" ? j.plan?.brief : undefined)?.asking ?? null;
  });
  // A brief from before kept only its questions: they're read as the first round.
  const before = useMemo(() => briefRoundOf(turn), [turn]);
  const state = kept ?? before;
  if (!state) return null;
  const job = turnOf(turn)?.job;
  const shape = job?.kind === "brief" ? job.shape : undefined;
  const title = state.rounds.length > 1 ? undefined : shape === "message" ? "For the message plan" : shape === "steps" ? "For the steps" : "For the brief";
  return <AskRound state={state} title={title} onKeep={(f) => keepBriefRound(turn, f)} onSend={(f) => answerBriefRound(turn, f)} onPicks={(f) => picksBrief(turn, f)} onStop={(f) => stopAskingBrief(turn, f)} onStopLookup={(id) => stopBriefLookup(turn, id)} onLookItUp={() => lookItUpBrief(turn)} onAskMe={() => askMeInsteadBrief(turn)} />;
}

/** The interview before working out who it's for and what comes first (src/asking/): as many rounds as it needs, every question skippable. */
function PlanRound({ turn }: { turn: string }) {
  const kept = useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "scan" ? (j.plan?.asking ?? null) : null;
  });
  // A plan from before kept only its questions: they're read as a round.
  const before = useMemo(() => scanRoundOf(turn), [turn]);
  const state = kept ?? before;
  if (!state) return null;
  return <AskRound state={state} title={state.rounds.filter((r) => !r.said).length > 1 ? undefined : "Before I work out what comes first"} onKeep={(f) => keepScanRound(turn, f)} onSend={(f) => answerScanRound(turn, f)} onPicks={(f) => picksScan(turn, f)} onStop={(f) => stopAskingScan(turn, f)} onStopLookup={(id) => stopScanLookup(turn, id)} onLookItUp={() => lookItUpScan(turn)} onAskMe={() => askMeInsteadScan(turn)} />;
}

/** The questions before a card's draft (src/asking/): every question it can ask now, Qalam AI's picks in one press, and Stop asking. */
function DraftAskRound({ turn }: { turn: string }) {
  const state = useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "draft" ? j.asking : null;
  });
  if (!state) return null;
  return (
    <AskRound
      state={state}
      onKeep={(f) => keepDraftRound(turn, f)}
      onSend={(f) => answerDraft(turn, f)}
      onPicks={(f) => picksDraft(turn, f)}
      onStop={(f) => stopAskingDraft(turn, f)}
      onStopLookup={(id) => stopDraftLookup(turn, id)}
      onLookItUp={() => lookItUpDraft(turn)}
      onAskMe={() => askMeInsteadDraft(turn)}
    />
  );
}

/** What a plan can't tell from what it has (src/asking/): every question it can ask now, Qalam AI's picks in one press, and Stop asking. */
function CanvasPlanRound({ turn }: { turn: string }) {
  const state = useCanvasChat((s) => {
    const j = s.chat.turns.find((t) => t.id === turn)?.job;
    return j?.kind === "plan" ? (j.asking ?? null) : null;
  });
  if (!state) return null;
  return (
    <AskRound
      state={state}
      onKeep={(f) => keepPlanRound(turn, f)}
      onSend={(f) => answerCanvasPlan(turn, f)}
      onPicks={(f) => picksCanvasPlan(turn, f)}
      onStop={(f) => stopAskingPlan(turn, f)}
      onStopLookup={(id) => stopPlanLookup(turn, id)}
      onLookItUp={() => lookItUpPlan(turn)}
      onAskMe={() => askMeInsteadPlan(turn)}
    />
  );
}

/** A goal's number, asked once a problem's goal is picked: what's left out is suggested. */
function NumberRound({ turn }: { turn: string }) {
  const questions = useMemo(() => numberQuestions(turn).map(toQuestion), [turn]);
  const [form, setForm] = useState<FlowState>(() => initialFlow(questions));
  const answerOf = (f: FlowState, q: (typeof questions)[number]) => answerWords(q, f.answers[q.id]).text;
  return <Questionnaire title="Its number" questions={questions} state={form} onChange={setForm} onSubmit={(f) => void answerNumber(turn, Object.fromEntries(questions.map((q) => [q.id, answerOf(f, q)])))} review={{ submitLabel: "Send answers" }} />;
}

/** A brain dump's round of questions, in place of the box until it's answered (or skipped, in the thread). */
function DumpRound({ source, dumpOf }: { source: string; dumpOf: DumpOf }) {
  const s = dumpOf(source);
  const i = (s?.buckets.length ?? 1) - 1;
  const b = s?.buckets[i];
  const [form, setForm] = useState<FlowState | null>(b?.form ?? null);
  if (!b || !form) return null;
  const recommends = b.questions.some((q) => q.recommended.length > 0 && q.options.length > 1);
  return (
    <div className="flex flex-col gap-[4px]">
      <Questionnaire
        title={`Round ${i + 1}`}
        questions={b.questions.map(toQuestion)}
        state={form}
        onChange={(f) => {
          setForm(f);
          saveRound(source, f);
        }}
        onSubmit={(f) => void answerRound(source, f)}
        review={{ submitLabel: "Send answers" }}
      />
      <div className="flex flex-wrap items-center gap-[2px] px-[2px]">
        {recommends && (
          <button type="button" className={r.replyChip} title="Every question you haven't answered takes Qalam AI's recommendation, kept as its pick, never as your words" onClick={() => void picksRound(source, form)}>
            Use Qalam AI&apos;s picks
          </button>
        )}
        <button type="button" className={r.replyChip} onClick={() => void skipRest(source, form)}>
          Stop asking
        </button>
      </div>
    </div>
  );
}

/** The chat folded: a pill at the canvas's top-left brings it back. */
export function ChatPill() {
  return (
    <button type="button" data-tour="chat" onClick={() => toggleChat(true)} className="q-item q-press q-glass absolute top-[12px] left-[12px] z-10 inline-flex h-[34px] items-center gap-[6px] rounded-xl bg-raised px-[12px] text-caption font-medium text-fg shadow-floating hover:bg-hover">
      <QalamAIGlyph size={12} /> Qalam AI
    </button>
  );
}
