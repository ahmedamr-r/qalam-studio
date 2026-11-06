import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeft, FileUp, MessagesSquare, Network, NotebookPen, Play, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { CORE_QUESTIONS, interviewAnswers, type InterviewAnswer } from "@/discovery/interview";
import { answersOf, awaitsConfirm, currentRound, emptyAsking, loaded } from "@/asking/engine";
import type { AskingState } from "@/asking/types";
import { SAMPLE_ANSWERS } from "@/ai/fixtures-discovery";
import { updateProject, useProject } from "@/projects/session";
import type { DiscoveryState } from "@/discovery/types";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { Questionnaire } from "../ai/Questionnaire";
import { ErrorNote, Progress } from "../ai/common";
import { Button, Field, IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { confirmDialog } from "../surfaces/dialog";
import { getController } from "../CanvasView";
import { draftTree, hasOutcome, stopDraft, treeFor } from "./draft";
import { runInterviewTurn } from "./ai";
import { answer, askMeInstead, confirm, goOn, keepRound, lookItUp, off, picks, stopAsking, type AskingHost, type Paused } from "../asking/run";
import { AskRound, SettledCard } from "../asking/AskRound";
import { useDiscovery } from "./store";
import { openBrainDump } from "./dump";
import { startTitleEdit } from "./editing";
import { AddSource } from "./SourcesPanel";
import { addSources, type AddInput } from "./import";

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * How a board starts: six questions about the product (then up to three of Qalam AI's), research
 * to import (documents, pages, connected tools), the recorded sample, or a blank tree. Answers are saved on the project as they're given, so an
 * unfinished interview resumes. While Qalam AI drafts, the sheet steps aside for the board, where
 * the tree takes shape, and a pill offers Stop.
 */
export default function StartSheet() {
  const sheet = useDiscovery((s) => s.sheet);
  const drafting = useDiscovery((s) => s.drafting);
  if (drafting) return <DraftingPill />;
  if (sheet === "closed" || sheet === "drafting") return null;
  return (
    <div className="pointer-events-auto absolute inset-0 grid place-items-start justify-center overflow-y-auto bg-overlay/40 px-[16px] pt-[48px] pb-[96px]">
      <div role="dialog" aria-label="Start your tree" className="q-pop flex w-[min(560px,100%)] flex-col rounded-xl bg-panel shadow-modal">
        {sheet === "start" ? <Start /> : sheet === "import" ? <ImportStep /> : <Interview followups={sheet === "followups"} />}
      </div>
    </div>
  );
}

function Header({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-[48px] shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[8px] pl-[16px]">
      {onBack && (
        <IconBtn size="sm" label="Back" onClick={onBack}>
          <ArrowLeft size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      )}
      <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
      {children}
      <IconBtn size="sm" label="Close" onClick={close}>
        <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
      </IconBtn>
    </div>
  );
}

/** Closed by hand: the board is the builder's to fill (the sheet won't come back by itself). */
function close() {
  useDiscovery.setState({ sheet: "closed" });
  void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: "ready" } }), { touch: false });
}

function Start() {
  const hasTree = useStudio((s) => hasOutcome(s.doc));
  return (
    <>
      <Header title={hasTree ? "Start over" : "Map the problems behind your goal"} />
      <div className="flex flex-col gap-[16px] p-[16px]">
        <p className="text-body leading-[20px] text-fg-muted">
          The goal, the problems customers have, what to try. What nobody has shown yet is marked <b className="font-medium text-fg">Assumed</b>.
        </p>
        <div className="flex flex-col gap-[8px]">
          <Option icon={<MessagesSquare {...ICON} />} title="Answer six questions" body="Two minutes. Qalam AI drafts the tree." onClick={() => useDiscovery.setState({ sheet: "interview" })} primary />
          <Option icon={<NotebookPen {...ICON} />} title="Start from a brain dump" body="Paste your thinking. Qalam AI asks, then places it." onClick={() => openBrainDump()} />
          <Option icon={<FileUp {...ICON} />} title="Import research" body="Interviews, tickets, a page: what customers said, as problems." onClick={() => useDiscovery.setState({ sheet: "import" })} />
          <Option icon={<Play {...ICON} />} title="Try a sample" body="A tree drafted for Basket, a made-up grocery app." onClick={() => void sample()} />
          {!hasTree && <Option icon={<Network {...ICON} />} title="Start with a blank tree" body="Name the goal and build it yourself." onClick={blank} />}
        </div>
      </div>
    </>
  );
}

