import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Link2, RotateCcw, Star, Target } from "lucide-react";
import { CHALLENGE_LABEL } from "@/discovery/dump";
import { useGoals } from "@/goals/client";
import { NAME_MAX, POSITIONS, TITLE_MAX, useYou, type Position } from "@/org/you";
import { chooseVoice, useVoice } from "@/org/voice";
import type { VoiceChoice } from "@/voice/model";
import { childrenOf } from "@/goals/tree";
import { useOrgContext } from "@/org/context";
import { boardGoals, pendingLines, pickedDocs, soleOwner } from "@/org/setup";
import { goalHref, orgHref, placeHref, topicHref } from "@/projects/model";
import type { RankedNeed } from "@/hub/needs";
import { needsDb } from "@/org/needs";
import { feedback } from "@/commands/feedback";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo, EngineLogo } from "../brand/ConnectorLogo";
import { Button, Checkbox, Spinner, Tag } from "../controls";
import { toQuestion } from "../ai/plan";
import { qr, Radio } from "../ai/Questionnaire";
import { answerOf, summarize, type Answers, type Question } from "../ai/questionFlow";
import { ErrorNote, Progress } from "../ai/common";
import { CopyCommand, EngineSetup, whoLine } from "../connections/EngineCard";
import { ThisMac } from "../connections/ThisMac";
import { DocsSent } from "../chat/SourcePicker";
import { ReplyChips, type PartComponent } from "../chat/ChatThread";
import type { PartData } from "../chat/types";
import { r } from "../recipes";
import { StatusDot } from "../viz";
import { addKnown, editKnown, skipKnown, useKnow } from "../setup/know";
import { acceptLines, placeSetup, retrySetup, skipSetupRest, startBoard, startIdeaBoard, useSetup, useSetupQuotes } from "../setup/setup";
import { connectFor, stepAfter } from "../welcome/steps";
import { lab } from "@/lab";
import { Dictated } from "../voice/MicButton";
import { ParakeetInstall } from "../voice/ParakeetInstall";
import { wordsFor } from "@/org/words";
import { FoundGoalRow } from "../chat/FoundGoalRow";
import { setUpProperly, checkEngine, decideGoal, engineChanged, finishFirstRun, findCompetitors, goStep, keepCompetitors, keepFacts, lookAgain, noWebsite, skipCompetitors, startOnCanvas, takeAs, openKeyField, pickDoor, pickShape, saveVoice, saveYou, saveYours, skipEngine, togglePick, useFirstRun } from "./flow";
import { useMarket } from "@/org/market";
import { FIELD_LABEL, type Competitor, type MarketLine } from "@/market/types";
import { lookForCompetitors } from "@/org/market";
import { treeRows } from "./places";
import { reviewNext } from "./dock";

/*
 * What the first run's conversation draws besides words (named parts, ./thread.ts): the engine
 * check, answers that act, what was sent, what Qalam AI took from it, the pushback, the answers
 * given, which goals are theirs, what to connect, and the end. Each reads what it needs from the
 * stores, so a part's data stays a few small values.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Long text clamped to a few lines, with More. */
