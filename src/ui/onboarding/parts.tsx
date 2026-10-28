import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Link2, RotateCcw, Star, Target } from "lucide-react";
import { CHALLENGE_LABEL } from "@/discovery/dump";
import { useGoals } from "@/goals/client";
import { childrenOf } from "@/goals/tree";
import { useOrgContext } from "@/org/context";
import { boardGoals, pendingLines } from "@/org/setup";
import { goalHref, orgHref, placeHref } from "@/projects/model";
import { feedback } from "@/commands/feedback";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Button, Checkbox, Spinner, Tag } from "../controls";
import { toQuestion } from "../ai/plan";
import { qr } from "../ai/Questionnaire";
import { answerOf, summarize, type Answers, type Question } from "../ai/questionFlow";
import { ErrorNote, Progress } from "../ai/common";
import { CopyCommand, KeyField, PLAN } from "../connections/EngineCard";
import { ThisMac } from "../connections/ThisMac";
import { ReplyChips, type PartComponent } from "../chat/ChatThread";
import type { PartData } from "../chat/types";
import { r } from "../recipes";
import { StatusDot } from "../viz";
import { addKnown, editKnown, skipKnown, useKnow } from "../setup/know";
import { acceptLines, placeSetup, retrySetup, skipSetupRest, startBoard, useSetup } from "../setup/setup";
import { connectFor } from "../welcome/steps";
import { checkEngine, goStep, keySaved, openKeyField, openSoFar, pickDoor, saveYours, skipEngine, togglePick, useFirstRun } from "./flow";
import { treeRows } from "./soFar";

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
  const a = v?.claude.account;
  const who = !v ? "" : v.kind === "cli" ? ["Claude Code", a?.plan ? `${PLAN[a.plan] ?? a.plan} plan` : null, a?.email ?? null].filter(Boolean).join(" · ") : v.key ? `API key ending ${v.key.last4}` : "Claude API key";
  if (data.compact)
    return who ? (
      <p className="flex items-center gap-[6px] text-caption text-fg-muted">
        <StatusDot tone={ok || v?.ready ? "ok" : "bad"} /> {who}
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
          {who && <p className="truncate text-body text-fg">{who}</p>}
          {detail && <p className="text-caption text-fg-muted">{detail}</p>}
          {(e.error || error) && <p className="text-caption text-danger">{e.error ?? error}</p>}
        </div>
      </div>
      {!e.checking && !ok && !e.skipped && (
        <ReplyChips>
          {v?.kind === "cli" && test?.word === "Signed out" && <CopyCommand command="claude auth login" />}
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
              Use an API key
            </button>
          )}
          {changes && (
            <button type="button" className={clsx(qr.textBtn, "ml-auto")} onClick={skipEngine}>
              Set up later
            </button>
          )}
        </ReplyChips>
      )}
      {e.keyOpen && v && !ok && <KeyField view={{ ...v, key: null }} onError={setError} onSaved={() => void keySaved()} />}
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
  const n = Number(data.n ?? 0);
  switch (data.set) {
    case "door":
      return (
        <ReplyChips>
          {chip("I know them", () => pickDoor("know"))}
          {chip(
            <>
              <QalamAIGlyph size={12} /> Help me find them
            </>,
            () => pickDoor("find"),
          )}
        </ReplyChips>
      );
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
          {chip("Review one by one", () => openSoFar(true))}
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
      return <ReplyChips>{chip("Next: which are yours", () => goStep("yours"), true)}</ReplyChips>;
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
  const text = pending?.text ?? source?.setup?.said ?? (source?.origin ? "" : (source?.text.slice(0, 1200) ?? ""));
  const url = pending?.url || source?.origin;
  return (
    <div className="flex flex-col gap-[4px]">
      {text && <Clamp text={text} lines={6} />}
      {url && (
        <span className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
          <Link2 size={12} {...ICON} /> <span className="truncate">{url}</span>
        </span>
      )}
    </div>
  );
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
  const challenges = source?.setup?.challenges ?? [];
  if (!challenges.length) return null;
  return (
    <ul aria-label="Pushback" className="flex flex-col gap-[6px]">
      {challenges.map((c) => {
        const words = source?.quotes.find((q) => q.id === c.quoteId);
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
  const [saving, setSaving] = useState(false);
  const chosen = new Set(picked ?? goals.mine);
  const list = treeRows(goals);
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
        <p className="text-body text-fg-muted">There are no goals yet: add them on the Goals page any time.</p>
      )}
      <ReplyChips>
        <button
          type="button"
          disabled={saving}
          className={r.replyChipPrimary}
          onClick={() => {
            setSaving(true);
            void saveYours(list.map((g) => g.id)).finally(() => setSaving(false));
          }}
        >
          Next
        </button>
        <span className="text-caption text-fg-subtle">{chosen.size ? `${chosen.size} picked` : "None picked: the home leads with the North Star."}</span>
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
          const word = c.id === "github" ? (gh ? `Through ${gh.includes(" ") ? gh : `this Mac's CLI, ${gh}`}` : "Not connected") : (t?.word ?? "");
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
        <button type="button" className={r.replyChipPrimary} onClick={() => window.location.assign(firstGoalHref())}>
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
            <span className="text-micro text-fg-subtle">{product ? (products.find((p) => p.id === product)?.name ?? "A product") : "The whole organization"}</span>
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
            <span className="text-body text-fg">Drop interviews and notes in the inbox</span>
            <span className="truncate font-mono text-micro text-fg-subtle">{inbox}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(inbox).then(() => feedback("Copied the inbox's path", { kind: "success", id: "setup.inbox" }), () => {})}>
            Copy the path
          </Button>
        </div>
      )}
      <ReplyChips>
        <a href={orgHref()} className={r.replyChipPrimary}>
          Go to {org?.name ?? "the organization"}
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

export const PARTS: Record<string, PartComponent> = {
  engine: EnginePart,
  verify: VerifyPart,
  choices: ChoicesPart,
  outline: OutlinePart,
  said: SaidPart,
  took: TookPart,
  pushback: PushbackPart,
  answers: AnswersPart,
  yours: YoursPart,
  connect: ConnectPart,
  allSet: AllSetPart,
  error: ErrorPart,
  working: WorkingPart,
};