function Option({ icon, title, body, onClick, primary }: { icon: ReactNode; title: string; body: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "q-item q-press flex items-start gap-[12px] rounded-lg p-[12px] text-left",
        primary ? "bg-raised shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-elevated" : "shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover",
      )}
    >
      <span className="grid size-[32px] shrink-0 place-items-center rounded-md bg-muted text-fg">{icon}</span>
      <span className="flex flex-col gap-[2px]">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-muted">{body}</span>
      </span>
    </button>
  );
}

/** Replacing a tree asks first (⌘Z brings it back). */
async function replaceOk(): Promise<string | null | false> {
  const s = studio();
  const tree = treeFor(s.doc, s.selection);
  if (!tree) return null;
  const title = s.doc.nodes[tree].meta.ost?.title.trim();
  const ok = await confirmDialog({ title: title ? `Replace “${title}”?` : "Replace the current tree?", body: "Qalam AI drafts a new tree from your answers in its place. Undo brings the old one back.", confirmLabel: "Replace the tree" });
  return ok ? tree : false;
}

async function sample() {
  const replace = await replaceOk();
  if (replace === false) return;
  void draftTree({ answers: SAMPLE_ANSWERS, sample: true, replace });
}

function blank() {
  const s = studio();
  const c = getController();
  const cam = s.camera;
  const vw = c?.viewport.w ?? 900;
  const node = makeCardNode(newCard("outcome"), { x: Math.round(cam.x + vw / 2 / cam.zoom - 160), y: Math.round(cam.y + 120 / cam.zoom) });
  close();
  s.beginTx();
  s.mutate((d) => addCardIn(d, node, null));
  s.select([node.id]);
  startTitleEdit(node.id, true);
}

// ---------------------------------------------------------------------------
// Import: start from what customers said

/** What's been picked to bring in, before it's read. */
const itemLabel = (i: AddInput) => (i.kind === "file" ? i.file.name : i.kind === "url" ? i.url : i.kind === "paste" ? `Pasted text · ${i.text.trim().slice(0, 40)}…` : `${i.label}: ${i.request}`);