function Clamp({ text, lines, className }: { text: string; lines: 2 | 6; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > (lines === 2 ? 180 : 520) || text.split("\n").length > lines;
  return (
    <div className="flex flex-col items-start gap-[2px]">
      <p className={clsx("whitespace-pre-wrap", !open && (lines === 2 ? "line-clamp-2" : "line-clamp-6"), className)} dir="auto">
        {text}
      </p>
      {long && (
        <button type="button" className={clsx(qr.textBtn, "-ml-[6px]")} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qalam AI, and the name

function EnginePart({ data }: { data: PartData }) {
  const e = useFirstRun((s) => s.engine);
  const mode = useFirstRun((s) => s.mode);
  const [error, setError] = useState<string | null>(null);
  const v = e.view;
  const test = e.test ?? v?.test ?? null;
  const ok = !!test?.ok;
  const who = v ? whoLine(v) : "";
  if (data.compact)
    return who && v ? (
      <p className="flex items-center gap-[6px] text-caption text-fg-muted">
        <StatusDot tone={ok || v.ready ? "ok" : "bad"} /> <EngineLogo kind={v.kind} size={16} decorative /> {who}
      </p>
    ) : null;
  const word = e.checking ? (v ? "Making a short call" : "Looking") : ok ? "Ready" : e.skipped ? "Later" : (test?.word ?? v?.word ?? "Not set up");
  const detail = e.checking || ok || e.skipped ? null : (test?.detail ?? v?.detail);
  const changes = mode !== "verify";
  return (
    <div className={clsx(qr.inset, "flex flex-col gap-[10px] p-[12px]")}>
      <div className="flex items-start gap-[10px]">
        <span className={clsx("grid size-[28px] shrink-0 place-items-center rounded-md", ok ? "bg-success-subtle text-success" : "bg-panel")}>{ok ? <Check size={15} strokeWidth={2} /> : e.checking ? <Spinner size={13} /> : <QalamAIGlyph size={14} />}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            {!e.checking && <StatusDot tone={ok ? "ok" : e.skipped ? "off" : "bad"} hollow={e.skipped && !ok} />}
            <span className={clsx(e.checking && "q-shimmer-text")}>{word}</span>
            {ok && test && <span className="text-fg-subtle tnum">· {(test.ms / 1000).toFixed(1)} s</span>}
          </p>
          {who && v && (
            <p className="flex min-w-0 items-center gap-[8px] text-body text-fg">
              <EngineLogo kind={v.kind} size={20} decorative />
              <span className="truncate">{who}</span>
            </p>
          )}
          {detail && <p className="text-caption text-fg-muted">{detail}</p>}
          {(e.error || error) && <p className="text-caption text-danger">{e.error ?? error}</p>}
        </div>
      </div>
      {!e.checking && !ok && !e.skipped && (
        <ReplyChips>
          {v?.kind === "cli" && test?.word === "Signed out" && <CopyCommand command="claude auth login" />}
          {v?.kind === "codex" && test?.word === "Signed out" && <CopyCommand command="codex login" />}
          {v?.kind === "cli" && !v.claude.found && (
            <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer" className={r.replyChip}>
              Install Claude Code
            </a>
          )}
          <button type="button" className={r.replyChip} onClick={() => void checkEngine()}>
            Check again
          </button>
          {changes && !e.keyOpen && (
            <button type="button" className={r.replyChip} onClick={() => openKeyField(true)}>
              Use another engine
            </button>
          )}
          {changes && (
            <button type="button" className={clsx(qr.textBtn, "ml-auto")} onClick={skipEngine}>
              Set up later
            </button>
          )}
        </ReplyChips>
      )}
      {e.keyOpen && v && !ok && <EngineSetup view={v} fresh onError={setError} onView={(next) => void engineChanged(next)} />}
    </div>
  );
}

function VerifyPart() {
  return <ThisMac withEngine={false} />;
}

// ---------------------------------------------------------------------------
// Answers that act

function ChoicesPart({ data }: { data: PartData }) {
  const [working, setWorking] = useState(false);
  const busy = useSetup((s) => !!s.busy);
  const session = useSetup((s) => s.source?.setup);
  const act = (fn: () => Promise<unknown> | unknown) => async () => {
    if (working || busy) return;
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };
  const chip = (label: ReactNode, fn: () => unknown, primary = false) => (
    <button type="button" disabled={working || busy} className={primary ? r.replyChipPrimary : r.replyChip} onClick={() => void act(fn)()}>
      {label}
    </button>
  );
  // After the goals: the next step that's asked, else Finish (v0.1 asks neither Yours nor Connect, src/lab.ts).
  const nextChip = (solo: unknown, primary: boolean) => {
    const next = stepAfter("goals", solo ? "solo" : null);
    if (next === "yours") return chip("Next: which are yours", () => goStep("yours"), primary);
    if (next === "connect") return chip("Next: what to connect", () => goStep("connect"), primary);
    // In through the problems they hear about: Finish opens the canvas, its panel ranking them by what customers said.
    return chip("Finish", () => finishFirstRun(useFirstRun.getState().door === "problems" ? `${orgHref()}?panel=problems` : firstGoalHref()), primary);
  };
  const n = Number(data.n ?? 0);
  switch (data.set) {
    case "box":
      return <ReplyChips>{chip("Set it up properly instead", setUpProperly)}</ReplyChips>;
    case "shape":
      return (
        <ReplyChips>
          {chip("A company or team", () => pickShape("team"))}
          {chip("Just me, on my own idea", () => pickShape("solo"))}
        </ReplyChips>
      );
    case "door": {
      // On your own, an idea is the likeliest start: it comes first.
      const idea = chip("An idea to test", () => pickDoor("idea"));
      return (
        <ReplyChips>
          {/* v0.1 (src/lab.ts): problems first, then goals they know. */}
          {!lab("doors") && chip("Problems we hear about", () => pickDoor("problems"), true)}
          {lab("doors") && data.solo && idea}
          {chip("I know our goals", () => pickDoor("know"))}
          {lab("doors") &&
            chip(
              <>
                <QalamAIGlyph size={12} /> Help me find our goals
              </>,
              () => pickDoor("find"),
            )}
          {lab("doors") && chip("Problems we hear about", () => pickDoor("problems"))}
          {lab("doors") && !data.solo && idea}
        </ReplyChips>
      );
    }
    case "skip":
      return <ReplyChips>{chip("Skip the questions and propose now", () => skipSetupRest())}</ReplyChips>;
    case "know-skip":
      return <ReplyChips>{chip("Skip the questions", skipKnown)}</ReplyChips>;
    case "propose":
      return (
        <ReplyChips>
          {chip(
            <>
              <QalamAIGlyph size={12} /> Propose now
            </>,
            () => placeSetup(),
            true,
          )}
        </ReplyChips>
      );
    case "proposal":
      return (
        <ReplyChips>
          {chip(`Accept all · ${n}`, () => (session ? acceptLines(pendingLines(session).map((l) => l.id)) : undefined), true)}
          {chip("Review one by one", () => reviewNext(useSetup.getState().source?.setup))}
        </ReplyChips>
      );
    case "know-review":
      return (
        <ReplyChips>
          {chip(n === 1 ? "Add this goal" : `Add these ${n} goals`, addKnown, true)}
          {chip("Edit them", editKnown)}
        </ReplyChips>
      );
    case "goals-in":
      return (
        <ReplyChips>
          {data.findGoal ? (
            chip(
              <>
                <QalamAIGlyph size={12} /> Help me find a goal
              </>,
              () => startOnCanvas("find-goal"),
            )
          ) : null}
          {nextChip(data.solo, !data.findGoal)}
        </ReplyChips>
      );
    case "idea-board":
      return (
        <ReplyChips>
          {chip("Start the idea's board", () => startIdeaBoard(), true)}
          {data.first ? nextChip(data.solo, false) : null}
        </ReplyChips>
      );
    case "company":
      return <ReplyChips>{chip(data.solo ? "No link yet" : "No website yet", noWebsite)}</ReplyChips>;
    case "start":
      return (
        <ReplyChips>
          {chip(
            <>
              <QalamAIGlyph size={12} /> Help me find a goal
            </>,
            () => startOnCanvas("find-goal"),
            true,
          )}
          {chip(
            <>
              <QalamAIGlyph size={12} /> Help me find a problem
            </>,
            () => startOnCanvas("find-problem"),
          )}
          {chip("I have one in mind", () => startOnCanvas("write"))}
          {chip("I have documents or notes", () => pickDoor("problems"))}
          {lab("doors") && chip("I know our goals", () => pickDoor("know"))}
          {lab("doors") && chip("An idea to test", () => pickDoor("idea"))}
          {chip("Not now", () => startOnCanvas("later"))}
        </ReplyChips>
      );
    case "take-as":
      return (
        <ReplyChips>
          {chip("Take it as a goal", () => takeAs("goal"), true)}
          {chip("Take it as a problem", () => takeAs("problem"))}
          {chip("Bring something else", () => pickDoor("problems"))}
        </ReplyChips>
      );
    case "competitors":
      return (
        <ReplyChips>
          {chip(
            <>
              <QalamAIGlyph size={12} /> Find them for me
            </>,
            findCompetitors,
            true,
          )}
          {chip("Skip this", skipCompetitors)}
        </ReplyChips>
      );
    case "competitors-again":
      return (
        <ReplyChips>
          {chip("Look again", () => lookForCompetitors(useMarket.getState().session.competitors?.named ?? []), true)}
          {chip("Skip this", skipCompetitors)}
        </ReplyChips>
      );
    case "company-again":
      return (
        <ReplyChips>
          {chip("Look again", lookAgain, true)}
          {chip("Tell it in my words", noWebsite)}
        </ReplyChips>
      );
    case "verify":
      return (
        <ReplyChips>
          <a href={orgHref()} className={r.replyChip}>
            Back
          </a>
        </ReplyChips>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// What they sent, and what Qalam AI took from it

function OutlinePart() {
  const text = useKnow((s) => s.text);
  return (
    <p className="whitespace-pre-wrap" dir="auto">
      {text.replace(/\t/g, "  ")}
    </p>
  );
}

function SaidPart() {
  const pending = useSetup((s) => s.pending);
  const source = useSetup((s) => s.source);
  const docs = pending ? pending.docs : pickedDocs(source?.setup?.docs);
  // The source's text carries the page and the docs too: it shows only when nothing else says what they sent.
  const text = pending?.text ?? source?.setup?.said ?? (source?.origin || docs?.length ? "" : (source?.text.slice(0, 1200) ?? ""));
  const url = pending?.url || source?.origin;
  return (
    <div className="flex flex-col gap-[4px]">
      {text && <Clamp text={text} lines={6} />}
      {url && (
        <span className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
          <Link2 size={12} {...ICON} /> <span className="truncate">{url}</span>
        </span>
      )}
      {docs?.length ? <DocsSent docs={docs} /> : null}
    </div>
  );
}

/** The docs that went with their words at the problems door (the reading doors show theirs with what they said). */
function DocsPart() {
  const docs = useFirstRun((s) => s.problems.docs);
  return docs?.length ? <DocsSent docs={docs} /> : null;
}

function TookPart({ data }: { data: PartData }) {
  const s = useSetup((x) => x.source?.setup);
  const round = Number(data.round ?? -1);
  const said = round < 0 ? s?.understanding : s?.buckets[round]?.analysis;
  if (!said) return null;
  return <Clamp text={said} lines={2} className="text-body leading-[20px] text-fg" />;
}

function PushbackPart() {
  const source = useSetup((x) => x.source);
  const quotes = useSetupQuotes();
  const challenges = source?.setup?.challenges ?? [];
  if (!challenges.length) return null;
  return (
    <ul aria-label="Pushback" className="flex flex-col gap-[6px]">
      {challenges.map((c) => {
        const words = quotes.find((q) => q.id === c.quoteId);
        return (
          <li key={c.id} className={clsx(qr.inset, "flex flex-col gap-[4px] px-[10px] py-[8px]")}>
            <span className="flex items-start gap-[8px]">
              <span className="shrink-0">
                <Tag>{CHALLENGE_LABEL[c.kind]}</Tag>
              </span>
              <span className="text-body leading-[20px] text-fg" dir="auto">
                {c.text}
              </span>
            </span>
            {words && (
              <details className="group/words text-caption text-fg-subtle">
                <summary className="flex cursor-pointer list-none items-center gap-[4px] hover:text-fg-muted [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={11} {...ICON} className="transition-transform duration-fast group-open/words:rotate-90" /> Your words
                </summary>
                <p className="pl-[15px] pt-[2px]" dir="auto">
                  “{words.text}”
                </p>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AnswerList({ questions, answers }: { questions: Question[]; answers: Answers }) {
  return (
    <dl className="flex flex-col gap-[6px]">
      {questions.map((q) => (
        <div key={q.id}>
          <dt className="text-caption text-fg-muted" dir="auto">
            {q.title}
          </dt>
          <dd dir="auto">{summarize(q, answerOf(q, answers))}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnswersPart({ data }: { data: PartData }) {
  const s = useSetup((x) => x.source?.setup);
  const know = useKnow();
  if (data.scope === "know") return <AnswerList questions={know.questions} answers={know.form?.answers ?? {}} />;
  const b = s?.buckets[Number(data.round ?? 0)];
  return b ? <AnswerList questions={b.questions.map(toQuestion)} answers={b.form.answers} /> : null;
}

// ---------------------------------------------------------------------------
// Who they are

/** Their name (this Mac's, filled in when it has one) and their position at this organization; on their own, only the name. */
function YouPart({ data }: { data: PartData }) {
  const saved = useYou((y) => y.name);
  const me = useGoals((g) => g.me);
  const org = useFirstRun((s) => s.org?.name ?? "the organization");
  const [name, setName] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data.open) return null;
  const solo = !!data.solo;
  const n = name ?? saved ?? "";
  const p = solo ? "solo" : (position ?? (me?.position === "solo" ? null : me?.position) ?? null);
  const t = title ?? me?.title ?? "";
  const ready = !!n.trim() && !!p && (p !== "other" || !!t.trim());
  const save = () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    void saveYou(n, p === "other" ? { position: p, title: t } : { position: p! })
      .catch((e) => setError(message(e)))
      .finally(() => setSaving(false));
  };
  const cardCls = (on: boolean) => clsx(qr.option, "items-center", on ? qr.optionSelected : qr.optionIdle);
  return (
    <form
      className="flex flex-col gap-[10px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-[4px]">
        <span className="text-caption text-fg-muted">Your name</span>
        <input className="ds-input placeholder:text-fg-faint" dir="auto" maxLength={NAME_MAX} placeholder="Ahmed" value={n} autoFocus={!n} onChange={(e) => setName(e.target.value)} />
      </label>
      {!solo && (
        <div className="flex flex-col gap-[4px]">
          <span className="text-caption text-fg-muted">Your position at {org}</span>
          <div className="grid grid-cols-2 gap-[6px]" role="radiogroup" aria-label={`Your position at ${org}`}>
            {POSITIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={p === o.value} className={cardCls(p === o.value)} onClick={() => setPosition(o.value)}>
                <Radio on={p === o.value} />
                <span className="text-body font-medium text-fg">{o.label}</span>
              </button>
            ))}
          </div>
          {p === "other" && (
            <input className="ds-input q-fade placeholder:text-fg-faint" dir="auto" maxLength={TITLE_MAX} placeholder="Senior PM, Payments" value={t} autoFocus aria-label="Your position" onChange={(e) => setTitle(e.target.value)} />
          )}
        </div>
      )}
      {error && <ErrorNote message={error} />}
      <ReplyChips>
        <button type="submit" disabled={!ready || saving} className={r.replyChipPrimary}>
          Next
        </button>
        <span className="text-caption text-fg-subtle">Kept on this computer. Qalam AI asks you less, and in your terms.</span>
      </ReplyChips>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Talking instead of typing

/** Apple's engine where the Mac has it (on unless they say), with a box to try it in; else an engine to install. */
function VoicePart({ data }: { data: PartData }) {
  const mic = useVoice((v) => v.view?.mic ?? null);
  const [busy, setBusy] = useState<VoiceChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  if (!data.open) return null;
  const pick = (use: VoiceChoice) => {
    setBusy(use);
    setError(null);
    void saveVoice(use)
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(null));
  };
  if (data.offer === "parakeet") return <ParakeetOffer pick={pick} busy={busy} error={error} />;
  return (
    <div className="flex flex-col gap-[10px]">
      <Dictated field={box} set={setTried}>
        <textarea ref={box} rows={2} dir="auto" aria-label="Try talking" className={clsx(r.textarea, "text-body")} placeholder="Try it: click the mic and say something" value={tried} onChange={(e) => setTried(e.target.value)} />
      </Dictated>
      {mic === "denied" && <p className="text-caption text-danger">Qalam can&apos;t use the microphone. Allow it in System Settings → Privacy &amp; Security → Microphone.</p>}
      {error && <ErrorNote message={error} />}
      <ReplyChips>
        <button type="button" disabled={!!busy} className={r.replyChipPrimary} onClick={() => pick("apple")}>
          Use it
        </button>
        <button type="button" disabled={!!busy} className={r.replyChip} onClick={() => pick("own")}>
          I use my own dictation app
        </button>
      </ReplyChips>
    </div>
  );
}

/** Parakeet to install (never unasked), then a box to try it in; or their own app, or not now. */
function ParakeetOffer({ pick, busy, error }: { pick: (use: VoiceChoice) => void; busy: VoiceChoice | null; error: string | null }) {
  const installed = useVoice((v) => v.view?.parakeet.installed ?? false);
  const [tried, setTried] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex flex-col gap-[10px]">
      {installed ? (
        <Dictated field={box} set={setTried}>
          <textarea ref={box} rows={2} dir="auto" aria-label="Try talking" className={clsx(r.textarea, "text-body")} placeholder="Try it: click the mic and say something" value={tried} onChange={(e) => setTried(e.target.value)} />
        </Dictated>
      ) : (
        <ParakeetInstall onDone={() => void chooseVoice("parakeet")} />
      )}
      {error && <ErrorNote message={error} />}
      <ReplyChips>
        {installed && (
          <button type="button" disabled={!!busy} className={r.replyChipPrimary} onClick={() => pick("parakeet")}>
            Use it
          </button>
        )}
        <button type="button" disabled={!!busy} className={r.replyChip} onClick={() => pick("own")}>
          I use my own dictation app
        </button>
        {!installed && (
          <button type="button" disabled={!!busy} className={r.replyChip} onClick={() => pick("off")}>
            Not now
          </button>
        )}
      </ReplyChips>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Which are theirs, what to connect, the end

/** Where finishing goes: their first goal, else the first goal under the North Star, else the North Star. */
export function firstGoalHref(): string {
  const t = useGoals.getState();
  const mine = useFirstRun.getState().picked ?? t.mine;
  const order = treeRows(t);
  const g = order.find((x) => mine.includes(x.id)) ?? (t.north ? childrenOf(t, t.north)[0] : undefined) ?? order[0];
  return g ? goalHref(g.id) : orgHref();
}

function YoursPart({ data }: { data: PartData }) {
  const goals = useGoals();
  const picked = useFirstRun((s) => s.picked);
  // They said they're the only one on it: every goal starts picked.
  const sole = useSetup((s) => !!s.source?.setup && soleOwner(s.source.setup));
  const [saving, setSaving] = useState(false);
  const list = treeRows(goals);
  const all = sole && picked === null && !goals.mine.length;
  const chosen = new Set(all ? list.map((g) => g.id) : (picked ?? goals.mine));
  useEffect(() => {
    if (all && data.open && list.length) useFirstRun.setState({ picked: list.map((g) => g.id) });
  }, [all, data.open, list.length]);
  if (!data.open) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      {list.length ? (
        <ul className={clsx(qr.inset, "flex flex-col py-[4px]")}>
          {list.map((g) => (
            <li key={g.id} className="flex items-center gap-[8px] py-[3px] pr-[10px]" style={{ paddingLeft: 10 + g.depth * 18 }}>
              <span className={g.north ? "text-fg" : "text-fg-subtle"}>{g.north ? <Star size={13} {...ICON} /> : <Target size={13} {...ICON} />}</span>
              <span className="min-w-0 flex-1">
                <Checkbox
                  checked={chosen.has(g.id)}
                  onChange={(on) => togglePick(g.id, on)}
                  label={
                    <span className="flex min-w-0 flex-col py-[2px]">
                      <span className="truncate text-body text-fg">{g.title}</span>
                      {(g.north || g.line) && <span className="truncate text-caption text-fg-muted tnum">{[g.north ? "North Star" : null, g.line || null].filter(Boolean).join(" · ")}</span>}
                    </span>
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">There are no goals yet: add them on the canvas any time.</p>
      )}
      <ReplyChips>
        <button
          type="button"
          disabled={saving}
          className={r.replyChipPrimary}
          onClick={() => {
            setSaving(true);
            void saveYours(list.map((g) => g.id))
              .then((next) => (next ? undefined : finishFirstRun(firstGoalHref())))
              .finally(() => setSaving(false));
          }}
        >
          Next
        </button>
        <span className="text-caption text-fg-subtle">{sole && chosen.size === list.length && list.length ? "You said you're the only one on it, so they're all yours. Untick any that aren't." : chosen.size ? `${chosen.size} picked` : "None picked: the home leads with the North Star."}</span>
      </ReplyChips>
    </div>
  );
}

function ConnectPart() {
  const goals = useGoals();
  const tools = useFirstRun((s) => s.tools);
  const gh = useFirstRun((s) => s.gh);
  const hasNumbers = goals.goals.some((g) => !!g.metric?.name);
  return (
    <div className="flex flex-col gap-[10px]">
      <ul className="flex flex-col gap-[6px]">
        {connectFor(hasNumbers).map((c) => {
          const t = tools?.find((x) => x.id === c.id);
          // GitHub here is reading the product's code (its card in Connections is for work linked to solutions).
          const word = c.id === "github" ? (gh ? `Through ${gh.includes(" ") ? gh : `this computer's CLI, ${gh}`}` : "Not connected") : (t?.word ?? "");
          const tone = c.id === "github" ? (gh ? "ok" : "off") : (t?.tone ?? "off");
          return (
            <li key={c.id} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
              <ConnectorLogo id={c.id} size={28} decorative />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-fg">{t?.label ?? (c.id === "github" ? "GitHub" : c.id)}</span>
                <span className="text-caption text-fg-muted">{c.why}</span>
              </span>
              {tools && (
                <span className="flex shrink-0 items-center gap-[6px] text-caption text-fg-muted">
                  <StatusDot tone={tone} hollow={tone === "off"} />
                  {word}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <ReplyChips>
        <button type="button" className={r.replyChipPrimary} onClick={() => void finishFirstRun(firstGoalHref())}>
          Finish
        </button>
        <a href={placeHref("connections")} className={r.replyChip}>
          Open Connections
        </a>
      </ReplyChips>
    </div>
  );
}

/** Not the first run: a board for each goal they accepted, the inbox, and Connections. */
function AllSetPart() {
  const s = useSetup((x) => x.source?.setup);
  const org = useFirstRun((x) => x.org);
  const { products } = useOrgContext();
  const [starting, setStarting] = useState<string | null>(null);
  const goals = s ? boardGoals(s) : [];
  const inbox = org ? `${org.dir}/inbox` : null;
  return (
    <div className="flex flex-col gap-[6px]">
      {goals.map(({ line, product }) => (
        <div key={line.id} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-fg" dir="auto">
              {line.text}
            </span>
            <span className="text-micro text-fg-subtle">{product ? (products.find((p) => p.id === product)?.name ?? "A product") : wordsFor(org?.shape).whole}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!!starting}
            onClick={() => {
              setStarting(line.id);
              void startBoard(line.id).catch((e: unknown) => {
                setStarting(null);
                feedback(`Couldn't start the board: ${message(e)}`, { kind: "error", id: "setup.board" });
              });
            }}
          >
            {s?.boards?.[line.id] ? "Open its board" : starting === line.id ? "Starting…" : "Start a board"}
          </Button>
        </div>
      ))}
      {inbox && (
        <div className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body text-fg">Drop reports, interviews and notes in the inbox</span>
            <span className="truncate font-mono text-micro text-fg-subtle">{inbox}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(inbox).then(() => feedback("Copied the inbox's path", { kind: "success", id: "setup.inbox" }), () => {})}>
            Copy the path
          </Button>
        </div>
      )}
      <ReplyChips>
        <a href={orgHref()} className={r.replyChipPrimary}>
          Go to {org?.name ?? `the ${wordsFor(org?.shape).org}`}
        </a>
        <a href={placeHref("connections")} className={r.replyChip}>
          Connections
        </a>
      </ReplyChips>
    </div>
  );
}

function ErrorPart({ data }: { data: PartData }) {
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <ErrorNote message={String(data.text ?? "Something went wrong.")} />
      {data.retry && (
        <button type="button" className={r.replyChip} onClick={retrySetup}>
          <RotateCcw size={12} {...ICON} /> Try again
        </button>
      )}
    </div>
  );
}

function WorkingPart({ data }: { data: PartData }) {
  const busy = useSetup((s) => s.busy);
  if (busy) return <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />;
  return (
    <span className={clsx(r.chatStatus, "text-fg-muted")}>
      <Spinner size={12} /> <span className="q-shimmer-text">{String(data.label ?? "Working")}…</span>
    </span>
  );
}

/** The problems door's end: the problem pages what they sent went into, the best-backed first, each opening its page (where solutions are drafted). */
function FoundGoalsPart() {
  const found = useFirstRun((s) => s.problems.found);
  return (
    <ul className="flex flex-col gap-[6px]">
      {found?.map((f) => (
        <li key={f.goal.id}>
          <FoundGoalRow goal={f.goal} onDecide={(accept) => void decideGoal(f.source, f.goal.id, accept)} />
        </li>
      ))}
    </ul>
  );
}

function ProblemsPart() {
  const filed = useFirstRun((s) => s.problems.result?.needs);
  const [ranked, setRanked] = useState<RankedNeed[] | null>(null);
  useEffect(() => {
    void needsDb.list().then((n) => setRanked(n.needs), () => setRanked([]));
  }, []);
  if (!filed?.length) return null;
  // Ranked as the home ranks them, once the index has them; as filed until then.
  const order = (id: string) => ranked?.findIndex((n) => n.topic === id) ?? -1;
  const rows = [...filed].sort((a, b) => (order(a.id) < 0 ? 1e9 : order(a.id)) - (order(b.id) < 0 ? 1e9 : order(b.id))).map((p) => ({ ...p, need: ranked?.find((n) => n.topic === p.id) }));
  return (
    <ul className="flex flex-col gap-[6px]">
      {rows.map((n) => (
        <li key={n.id}>
          <a href={topicHref(n.id)} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px] hover:bg-hover")}>
            <span className="min-w-0 flex-1 truncate text-body text-fg" dir="auto">
              {n.title}
            </span>
            {n.need && <span className="shrink-0 text-micro text-fg-subtle tnum">{n.need.quotes ? `${n.need.quotes} ${n.need.quotes === 1 ? "quote" : "quotes"} · ${n.need.sources} ${n.need.sources === 1 ? "source" : "sources"}` : "Assumed"}</span>}
            <ChevronRight size={14} {...ICON} className="shrink-0 text-fg-subtle" />
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The company: each fact found, kept, fixed or dropped

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** One fact: what it's about, its sentence (theirs once fixed), the page it was read on, and Keep, Fix or Drop. */
function FactRow({ f, kept, text, editing, open, onKeep, onEdit, onText }: { f: MarketLine; kept: boolean; text: string; editing: boolean; open: boolean; onKeep: (on: boolean) => void; onEdit: (on: boolean) => void; onText: (t: string) => void }) {
  return (
    <li className={clsx(qr.inset, "flex flex-col gap-[4px] px-[10px] py-[8px]", !kept && "opacity-60")}>
      <span className="flex items-center gap-[6px] text-micro text-fg-subtle">
        <span>{f.field ? FIELD_LABEL[f.field] : "About it"}</span>
        {f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[3px] hover:text-fg" title={f.quote ? `“${f.quote}”` : f.url}>
            <Link2 size={11} {...ICON} />
            <span className="truncate">{hostOf(f.url)}</span>
          </a>
        ) : f.by === "you" ? (
          <span>· your words</span>
        ) : null}
      </span>
      {editing ? (
        <textarea
          aria-label="The fact, in your words"
          rows={2}
          dir="auto"
          className={clsx(r.textarea, "text-body")}
          value={text}
          autoFocus
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onEdit(false);
            }
            if (e.key === "Escape") onEdit(false);
          }}
        />
      ) : (
        <p className={clsx("text-body leading-[20px] text-fg", !kept && "line-through")} dir="auto">
          {text}
        </p>
      )}
      {open && (
        <span className="flex gap-[6px]">
          {kept ? (
            <>
              <button type="button" className={r.replyChip} onClick={() => onEdit(!editing)}>
                {editing ? "Done" : "Fix"}
              </button>
              <button type="button" className={r.replyChip} onClick={() => onKeep(false)}>
                Drop
              </button>
            </>
          ) : (
            <button type="button" className={r.replyChip} onClick={() => onKeep(true)}>
              Keep
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function FactsPart({ data }: { data: PartData }) {
  const look = useMarket((m) => m.session.company);
  const known = useMarket((m) => m.market.company);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = !!data.open && look?.state === "ready";
  // Settled: what's kept now (their fixes in it).
  const facts = open ? (look?.facts ?? []) : known.length ? known : (look?.facts ?? []);
  if (!facts.length) return null;
  const kept = facts.filter((f) => !dropped.has(f.id)).length;
  return (
    <div className="flex w-full flex-col gap-[8px]">
      <ul className="flex w-full flex-col gap-[6px]">
        {facts.map((f) => (
          <FactRow
            key={f.id}
            f={f}
            open={open}
            kept={!open || !dropped.has(f.id)}
            text={texts[f.id] ?? f.text}
            editing={open && editing === f.id}
            onKeep={(on) => setDropped((d) => (on ? new Set([...d].filter((x) => x !== f.id)) : new Set([...d, f.id])))}
            onEdit={(on) => setEditing(on ? f.id : null)}
            onText={(t) => setTexts((x) => ({ ...x, [f.id]: t }))}
          />
        ))}
      </ul>
      {open && (
        <ReplyChips>
          <button
            type="button"
            disabled={saving}
            className={r.replyChipPrimary}
            onClick={async () => {
              setSaving(true);
              try {
                await keepFacts(facts.map((f) => ({ id: f.id, keep: !dropped.has(f.id), ...(texts[f.id] !== undefined && texts[f.id].trim() !== f.text ? { text: texts[f.id] } : {}) })));
              } finally {
                setSaving(false);
              }
            }}
          >
            {kept ? (kept === facts.length ? "That's right" : `Keep these ${kept}`) : "None of these"}
          </button>
          <button type="button" disabled={saving} className={r.replyChip} onClick={noWebsite}>
            Tell it in my words
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

/** A competitor found (its site, what it does) or named by them: kept, or taken off. */
function RivalRow({ c, kept, open, onKeep }: { c: Competitor; kept: boolean; open: boolean; onKeep?: (on: boolean) => void }) {
  return (
    <li className={clsx(qr.inset, "flex flex-col gap-[4px] px-[10px] py-[8px]", !kept && "opacity-60")}>
      <span className="flex min-w-0 items-center gap-[6px]">
        <span className={clsx("truncate text-body font-medium text-fg", !kept && "line-through")}>{c.name}</span>
        {c.url ? (
          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[3px] text-micro text-fg-subtle hover:text-fg">
            <Link2 size={11} {...ICON} />
            <span className="truncate">{hostOf(c.url)}</span>
          </a>
        ) : c.by === "you" ? (
          <span className="text-micro text-fg-subtle">you named it</span>
        ) : null}
      </span>
      {c.lines.slice(0, 2).map((l) => (
        <p key={l.id} className="text-caption leading-[18px] text-fg-muted" dir="auto" title={l.quote ? `“${l.quote}”` : undefined}>
          {l.text}
        </p>
      ))}
      {open && onKeep && (
        <span className="flex gap-[6px]">
          <button type="button" className={r.replyChip} onClick={() => onKeep(!kept)}>
            {kept ? "Take it off" : "Keep"}
          </button>
        </span>
      )}
    </li>
  );
}

function RivalsPart({ data }: { data: PartData }) {
  const look = useMarket((m) => m.session.competitors);
  const known = useMarket((m) => m.market.competitors);
  const added = useFirstRun((f) => f.rivalsAdded);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const open = !!data.open && look?.state === "ready";
  const found = open ? (look?.found ?? []) : known.length ? known : (look?.found ?? []);
  const mine: Competitor[] = open ? added.map((name, i) => ({ id: `added:${i}`, name, lines: [], by: "you", at: 0 })) : [];
  if (!found.length && !mine.length) return null;
  const kept = found.filter((c) => !off.has(c.id)).length + mine.length;
  return (
    <div className="flex w-full flex-col gap-[8px]">
      <ul className="flex w-full flex-col gap-[6px]">
        {found.map((c) => (
          <RivalRow key={c.id} c={c} open={open} kept={!open || !off.has(c.id)} onKeep={(on) => setOff((d) => (on ? new Set([...d].filter((x) => x !== c.id)) : new Set([...d, c.id])))} />
        ))}
        {mine.map((c) => (
          <RivalRow key={c.id} c={c} open={false} kept />
        ))}
      </ul>
      {open && (
        <ReplyChips>
          <button
            type="button"
            disabled={saving}
            className={r.replyChipPrimary}
            onClick={async () => {
              setSaving(true);
              try {
                await keepCompetitors(found.filter((c) => !off.has(c.id)).map((c) => c.id));
              } finally {
                setSaving(false);
              }
            }}
          >
            {kept ? (kept === 1 ? "Keep this one" : `Keep these ${kept}`) : "None of these"}
          </button>
          <button type="button" disabled={saving} className={r.replyChip} onClick={skipCompetitors}>
            Skip this
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

export const PARTS: Record<string, PartComponent> = {
  facts: FactsPart,
  rivals: RivalsPart,
  problems: ProblemsPart,
  foundGoals: FoundGoalsPart,
  engine: EnginePart,
  verify: VerifyPart,
  choices: ChoicesPart,
  outline: OutlinePart,
  said: SaidPart,
  docs: DocsPart,
  took: TookPart,
  pushback: PushbackPart,
  answers: AnswersPart,
  you: YouPart,
  voice: VoicePart,
  yours: YoursPart,
  connect: ConnectPart,
  allSet: AllSetPart,
  error: ErrorPart,
  working: WorkingPart,
};