function ImportStep() {
  const hasTree = useStudio((s) => hasOutcome(s.doc));
  const [outcome, setOutcome] = useState("");
  const [items, setItems] = useState<AddInput[]>([]);
  const ready = items.length > 0 && (hasTree || outcome.trim().length >= 3);
  const go = () => {
    if (!ready) return;
    close();
    if (!hasTree) {
      const s = studio();
      const c = getController();
      const vw = c?.viewport.w ?? 900;
      const node = makeCardNode(newCard("outcome", { title: outcome.trim().replace(/\s+/g, " ") }), { x: Math.round(s.camera.x + vw / 2 / s.camera.zoom - 160), y: Math.round(s.camera.y + 120 / s.camera.zoom) });
      s.mutate((d) => addCardIn(d, node, null));
      s.select([node.id]);
    }
    studio().setLeftTab("sources");
    void addSources(items);
  };
  return (
    <>
      <Header title="Import research" onBack={() => useDiscovery.setState({ sheet: "start" })} />
      <div className="flex flex-col gap-[16px] p-[16px]">
        <p className="text-body leading-[20px] text-fg-muted">
          Qalam AI reads what you bring, picks out what customers said and proposes problems from it. Code checks every quote against its source, word for word; nothing lands on the tree until you accept it.
        </p>
        {!hasTree && (
          <Field label="The goal you want to move">
            <label className={r.field}>
              <input className={r.fieldInput} aria-label="Goal" placeholder="More customers reorder every week" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            </label>
          </Field>
        )}
        <AddSource compact onAdd={(more) => setItems((cur) => [...cur, ...more])} />
        {items.length > 0 && (
          <ul aria-label="To bring in" className="flex flex-col gap-[2px]">
            {items.map((it, i) => (
              <li key={i} className="flex h-[28px] items-center gap-[8px] rounded-md pr-[2px] pl-[8px] text-caption text-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                <span className="min-w-0 flex-1 truncate">{itemLabel(it)}</span>
                <IconBtn size="sm" label="Leave it out" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>
                  <X size={12} absoluteStrokeWidth strokeWidth={1.25} />
                </IconBtn>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-[8px]">
          <Button disabled={!ready} onClick={go}>
            Read {items.length > 1 ? `these ${items.length}` : "it"}
          </Button>
          {!ready && <span className="text-caption text-fg-subtle">{!items.length ? "Add a file, a page or some text." : "Name the goal first."}</span>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The interview

const saveTimer: { t?: ReturnType<typeof setTimeout> } = {};
/** The interview as it stands, saved on the project (debounced: typing is many changes). */
function saveInterview(patch: Partial<NonNullable<DiscoveryState["interview"]>>, now = false) {
  const write = () => void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: p.discovery?.stage === "ready" ? "ready" : "interview", interview: { ...(p.discovery?.interview ?? { flow: initialFlow(CORE_QUESTIONS) }), ...patch } } }), { touch: false });
  clearTimeout(saveTimer.t);
  if (now) write();
  else saveTimer.t = setTimeout(write, 500);
}

function Interview({ followups }: { followups: boolean }) {
  const saved = useProject((s) => s.project?.discovery?.interview);
  const [flow, setFlow] = useState<FlowState>(() => saved?.flow ?? initialFlow(CORE_QUESTIONS));
  // After its own questions, the interview (src/asking/): Qalam AI's rounds, for as long as it needs.
  const [asking, setAsking] = useState<AskingState | null>(() => (saved?.asking ? loaded(saved.asking) : null));
  const live = useRef(asking);
  live.current = asking;
  const [busy, setBusy] = useState<{ started: number; tokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const answers = (f: FlowState = flow): InterviewAnswer[] => interviewAnswers(CORE_QUESTIONS, f.answers);
  // Only their own words reach the draft, which quotes them: Qalam AI's picks only steered what it asked.
  const own = (s: AskingState): InterviewAnswer[] => answersOf(s).flatMap((a) => (a.how === "own" && a.text ? [{ id: `follow-${a.id}`.slice(0, 40), question: a.question.slice(0, 400), answer: a.text.slice(0, 2000) }] : [])).slice(0, 40);

  const draft = async (core: InterviewAnswer[], more: InterviewAnswer[]) => {
    const replace = await replaceOk();
    if (replace === false) return;
    void draftTree({ answers: core, followUps: more, replace });
  };

  const host = (core: InterviewAnswer[]): AskingHost => ({
    key: "board-interview",
    get: () => live.current,
    set: (fn) => {
      const next = fn(live.current ?? emptyAsking());
      live.current = next;
      setAsking(next);
      saveInterview({ asking: next });
    },
    turn: (s, signal) => runInterviewTurn(core, s, { signal, onProgress: (tokens) => setBusy((b) => (b ? { ...b, tokens } : b)) }),
    lookup: async () => ({ lines: [] }),
    generate: async (s) => void draft(core, own(s)),
  });

  /** On from where the interview is, until a round, What we settled, or the draft. */
  const go = async (step: (h: AskingHost, signal: AbortSignal) => Promise<Paused>, core = answers()) => {
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setBusy({ started: Date.now(), tokens: 0 });
    try {
      const why = await step(host(core), c.signal);
      setBusy(null);
      if (why !== "generated") useDiscovery.setState({ sheet: "followups" });
    } catch (e) {
      setBusy(null);
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onCore = (done: FlowState) => {
    setFlow(done);
    saveInterview({ flow: done }, true);
    const fresh = emptyAsking();
    live.current = fresh;
    setAsking(fresh);
    saveInterview({ asking: fresh }, true);
    void go((h, signal) => goOn(h, signal), answers(done));
  };

  if (busy)
    return (
      <>
        <Header title="Reading your answers" />
        <div className="flex flex-col gap-[12px] p-[16px]">
          <Progress tokens={busy.tokens} started={busy.started} label="Qalam AI is reading your answers…" />
          <Button size="sm" variant="secondary" className="self-start" onClick={() => ctrl.current?.abort()}>
            Stop
          </Button>
        </div>
      </>
    );

  if (followups && asking) {
    const settled = awaitsConfirm(asking);
    return (
      <>
        <Header title={settled ? "What we settled" : "A few more questions"} onBack={() => useDiscovery.setState({ sheet: "interview" })} />
        <div className="flex flex-col gap-[12px] p-[16px]">
          {error && <ErrorNote message={error} />}
          {settled ? (
            <SettledCard state={asking} go="Draft my tree" onGo={() => void go((h, signal) => confirm(h, signal))} onOff={() => off(host(answers()))} onTerm={() => {}} />
          ) : currentRound(asking) || asking.offer ? (
            <AskRound
              state={asking}
              title={asking.rounds.length > 1 ? undefined : "Before Qalam AI drafts"}
              onKeep={(f) => keepRound(host(answers()), f)}
              onSend={(f) => void go((h, signal) => answer(h, f, signal))}
              onPicks={(f) => void go((h, signal) => picks(h, f, signal))}
              onStop={(f) => void go((h, signal) => stopAsking(h, f, signal))}
              onStopLookup={() => {}}
              onLookItUp={() => void go((h, signal) => lookItUp(h, signal))}
              onAskMe={() => void go((h, signal) => askMeInstead(h, signal))}
            />
          ) : (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => void go((h, signal) => goOn(h, signal))}>
              Go on
            </Button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="About your product" onBack={() => useDiscovery.setState({ sheet: "start" })} />
      <div className="flex flex-col gap-[12px] p-[16px]">
        {error && (
          <div className="flex flex-col gap-[8px]">
            <ErrorNote message={error} />
            <Button size="sm" variant="secondary" className="self-start" onClick={() => void draft(answers(), [])}>
              Draft without follow-ups
            </Button>
          </div>
        )}
        <Questionnaire
          title="Six questions"
          questions={CORE_QUESTIONS}
          state={{ ...flow, submitted: false }}
          onChange={(f) => {
            setFlow(f);
            saveInterview({ flow: f });
          }}
          onSubmit={(f) => void onCore(f)}
          review={{ submitLabel: "Continue", footnote: "Your answers stay in this project. Qalam AI quotes them as evidence, word for word." }}
        />
      </div>
    </>
  );
}

/** While Qalam AI drafts: what's happening, and Stop (the cards written so far stay). */
function DraftingPill() {
  return (
    <div className="pointer-events-auto absolute top-[12px] left-1/2 flex -translate-x-1/2 items-center gap-[10px] rounded-lg bg-elevated py-[6px] pr-[6px] pl-[10px] text-caption font-medium text-fg shadow-popover q-fade" role="status">
      <QalamAIGlyph size={14} />
      <span className="q-shimmer-text">Qalam AI is drafting your tree</span>
      <Spinner size={12} />
      <Button size="sm" variant="secondary" onClick={stopDraft}>
        Stop
      </Button>
    </div>
  );
}

