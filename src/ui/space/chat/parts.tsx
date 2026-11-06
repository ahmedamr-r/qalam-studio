import { BASES, BASIS_LABEL, countsLine, isBasis, mainBasis, type Basis } from "@/discovery/basis";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Quote, RotateCcw, X } from "lucide-react";
import { nanoid } from "nanoid";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { CHALLENGE_LABEL, type DumpSession } from "@/discovery/dump";
import { KIND_LABEL } from "@/discovery/kinds";
import type { Proposal } from "@/discovery/proposals";
import type { AskAnswer, AskClaim, AskUnknown } from "@/hub/ask";
import type { BriefShape } from "@/discovery/brief";
import { answersOf, planLine } from "@/space/plan";
import { DUMP_WORDS, wordsIn, type ChatMode } from "@/space/route";
import { claimStrip } from "@/hub/ask";
import type { TopicInfo } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { placeHref, topicHref } from "@/projects/model";
import type { PartData } from "../../chat/types";
import type { PartComponent } from "../../chat/ChatThread";
import { ReplyChips } from "../../chat/ChatThread";
import { DocsSent } from "../../chat/SourcePicker";
import { Progress } from "../../ai/common";
import { toQuestion } from "../../ai/plan";
import { AnswersSummary, qr } from "../../ai/Questionnaire";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { SiteIcon, SiteStack } from "../../brand/SiteIcon";
import { placeDump, readAnyway, retryDump, sessionOf, skipRest, useDump } from "../../discovery/dump";
import { ACCEPT } from "../../discovery/ingest";
import { acceptAll, acceptProposals, discardAll, discardProposals, frameReview, startReview, useReview } from "../../discovery/review";
import { openSource, sourceOf, useSources } from "../../discovery/sources";
import { Button, Spinner, Tag, Tip } from "../../controls";
import { Dots, StatusDot } from "../../viz";
import { r } from "../../recipes";
import { useTopics } from "../../topics/list";
import { useWords } from "../../frame/store";
import { show } from "../links";
import { FoundGoalRow } from "../../chat/FoundGoalRow";
import { moreLine } from "@/onboarding/start";
import { goalForTopProblem, anotherFile, briefAgain, briefStart, changeDocBasis, chooseDraft, decideDocGoal, dropTurn, leaveFile, leaveFit, lookPastFits, openProblems, pickAudience, placeFirstBuild, placeStatement, planAgain, planFirst, planOf, planStart, retake, retryGoalFor, scanAgain, scanHere, scanInNewProject, scanIsMine, scanOtherWay, setPlanGoal, settleNumber, steerOff, stopTurn, takeAsBasis, takeFit, takeGoalNumber, takeIdea, retryCanvasPlan, runAs, showCanvasPlan, skipCanvasPlan, turnOf, useCanvasChat } from "./store";
import { titleFrom } from "@/space/route";
import { otherReading, projectName } from "@/scan/input";
import { firstGoal, GOAL_ACTIONS, riskiest, type GoalAction, type ScanAudience } from "@/scan/plan";
import { peopleQuotes, type ScanKnown } from "@/scan/session";
import { cardQuotes, readLine, reportHtml, type ReportData, type ShareProblem } from "@/scan/share";
import { scanShare } from "@/org/scan";
import { shareCardPng } from "@/engine/share-card";
import { isOff } from "@/scan/steer";
import type { BriefState, ScanJob, ScanPlan } from "@/space/chat";
import { getBrief } from "@/org/briefs";
import { openBrief, useBriefs } from "../../discovery/briefs";
import { addMaterial } from "../new";
import { goalNumberLine, withUnit } from "@/goals/moves";
import type { Benchmark } from "@/goals/outside";

/*
 * What the messages in the canvas's chat draw (./CanvasChat.tsx): each part names its turn, and
 * reads the rest from the chat's store. An answer is Ask's: what's backed, by how much, the claims
 * with their quotes (every one found word for word where it says), what it couldn't back, and what
 * nobody knows yet, which can go on a problem's page as an open question. A short statement offers
 * what it could be; one written on the canvas says where it went; what was taken in lists the
 * problems' pages it went into.
 */


const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A turn's own record, followed as the chat changes. */
function useTurn(id: unknown) {
  useCanvasChat((s) => s.chat);
  return turnOf(String(id));
}

/** Qalam AI at work on a turn: what it's doing now, and for how long. */
function WorkingPart({ data }: { data: PartData }) {
  const id = String(data.turn);
  const live = useCanvasChat((s) => s.live[id]);
  const t = useTurn(id);
  const { org } = useWords();
  if (!live || !t) return null;
  const said = t.said.length > 60 ? `${t.said.slice(0, 59)}…` : t.said;
  const first = t.job.kind === "take" ? "Reading what it says" : t.job.kind === "find" ? "Looking on the web for what usually gets in the way of goals like it" : t.job.kind === "goalfor" ? (t.job.step === "suggesting" ? "Working out a number that's realistic" : "Checking it against your goals") : `Looking through the ${org} for “${said}”`;
  return (
    <div className="flex flex-col gap-[6px]">
      <Progress label={live.steps.at(-1) ?? first} started={live.started} tokens={0} />
      {live.steps.length > 1 && (
        <ul className="flex flex-col gap-[2px] px-[2px] text-caption text-fg-subtle">
          {live.steps.slice(0, -1).map((s, i) => (
            <li key={i} className="truncate">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const topics = useTopics();
  if (t?.job.kind !== "ask" || !t.job.answer) return null;
  const a = t.job.answer;
  const backed = a.claims.filter((c) => c.backed);
  const unbacked = a.claims.filter((c) => !c.backed);
  return (
    <article className="flex flex-col gap-[12px]">
      {a.answer ? <p className="text-body leading-[20px] text-fg">{a.answer}</p> : backed.length ? <p className="text-body text-fg-muted">Its summary said more than what it found shows, so it&apos;s left out.</p> : <p className="text-body text-fg-muted">Nothing the organization has backs an answer.</p>}
      <Strip a={a} secs={t.job.secs ?? 0} />
      {backed.length > 0 && (
        <section className="flex flex-col gap-[8px]">
          <h4 className="text-caption font-medium text-fg-muted">What it rests on</h4>
          <ul className="flex flex-col gap-[10px]">
            {backed.map((c, i) => (
              <ClaimRow key={i} c={c} />
            ))}
          </ul>
        </section>
      )}
      {unbacked.length > 0 && (
        <section className="flex flex-col gap-[6px]">
          <h4 className="text-caption font-medium text-fg-muted">I couldn&apos;t back these</h4>
          <ul className="flex flex-col gap-[4px]">
            {unbacked.map((c, i) => (
              <li key={i} className="text-caption text-fg-subtle">
                {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.unknowns.length > 0 && (
        <section className="flex flex-col gap-[6px]">
          <h4 className="text-caption font-medium text-fg-muted">What nobody knows yet</h4>
          <ul className="flex flex-col gap-[8px]">
            {a.unknowns.map((u, i) => (
              <UnknownRow key={i} u={u} topics={topics} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** The answer at a glance: what's backed, by how much, what isn't, and what nobody knows. */
function Strip({ a, secs }: { a: AskAnswer; secs: number }) {
  const n = claimStrip(a);
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] text-caption tnum">
      <span className="inline-flex items-center gap-[6px] text-fg">
        <StatusDot tone={n.backed ? "ok" : "off"} />
        {plural(n.backed, "claim")} backed
      </span>
      {n.quotes > 0 && (
        <span className="inline-flex items-center gap-[6px] text-fg-muted">
          <Dots count={n.sources} label={plural(n.sources, "source")} />
          {plural(n.quotes, "quote")} · {plural(n.sources, "source")}
        </span>
      )}
      {n.unbacked > 0 && <span className="text-warning">{n.unbacked} not backed</span>}
      {n.unknowns > 0 && <span className="text-fg-muted">{plural(n.unknowns, "open question")}</span>}
      <Tip label={`${a.how === "agent" ? "Qalam AI searched the organization's folder" : "Qalam AI read what the organization's search found"}. Every quote was found word for word where it says.`}>
        <span className="ml-auto inline-flex items-center gap-[4px] text-fg-subtle">
          <Check size={12} absoluteStrokeWidth strokeWidth={1.5} />
          Checked{secs ? ` · ${secs} s` : ""}
        </span>
      </Tip>
    </div>
  );
}

function ClaimRow({ c }: { c: AskClaim }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-[6px]">
      <div className="flex items-start gap-[8px]">
        <span className="min-w-0 flex-1 text-body text-fg">{c.text}</span>
        {c.support.length > 0 && (
          <button type="button" aria-expanded={open} aria-label={open ? "Hide the quotes" : "Show the quotes"} onClick={() => setOpen((o) => !o)} className={clsx(r.chip, "mt-[2px] shrink-0 hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg")}>
            <Quote size={10} absoluteStrokeWidth strokeWidth={1.25} />
            <span className="tnum">{c.support.length}</span>
          </button>
        )}
      </div>
      {open &&
        c.support.map((s, i) => (
          <figure key={i} className="flex flex-col gap-[2px] rounded-md bg-muted px-[10px] py-[6px]">
            <blockquote className="flex gap-[6px] text-caption text-fg" dir="auto">
              <Quote size={12} className="mt-[2px] shrink-0 text-fg-subtle" />
              <span>{s.words.length > 400 ? `${s.words.slice(0, 399).trimEnd()}…` : s.words}</span>
            </blockquote>
            <figcaption className="pl-[18px] text-micro text-fg-subtle">
              {s.href ? (
                <a href={s.href} className="underline decoration-fg/20 underline-offset-2 hover:text-fg">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </figcaption>
          </figure>
        ))}
    </li>
  );
}

function UnknownRow({ u, topics }: { u: AskUnknown; topics: TopicInfo[] | null }) {
  const [added, setAdded] = useState(false);
  const page = u.topic ? topics?.find((t) => t.id === u.topic) : undefined;
  const add = async () => {
    const v = page ? await topicsDb.get(page.id) : null;
    if (!v) return;
    const t = v.topic;
    // The team asked for it to go there: it's their open question now.
    await topicsDb.put({ ...t, lines: [...t.lines, { id: nanoid(10), section: "open", text: u.question, by: "person", cites: [], from: [], at: Date.now() }] }, t.version);
    setAdded(true);
  };
  return (
    <li className="flex flex-col items-start gap-[4px]">
      <span className="text-body text-fg">{u.question}</span>
      {u.why && <span className="text-caption text-fg-muted">{u.why}</span>}
      {page &&
        (added ? (
          <Tag>
            Added to{" "}
            <a href={topicHref(page.id)} className="underline">
              {page.title}
            </a>
          </Tag>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void add()}>
            Add to “{page.title.length > 28 ? `${page.title.slice(0, 27)}…` : page.title}”
          </Button>
        ))}
    </li>
  );
}

// ---------------------------------------------------------------------------
// A brain dump

/** A dump turn's session, followed as its source changes. */
function useDumpOf(id: unknown): { source: string; s: DumpSession } | null {
  const t = useTurn(id);
  const source = t?.job.kind === "dump" ? t.job.source : null;
  const s = useSources((st) => (source ? sessionOf(st.list.find((x) => x.id === source)) : null));
  return source && s ? { source, s } : null;
}

/** Qalam AI at work on a dump: reading it, its answers, or placing it. */
function DumpingPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const t = useTurn(data.turn);
  const source = t?.job.kind === "dump" ? t.job.source : null;
  const busy = useDump((u) => (source && u.busy?.sourceId === source ? u.busy : null));
  if (busy) return <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />;
  return (
    <span className={clsx(r.chatStatus, "text-fg-muted")}>
      <Spinner size={12} /> <span className="q-shimmer-text">{d?.s.phase === "placing" ? "Placing it on the canvas" : d?.s.phase === "analyzing" ? "Reading your answers" : t?.job.kind === "dump" && t.job.file ? "Reading the file" : "Reading your thinking"}…</span>
    </span>
  );
}

/** What Qalam AI took from the dump, and where it pushes back (the words it's about, the card). */
function TookPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const doc = useStudio((st) => st.doc);
  if (!d) return null;
  const src = sourceOf(d.source);
  return (
    <div className="flex flex-col gap-[10px]">
      {d.s.understanding && (
        <p className="text-body leading-[20px] text-fg" dir="auto">
          {d.s.understanding}
        </p>
      )}
      {d.s.challenges.map((c) => {
        const words = src?.quotes.find((q) => q.id === c.quoteId);
        const card = c.cardId && isOstCard(doc.nodes[c.cardId]) ? doc.nodes[c.cardId].meta.ost! : null;
        return (
          <div key={c.id} className={clsx(qr.inset, "flex flex-col gap-[6px] px-[10px] py-[8px]")}>
            <span className="self-start">
              <Tag>{CHALLENGE_LABEL[c.kind]}</Tag>
            </span>
            <p className="text-caption leading-[18px] text-fg" dir="auto">
              {c.text}
            </p>
            {words && (
              <button type="button" className="line-clamp-2 text-left text-micro text-fg-subtle hover:text-fg" dir="auto" title={d.s.file ? "Show in the file" : "Show in your text"} onClick={() => openSource(d.source, words.id)}>
                {d.s.file ? "In the file" : "Your words"}: “{words.text}”
              </button>
            )}
            {card && (
              <button type="button" onClick={() => show(c.cardId!)} className="q-item inline-flex h-[20px] max-w-full items-center self-start rounded-sm bg-active px-[6px] text-micro font-medium text-fg-muted hover:text-fg" title="Show the card">
                <span className="truncate">On “{card.title || "Untitled"}”</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A round answered: what they said (folded), and what Qalam AI took from it. */
function AnsweredPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const b = d?.s.buckets[Number(data.round)];
  if (!b) return null;
  return (
    <div className="flex flex-col gap-[8px]">
      <AnswersSummary questions={b.questions.map(toQuestion)} answers={b.form.answers} label={`Your answers · round ${Number(data.round) + 1}`} />
      {b.analysis && !data.bare && (
        <p className="text-body leading-[20px] text-fg" dir="auto">
          {b.analysis}
        </p>
      )}
    </div>
  );
}

/** What Qalam AI took from a round, after what it looked up on the web for it. */
function AnalysisPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const analysis = d?.s.buckets[Number(data.round)]?.analysis;
  if (!analysis) return null;
  return (
    <p className="text-body leading-[20px] text-fg" dir="auto">
      {analysis}
    </p>
  );
}

function SkipPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  if (!d) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => void skipRest(d.source)}>
        Skip, and place it now
      </button>
      {d.s.file && (
        <button type="button" className={r.replyChip} onClick={() => void leaveFile(String(data.turn))}>
          Leave it out
        </button>
      )}
    </ReplyChips>
  );
}

function PlacePart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  if (!d) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChipPrimary} onClick={() => void placeDump(d.source)}>
        <QalamAIGlyph size={12} /> Place it on the canvas
      </button>
    </ReplyChips>
  );
}

/** A file read for a card that doesn't bear on it: the kind of file that would help, another file, or read anyway. */
function OffPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const t = useTurn(data.turn);
  const pick = useRef<HTMLInputElement>(null);
  if (!d?.s.off || !t) return null;
  const wanted = d.s.off.wanted.replace(/[\s.]+$/, "");
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">{wanted ? `It doesn't seem to be about it. A file that would help: ${wanted}.` : "It doesn't seem to be about it: another file would help more."}</p>
      <ReplyChips>
        <button type="button" className={r.replyChipPrimary} onClick={() => pick.current?.click()}>
          Add another file
        </button>
        <button type="button" className={r.replyChip} onClick={() => void readAnyway(d.source)}>
          <QalamAIGlyph size={12} /> Read it anyway
        </button>
        <button type="button" className={r.replyChip} onClick={() => void leaveFile(t.id)}>
          Leave it out
        </button>
      </ReplyChips>
      <input
        ref={pick}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          if (picked.length) void anotherFile(t.id, picked);
        }}
      />
    </div>
  );
}

function RetryPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  if (!d) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => retryDump(d.source)}>
        <RotateCcw size={12} absoluteStrokeWidth strokeWidth={1.25} /> Try again
      </button>
    </ReplyChips>
  );
}

const CARD_WORD: Record<string, [string, string]> = { outcome: ["goal", "goals"], opportunity: ["problem", "problems"], solution: ["solution", "solutions"], test: ["test", "tests"] };

/** What a review proposes, in a line: new cards by kind, quotes attached, cards changed. */
export function proposedLine(list: readonly Proposal[]): string {
  const kinds = new Map<string, number>();
  let quotes = 0;
  let changes = 0;
  for (const p of list) {
    if (p.kind === "card") kinds.set(p.card.kind, (kinds.get(p.card.kind) ?? 0) + 1);
    else if (p.kind === "attach" || p.kind === "against") quotes++;
    else if (p.kind !== "note") changes++;
  }
  const parts = [...kinds].map(([k, n]) => plural(n, ...(CARD_WORD[k] ?? [KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k, `${k}s`])));
  if (quotes) parts.push(`${plural(quotes, "quote")} attached`);
  if (changes) parts.push(plural(changes, "change", "changes") + " to cards");
  return parts.join(", ");
}

/** Bring the proposals waiting on the canvas into view. */

/** A goal or a problem found for them: each one proposed, with where it would go, to accept or leave out here. */
function FoundList({ list }: { list: Proposal[] }) {
  const doc = useStudio((st) => st.doc);
  return (
    <ul className="flex w-full flex-col gap-[6px]">
      {list.map((p) =>
        p.kind === "card" ? (
          <li key={p.id} className={clsx(qr.inset, "flex flex-col gap-[6px] px-[10px] py-[8px]")}>
            <span className="text-body leading-[20px] text-fg" dir="auto">
              {p.card.title}
            </span>
            <span className="text-micro text-fg-subtle">{p.parentId && doc.nodes[p.parentId]?.meta.ost ? `Under “${doc.nodes[p.parentId].meta.ost!.title}”` : "On its own"}</span>
            <span className="flex gap-[6px]">
              <button type="button" className={r.replyChipPrimary} onClick={() => acceptProposals([p.id])}>
                Accept
              </button>
              <button type="button" className={r.replyChip} onClick={() => discardProposals([p.id])}>
                Leave out
              </button>
            </span>
          </li>
        ) : null,
      )}
    </ul>
  );
}

/** What the dump proposes on the canvas: accepted or discarded here, or one by one on the canvas. */
const cardName = (id: string) => {
  const n = studio().doc.nodes[id];
  return (isOstCard(n) && n.meta.ost.title.trim()) || "the card";
};

function ProposedPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const mine = useReview((v) => (d && v.origin?.kind === "dump" && v.origin.sourceId === d.source ? v.proposals : null));
  const other = useReview((v) => v.proposals.length > 0);
  if (!d) return null;
  const list = mine ?? d.s.proposals ?? [];
  if (!list.length) return <p className="text-body text-fg-muted">Nothing it proposes is left to settle.</p>;
  if (d.s.aim && mine)
    return (
      <div className="flex flex-col items-start gap-[8px]">
        <p className="text-body leading-[20px] text-fg">
          From what you said, {list.length === 1 ? `here's ${d.s.aim.find === "goal" ? "a goal" : "a problem"}` : `here are ${list.length} ${d.s.aim.find === "goal" ? "goals" : "problems"}`}. Each is drawn on the canvas where it would go.
        </p>
        <FoundList list={list} />
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">
        {d.s.file ? `From “${d.s.file.title}”, under “${cardName(d.s.file.card)}”: ` : ""}I propose {proposedLine(list)}. {mine ? "They're drawn on the canvas where they'd go; nothing is kept until you accept it." : "They wait to be reviewed on the canvas."}
      </p>
      {mine ? (
        <ReplyChips>
          <button type="button" className={r.replyChipPrimary} onClick={acceptAll}>
            Accept all
          </button>
          <button type="button" className={r.replyChip} onClick={() => frameReview()}>
            Show them
          </button>
          <button type="button" className={r.replyChip} onClick={discardAll}>
            Discard all
          </button>
        </ReplyChips>
      ) : (
        <ReplyChips>
          <button
            type="button"
            className={r.replyChip}
            disabled={other}
            title={other ? "Another review is open on the canvas: settle it first." : undefined}
            onClick={() => {
              startReview({ kind: "dump", sourceId: d.source }, list);
            }}
          >
            Review them
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

function PlacedPart({ data }: { data: PartData }) {
  const d = useDumpOf(data.turn);
  const c = d?.s.placed?.counts;
  if (!c) return null;
  const said = [c.added ? plural(c.added, "card added", "cards added") : "", c.attached ? plural(c.attached, "piece attached", "pieces attached") : "", c.edited ? plural(c.edited, "card changed", "cards changed") : ""].filter(Boolean).join(" · ");
  return <p className="text-body leading-[20px] text-fg">{said ? `On the canvas: ${said}.` : "Nothing went on the canvas from it."}</p>;
}

/** What they told code's opening questions, folded. */
function OpeningPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const said = t?.job.kind === "dump" ? t.job.find?.said : undefined;
  if (!said?.length) return null;
  return (
    <details className="q-fold group/answers rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">Your answers ({said.length})</summary>
      <dl className="flex flex-col gap-[8px] pb-[10px]">
        {said.map((s, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
            <dt className="text-fg-subtle">{s.question}</dt>
            <dd className="text-fg" dir="auto">
              {s.answer}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A round of a plan's questions, answered, folded. */
function PlanAnsweredPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const round = t?.job.kind === "plan" ? t.job.rounds[Number(data.round)] : undefined;
  const said = round ? answersOf([round]) : [];
  if (!said.length) return null;
  return (
    <details className="q-fold group/answers rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">Your answers</summary>
      <dl className="flex flex-col gap-[8px] pb-[10px]">
        {said.map((s, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
            <dt className="text-fg-subtle">{s.question}</dt>
            <dd className="text-fg" dir="auto">
              {s.answer}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** No more questions: propose with what it has. */
function PlanSkipPart({ data }: { data: PartData }) {
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => skipCanvasPlan(String(data.turn))}>
        Skip, and propose it now
      </button>
    </ReplyChips>
  );
}

/** What a plan proposes: in a line, where to start, what it doubts, and what to do with it. Open on the canvas, or there to bring back. */
function PlanProposedPart({ data }: { data: PartData }) {
  const id = String(data.turn);
  const t = useTurn(id);
  const mine = useReview((v) => (v.origin?.kind === "plan" && v.origin.turn === id ? v.proposals : null));
  const other = useReview((v) => v.proposals.length > 0);
  if (t?.job.kind !== "plan") return null;
  const list = mine ?? t.job.proposals ?? [];
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">
        I propose {planLine(list) || "nothing new"}. {mine ? "They're drawn on the canvas where they'd go; nothing is there until you accept it." : "They're waiting."}
      </p>
      {t.job.start && <p className="text-body leading-[20px] text-fg">Start with “{t.job.start}”: it's the strongest signal so far.</p>}
      {t.job.doubt && (
        <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
          {t.job.doubt}
        </p>
      )}
      {mine ? (
        <ReplyChips>
          <button type="button" className={r.replyChipPrimary} onClick={acceptAll}>
            Accept all
          </button>
          <button type="button" className={r.replyChip} onClick={() => frameReview()}>
            Show them
          </button>
          <button type="button" className={r.replyChip} onClick={discardAll}>
            Discard all
          </button>
        </ReplyChips>
      ) : (
        <ReplyChips>
          <button type="button" className={r.replyChip} disabled={other} title={other ? "Another review is open on the canvas: settle it first." : undefined} onClick={() => showCanvasPlan(id)}>
            Show them on the canvas
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

/** What came of a plan: what's on the canvas of what it proposed. */
function PlanPlacedPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const doc = useStudio((st) => st.doc);
  if (t?.job.kind !== "plan") return null;
  const taken = (t.job.cards ?? []).filter((c) => doc.nodes[c]).length;
  if (!t.job.cards?.length) return <p className="text-body leading-[20px] text-fg">{t.job.doubt ? `${t.job.doubt} ` : ""}I have nothing new to propose for the canvas.</p>;
  return <p className="text-body leading-[20px] text-fg">{taken ? `On the canvas: ${taken} ${taken === 1 ? "card" : "cards"} from the plan.` : "None of what it proposed is on the canvas."}</p>;
}

function PlanRetryPart({ data }: { data: PartData }) {
  return (
    <ReplyChips>
      <button type="button" className={r.replyChipPrimary} onClick={() => retryCanvasPlan(String(data.turn))}>
        Try again
      </button>
    </ReplyChips>
  );
}

/** A plan taken back to a plain answer from what's known. */
function JustAnswerPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const moved = t?.job.kind === "plan" && (t.job.step === "review" || t.job.step === "placed");
  if (!t || moved) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => retake(t.id, "ask")}>
        Just answer instead
      </button>
    </ReplyChips>
  );
}

/**
 * What Qalam AI read on the web while finding a goal's problem: what it looked up, and each line
 * the pages bear out, with where (others' words, never what a card rests on). The opening look is
 * the find turn's; the later ones are its dump's, after the round they followed. Folded to one row,
 * with the sites' icons, as a run of steps is: each line opens on its page's own words and link.
 */
function LookedPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const d = useDumpOf(data.turn);
  const look = t?.job.kind === "find" ? t.job.look : t?.job.kind === "plan" ? t.job.looks[Number(data.look)] : data.look !== undefined ? d?.s.looks?.[Number(data.look)] : undefined;
  if (!look) return null;
  if (look.noWeb) return <p className="text-body leading-[20px] text-fg">I can&apos;t look on the web here, so I&apos;ll go by what you tell me.</p>;
  const what = look.query ? `Looked up “${look.query}”` : t?.job.kind === "plan" ? "Looked on the web for what people do about this" : "Looked on the web for what gets in the way of goals like this";
  if (!look.lines.length) return <p className="text-body leading-[20px] text-fg">{what}, but nothing on the pages I read held up.</p>;
  const urls = look.lines.flatMap((l) => (l.url ? [l.url] : []));
  const n = look.lines.length;
  return (
    <details className="q-fold group/look">
      <summary className="-mx-[6px] flex h-[30px] cursor-pointer list-none items-center gap-[8px] rounded-lg px-[6px] text-body text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <SiteStack urls={urls} />
        <span className="min-w-0 truncate text-fg" dir="auto">
          {what}
        </span>
        <span className="tnum shrink-0 text-caption text-fg-subtle">
          {n} {n === 1 ? "finding" : "findings"}
        </span>
        <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 transition-[rotate] duration-fast group-open/look:rotate-180" />
      </summary>
      <div className="flex flex-col gap-[6px] pt-[4px]">
        <ul className={clsx(qr.inset, "flex flex-col divide-y divide-line-subtle overflow-hidden")}>
          {look.lines.map((l) => (
            <li key={l.id}>
              <details className="q-fold group/line">
                <summary className="flex cursor-pointer list-none items-start gap-[8px] px-[10px] py-[8px] hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <SiteIcon url={l.url} className="mt-[1px]" />
                  <span className="min-w-0 flex-1 truncate text-caption leading-[18px] text-fg group-open/line:whitespace-normal" dir="auto">
                    {l.text}
                  </span>
                  <ChevronRight size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-fg-subtle transition-[rotate] duration-fast group-open/line:rotate-90" />
                </summary>
                <div className="flex flex-col gap-[4px] pb-[10px] pl-[34px] pr-[10px]">
                  {l.quote && l.quote !== l.text && (
                    <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
                      “{l.quote}”
                    </p>
                  )}
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-[4px] self-start text-micro text-fg-subtle hover:text-fg" title={l.url}>
                      <span className="truncate">{l.title || hostName(l.url)}</span>
                      {l.title && <span className="shrink-0">· {hostName(l.url)}</span>}
                      <ArrowUpRight size={11} strokeWidth={1.75} className="shrink-0" />
                    </a>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
        <p className="text-micro text-fg-subtle">Others&apos; words, not your customers&apos;.</p>
      </div>
    </details>
  );
}

const hostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** "Help me find one" let go before it's answered. */
function CancelPart({ data }: { data: PartData }) {
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => dropTurn(String(data.turn))}>
        Never mind
      </button>
    </ReplyChips>
  );
}

const WHAT: Record<"goal" | "problem", string> = { goal: "a goal", problem: "a problem" };

/** A short statement: what it could be, in their words, the likelier first. */
function ChoosePart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "choose") return null;
  const order: ("goal" | "problem")[] = t.job.first === "goal" ? ["goal", "problem"] : ["problem", "goal"];
  return (
    <ReplyChips>
      {order.map((m, i) => (
        <button key={m} type="button" className={i === 0 ? r.replyChipPrimary : r.replyChip} onClick={() => retake(t.id, m)}>
          Add as {WHAT[m]}
        </button>
      ))}
      <button type="button" className={r.replyChip} onClick={() => retake(t.id, "ask")}>
        Ask about it
      </button>
      <button type="button" className={r.replyChip} onClick={() => retake(t.id, "plan")}>
        Work it out as a plan
      </button>
      <button type="button" className={r.replyChip} onClick={() => retake(t.id, "scan")}>
        Look into it
      </button>
    </ReplyChips>
  );
}

/** Their words on the canvas: where they went, and the card brought into view. */
function AddedPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "add" ? t.job : null;
  const there = useStudio((s) => !!j && !!s.doc.nodes[j.card]);
  if (!t || !j) return null;
  const above = j.under ? studio().doc.nodes[j.under]?.meta.ost?.title : null;
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">{there ? `I put it on the canvas as ${WHAT[j.what]}${above ? `, under “${above}”` : ""}${studio().doc.nodes[j.card]?.meta.ost?.title === titleFrom(t.said) ? ", in your words" : ", with your words on it"}.` : `It went on the canvas as ${WHAT[j.what]}, and isn't there any more.`}</p>
      {there && (
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => show(j.card)}>
            Show it
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

/** Qalam AI's wording of their goal or problem, before it's written: use it, edit it, or keep their words. */
function StatementPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "add" && t.job.state === "suggested" ? t.job : null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(j?.suggestion ?? "");
  if (!t || !j) return null;
  const id = String(data.turn);
  if (!j.suggestion)
    return (
      <div className="flex flex-col items-start gap-[8px]">
        <p className="text-body leading-[20px] text-fg">I'd put it on the canvas as {WHAT[j.what]}, as you wrote it.</p>
        <ReplyChips>
          <button type="button" className={r.replyChipPrimary} onClick={() => placeStatement(id, t.said)}>
            Add it
          </button>
        </ReplyChips>
      </div>
    );
  return (
    <div className="flex w-full flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">As {WHAT[j.what]}, I'd word it:</p>
      {editing ? (
        <textarea
          aria-label={j.what === "goal" ? "The goal, in your words" : "The problem, in your words"}
          rows={2}
          dir="auto"
          autoFocus
          className={clsx(r.textarea, "text-body")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && text.trim()) {
              e.preventDefault();
              placeStatement(id, text);
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <p className={clsx(qr.inset, "w-full px-[10px] py-[8px] text-body leading-[20px] font-medium text-fg")} dir="auto">
          {j.suggestion}
        </p>
      )}
      {j.why && !editing && <p className="text-caption leading-[18px] text-fg-muted">{j.why}</p>}
      <ReplyChips>
        <button type="button" disabled={editing && !text.trim()} className={r.replyChipPrimary} onClick={() => placeStatement(id, editing ? text : j.suggestion!)}>
          {editing ? "Add this" : "Use it"}
        </button>
        {!editing && (
          <button type="button" className={r.replyChip} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button type="button" className={r.replyChip} onClick={() => placeStatement(id, t.said)}>
          Keep my words
        </button>
      </ReplyChips>
    </div>
  );
}

/** Taken one way, it could have been another: a short message's other ways, in a line. */
function SwitchPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (!t) return null;
  const plan = (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => void runAs(null, t.said, "plan")}>
        <QalamAIGlyph size={12} /> Plan from this
      </button>
    </ReplyChips>
  );
  if (wordsIn(t.said) >= DUMP_WORDS) return plan;
  const other: [ChatMode, string][] = [
    ["problem", "Add it as a problem"],
    ["goal", "Add it as a goal"],
  ];
  return (
    <>
    {plan}
    <p className="flex flex-wrap items-center gap-x-[6px] text-caption text-fg-subtle">
      Not a question?
      {other.map(([m, label], i) => (
        <span key={m} className="inline-flex items-center gap-[6px]">
          {i > 0 && <span aria-hidden>·</span>}
          <button type="button" className="text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={() => retake(t.id, m)}>
            {label}
          </button>
        </span>
      ))}
    </p>
    </>
  );
}

const NOT_THAT: Record<Basis, string> = { said: "Not what people said?", measured: "Not measured?", studied: "Not a study?", read: "Not from elsewhere?", own: "Not your thinking?" };

/** What a document is, as a person can set it: its label reads as a link. */
function BasisSelect({ label, value, options, onPick }: { label: string; value: Basis | ""; options: readonly Basis[]; onPick: (b: Basis) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => isBasis(e.target.value) && onPick(e.target.value)} className="cursor-pointer appearance-none bg-transparent text-caption text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg">
      <option value="" disabled>
        {label}
      </option>
      {options.map((b) => (
        <option key={b} value={b}>
          {BASIS_LABEL[b]}
        </option>
      ))}
    </select>
  );
}

/** What each document taken in was read as, and a way to say it's something else. */
function TakenPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "take" || !t.job.docs) return null;
  return (
    <ul className="flex flex-col gap-[8px]">
      {t.job.docs.map((d) => {
        const main = mainBasis(d.points);
        const line = countsLine(d.points);
        return (
          <li key={d.source} className="flex flex-col gap-[2px]">
            <p className="text-body leading-[20px] text-fg" dir="auto">
              {d.about || `“${d.title}”`}
            </p>
            <p className="text-caption text-fg-muted">{line || "I kept it, but found nothing in it to go on."}</p>
            {d.pictures && <p className="text-caption text-fg-muted">{d.pictures}.</p>}
            {d.numbers?.map((n) => (
              <p key={n.goal} className="flex flex-wrap items-center gap-x-[6px] text-caption text-fg-muted">
                It says {n.value.toLocaleString()} for “{n.title}”.
                {n.used ? (
                  <span className="text-fg-subtle">Used.</span>
                ) : (
                  <button type="button" className="text-fg underline decoration-fg/30 underline-offset-2" onClick={() => void takeGoalNumber(t.id, d, n)}>
                    Use it
                  </button>
                )}
              </p>
            ))}
            {d.found?.map((g) => <FoundGoalRow key={g.id} goal={g} onDecide={(accept) => void decideDocGoal(t.id, d.source, g.id, accept)} />)}
            <BasisSelect label={d.basis ? `You said: ${BASIS_LABEL[d.basis]}. Change it` : main ? `${NOT_THAT[main]} Change it` : "Say what it is"} value="" options={BASES} onPick={(b) => void changeDocBasis(t.id, d.source, b)} />
          </li>
        );
      })}
    </ul>
  );
}

/** A doc that read as their own thinking: it says so, and a way to say it's evidence instead. */
function AsOwnPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "dump" || !t.job.asOwn) return null;
  const { title, cut } = t.job.asOwn;
  return (
    <div className="flex flex-col gap-[2px]">
      <p className="text-body leading-[20px] text-fg" dir="auto">
        “{title}” reads as your own thinking, so I&apos;ll push back on it rather than file it as evidence.{cut ? " It's long, so this is its start." : ""}
      </p>
      <BasisSelect label="Not your thinking? Say what it is" value="" options={["said", "measured", "studied", "read"]} onPick={(b) => void takeAsBasis(t.id, b)} />
    </div>
  );
}

/** The problems' pages what was taken in went into, each opening in the canvas's panel. */
function PagesPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "take" || !t.job.pages.length) return null;
  return (
    <ul className="flex flex-col gap-[4px]">
      {t.job.pages.map((p) => (
        <li key={p.id}>
          <a href={topicHref(p.id)} className="q-item flex min-w-0 items-center rounded-md bg-raised px-[10px] py-[6px] text-body text-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover" dir="auto">
            <span className="truncate">{p.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** What others report, each with the page it's on (its words on hover). */
function OthersReport({ list }: { list: readonly Benchmark[] }) {
  if (!list.length) return null;
  return (
    <ul className="flex flex-col gap-[4px]">
      {list.map((b) => (
        <li key={`${b.url}:${b.what}:${b.value}`} className="flex flex-col text-caption leading-[18px] text-fg-muted">
          <span dir="auto">
            {b.what}: <span className="font-medium text-fg">{withUnit(b.value, b.unit)}</span>
          </span>
          <a href={b.url} target="_blank" rel="noreferrer" className="truncate text-micro text-fg-subtle hover:text-fg" title={`“${b.quote}”`}>
            {b.who || hostName(b.url)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The goals on the canvas it would move, each to take or leave out. */
function GoalFitsPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "goalfor" ? t.job : null;
  if (!t || !j) return null;
  return (
    <div className="flex w-full flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">{j.fits?.length === 1 ? "It would move a goal you already have:" : "It would move goals you already have:"}</p>
      <ul className="flex w-full flex-col gap-[6px]">
        {j.fits?.map((f) => (
          <li key={f.goal} className={clsx(qr.inset, "flex flex-col gap-[6px] px-[10px] py-[8px]")}>
            <p className="text-body leading-[20px] font-medium text-fg" dir="auto">
              {f.title}
            </p>
            <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
              {f.how}
            </p>
            <ReplyChips>
              <button type="button" className={r.replyChipPrimary} onClick={() => takeFit(t.id, f.goal)}>
                Put it under this goal
              </button>
              <button type="button" className={r.replyChip} onClick={() => leaveFit(t.id, f.goal)}>
                Not this one
              </button>
            </ReplyChips>
          </li>
        ))}
      </ul>
      <ReplyChips>
        <button type="button" className={r.replyChip} onClick={() => lookPastFits(t.id)}>
          Look for another goal
        </button>
      </ReplyChips>
    </div>
  );
}

/** The goals proposed for it: one to take, with what others report for each, and whether a page backs it. */
function GoalIdeasPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "goalfor" ? t.job : null;
  if (!t || !j) return null;
  const pages = j.looked?.pages.length ?? 0;
  const lead = j.looked?.goals ? "None of your goals fits." : "You have no goals here yet.";
  if (!j.ideas?.length)
    return (
      <div className="flex flex-col items-start gap-[8px]">
        <p className="text-body leading-[20px] text-fg">I couldn't find a goal for it that holds up. You can write one on the canvas and put this problem under it.</p>
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => dropTurn(t.id)}>
            Never mind
          </button>
        </ReplyChips>
      </div>
    );
  return (
    <div className="flex w-full flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg">{lead} {j.looked?.noWeb ? "I can't look on the web here, so from what I know of companies like yours, it could move:" : pages ? "From what I read about companies like yours, it could move:" : "The web had nothing that held up, so from what I know of companies like yours, it could move:"}</p>
      <ul className="flex w-full flex-col gap-[6px]">
        {j.ideas.map((g, i) => (
          <li key={g.id} className={clsx(qr.inset, "flex flex-col gap-[6px] px-[10px] py-[8px]")}>
            <p className="text-body leading-[20px] font-medium text-fg" dir="auto">
              {g.title}
            </p>
            <p className="text-caption text-fg-muted" dir="auto">
              Measured by {g.metric.name}
              {g.metric.unit ? ` (${g.metric.unit})` : ""}
            </p>
            {g.why && (
              <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
                {g.why}
              </p>
            )}
            <OthersReport list={g.others} />
            <ReplyChips>
              <button type="button" className={i === 0 ? r.replyChipPrimary : r.replyChip} onClick={() => takeIdea(t.id, g.id)}>
                Use this goal
              </button>
            </ReplyChips>
          </li>
        ))}
      </ul>
      <ReplyChips>
        <button type="button" className={r.replyChip} onClick={() => dropTurn(t.id)}>
          None of these
        </button>
      </ReplyChips>
    </div>
  );
}

/** Which goal it's going under, as it's settled. */
function GoalOnPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "goalfor" ? t.job : null;
  if (!j?.on) return null;
  return (
    <p className="text-body leading-[20px] text-fg" dir="auto">
      I put it under “{j.on.title}”.
    </p>
  );
}

/** The number suggested for its goal: to use, change or leave. A number only Qalam AI's knowledge rests on says so. */
function GoalNumberPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "goalfor" ? t.job : null;
  const s = j?.suggestion;
  const [text, setText] = useState(s?.target !== null && s?.target !== undefined ? String(s.target) : "");
  if (!t || !j) return null;
  const value = Number(text.replace(/,/g, "").trim());
  const ok = text.trim() !== "" && Number.isFinite(value);
  const unit = j.on?.metric?.unit;
  const label = j.on?.metric?.name ?? "the number";
  const known = !!s && !s.others.length;
  return (
    <div className="flex w-full flex-col items-start gap-[8px]">
      {!s ? (
        <p className="text-body leading-[20px] text-fg">{j.error ? `I couldn't work out a number (${j.error}).` : "I couldn't work out a number I could stand behind."} What would you aim for?</p>
      ) : s.target === null ? (
        <p className="text-body leading-[20px] text-fg">
          I'd aim to move {label} by {s.move}%. Where it stands today decides what that is in your number: what would that be?
        </p>
      ) : (
        <p className="text-body leading-[20px] text-fg">
          I'd aim for {withUnit(s.target, unit)}
          {j.on?.now !== null && j.on?.now !== undefined ? ` from ${withUnit(j.on.now, unit)}` : ""}
          {s.timeframe ? `, ${s.timeframe}` : ""}.
        </p>
      )}
      {s?.why && (
        <p className="text-caption leading-[18px] text-fg-muted" dir="auto">
          {s.why}
        </p>
      )}
      {s && <OthersReport list={s.others} />}
      {known && <p className="text-caption leading-[18px] text-fg-subtle">Only what I know of the industry: I couldn't check it on a page, so treat it as a starting point.</p>}
      <label className="flex items-center gap-[6px] text-caption text-fg-muted">
        Target
        <input aria-label={`The target for ${label}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className={clsx(r.field, "w-[96px] outline-none")} />
        {unit}
      </label>
      <ReplyChips>
        <button type="button" disabled={!ok} className={r.replyChipPrimary} onClick={() => settleNumber(t.id, value, s?.timeframe)}>
          {s?.target !== null && s?.target !== undefined && value === s.target ? "Use it" : "Use this number"}
        </button>
        <button type="button" className={r.replyChip} onClick={() => settleNumber(t.id, null)}>
          No target yet
        </button>
      </ReplyChips>
    </div>
  );
}

/** Where it ended up: the goal, its number, and the card to look at. */
function GoalDonePart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const j = t?.job.kind === "goalfor" ? t.job : null;
  const metric = useStudio((s) => {
    const n = j?.on ? s.doc.nodes[j.on.card] : undefined;
    return isOstCard(n) ? n.meta.ost.metric : undefined;
  });
  const there = useStudio((s) => !!j?.on && !!s.doc.nodes[j.on.card]);
  if (!j?.on) return null;
  const line = goalNumberLine(metric);
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-body leading-[20px] text-fg" dir="auto">
        “{j.title}” is under “{j.on.title}” now{line ? ` (${line})` : ""}.
      </p>
      {there && (
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => show(j.on!.card)}>
            Show the goal
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

function GoalRetryPart({ data }: { data: PartData }) {
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => retryGoalFor(String(data.turn))}>
        Try again
      </button>
      <button type="button" className={r.replyChip} onClick={() => dropTurn(String(data.turn))}>
        Never mind
      </button>
    </ReplyChips>
  );
}

/** The docs a message carried, under it. */
function DocsPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  return t?.docs?.length ? <DocsSent docs={t.docs} /> : null;
}

/** A scan under way: what it's doing, Stop on the box, and the other reading of their words. */
function ScanningPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "scan") return null;
  const s = t.job.session;
  const other = otherReading(t.job.target, t.said);
  const found = (s?.competitors ?? []).filter((c) => !isOff(s?.steer, c.name));
  const canTake = !!s && !s.read.length;
  return (
    <div className="flex flex-col gap-[6px]">
      <Progress label={s?.steps.at(-1) ?? "Starting"} started={s?.at ?? t.at} tokens={0} note="This takes a few minutes, and goes on if you close this." />
      {found.length > 0 && (
        <div className="flex flex-col gap-[4px]">
          {/* Once it's reading them there's nothing left to take them out of. */}
          <p className="text-caption text-fg-muted">{canTake ? (t.job.target.kind === "idea" ? "What I found people using. Take off any that's wrong:" : "The app I found. Take it off if it's the wrong one:") : t.job.target.kind === "idea" ? "What I found people using:" : "The app I found:"}</p>
          <div className="flex flex-wrap gap-[4px]">
            {found.map((c) => (
              <span key={c.name} className={clsx(r.chip, "max-w-full")}>
                <span className="truncate" dir="auto">
                  {c.app?.name ?? c.name}
                </span>
                {canTake && (
                  <button type="button" aria-label={`Take off ${c.app?.name ?? c.name}`} className="-mr-[2px] grid size-[14px] shrink-0 place-items-center rounded-sm hover:bg-hover" onClick={() => steerOff(c.name)}>
                    <X size={10} absoluteStrokeWidth strokeWidth={1.5} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-caption text-fg-muted">
        I took this as {t.job.target.kind === "idea" ? "an idea" : `a product${t.job.target.name ? `: ${t.job.target.name}` : ""}`}.
        {other && (
          <>
            {" "}
            <button type="button" className="underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={() => scanOtherWay(t.id)}>
              Read it as {other.kind === "idea" ? "an idea" : "a product's name"} instead
            </button>
          </>
        )}
      </p>
      {/* The questions sit where the box's Stop would be. */}
      {t.job.ask?.step === "asking" && (
        <button type="button" className="self-start text-caption text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={() => stopTurn(t.id)}>
          Stop reading
        </button>
      )}
    </div>
  );
}

/** What a scan came to: what it read, how far its words were checked, and the way to its problems. */
/** What it found, to share: a card to look at first, and a report of one file. Posting stays theirs. */
function ShareBlock({ job }: { job: ScanJob }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="self-start text-caption text-fg-muted underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={() => setOpen(true)}>
        Share what it found
      </button>
    );
  return <SharePanel job={job} />;
}

function SharePanel({ job }: { job: ScanJob }) {
  const [problems, setProblems] = useState<ShareProblem[] | null>(null);
  const [at, setAt] = useState(0);
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [note, setNote] = useState("");
  const s = job.session!;
  const quotes = peopleQuotes(s.read);
  const places = s.read.filter((x) => x.kind !== "article" && x.quotes).length;
  const shown = problems?.[at];

  useEffect(() => {
    let live = true;
    void scanShare(planOf(job))
      .then((list) => {
        if (!live) return;
        // What they decided to build for comes first, once there is such a thing.
        const first = job.plan?.build?.topic;
        const usable = list.filter((p) => cardQuotes(p.quotes).length > 0);
        setProblems([...usable.filter((p) => p.id === first), ...usable.filter((p) => p.id !== first)]);
      })
      .catch((e: unknown) => live && setNote(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shown) return;
    let live = true;
    let url = "";
    void shareCardPng({ title: shown.title, quotes: cardQuotes(shown.quotes), foot: readLine(quotes, places) })
      .then((bytes) => {
        if (!live || !bytes) return;
        const blob = new Blob([bytes.slice()], { type: "image/png" });
        url = URL.createObjectURL(blob);
        setCard({ blob, url });
      })
      .catch((e: unknown) => live && setNote(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shown, quotes, places]);

  const save = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  };
  const copy = () => {
    if (!card) return;
    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": card.blob })])
      .then(() => setNote("Copied."))
      .catch(() => setNote("This window can't copy pictures. Save it instead."));
  };
  const saveReport = () => {
    const p = job.plan;
    const d = p?.build?.drafts.find((x) => x.id === p.chosen);
    const risk = d ? riskiest(d) : null;
    const plan: ReportData["plan"] = p?.audience
      ? { audience: p.audience.name, ...(p.goal ? { goal: firstGoal(p.audience.name, p.goal.action, p.goal.reach, p.goal.of).title } : {}), ...(d ? { build: d.title, ...(p.build?.pick?.draft === d.id ? { why: p.build.pick.why } : {}), ...(risk ? { wrong: risk.text } : {}), ...(d.test ? { test: d.test.what, ...(d.test.suggested ? { pass: d.test.suggested } : {}) } : {}) } : {}) }
      : undefined;
    const html = reportHtml({ about: projectName(job.target), at: s.at, problems: problems ?? [], quotes, places, ...(plan ? { plan } : {}), known: s.known ?? [] });
    const href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    save(href, "qalam-report.html");
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  return (
    <div className="flex flex-col gap-[8px] rounded-lg p-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg-muted">Look it over first: these are strangers' public words. Posting it is up to you.</p>
      {card ? <img src={card.url} alt={shown ? `A card about: ${shown.title}` : "A card"} className="w-full rounded-md shadow-[0_0_0_1px_var(--color-line-subtle)]" /> : !note && <p className="text-caption text-fg-subtle">Drawing it…</p>}
      {problems && !problems.length && <p className="text-caption text-fg-muted">No problem here has a quote short enough for a card, but the report has them all.</p>}
      {note && <p className="text-caption text-fg-muted">{note}</p>}
      <ReplyChips>
        {card && (
          <button type="button" className={r.replyChipPrimary} onClick={copy}>
            Copy image
          </button>
        )}
        {card && (
          <button type="button" className={r.replyChip} onClick={() => save(card.url, "qalam-card.png")}>
            Save image
          </button>
        )}
        {problems && (
          <button type="button" className={r.replyChip} onClick={saveReport}>
            Save the report
          </button>
        )}
        {problems && problems.length > 1 && (
          <button type="button" className={r.replyChip} onClick={() => setAt((i) => (i + 1) % Math.min(problems.length, 6))}>
            Another problem
          </button>
        )}
      </ReplyChips>
    </div>
  );
}

/** What's known beside what people say: what other products offer and charge, and what's been published, each with its page. */
function KnownFold({ known }: { known: readonly ScanKnown[] }) {
  if (!known.length) return null;
  const products = known.filter((k) => k.kind === "product");
  const published = known.filter((k) => k.kind === "published");
  const row = (k: ScanKnown, i: number) => (
    <li key={i} className="flex flex-col gap-[2px]">
      <span className="text-fg" dir="auto">
        {k.name ? `${k.name}: ` : ""}
        {k.text}
      </span>
      <a href={k.url} target="_blank" rel="noreferrer" className="truncate text-micro text-fg-subtle hover:text-fg" title={k.url}>
        {k.title || hostName(k.url)}
      </a>
    </li>
  );
  return (
    <details className="group/known rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <summary className="flex min-h-[30px] cursor-pointer list-none items-center gap-[6px] py-[6px] font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">{products.length && published.length ? "What others offer, and what's been published" : products.length ? "What others offer" : "What's been published"}</summary>
      <div className="flex flex-col gap-[10px] pb-[10px]">
        <p className="text-fg-subtle">Read elsewhere, not your customers' words.</p>
        {products.length > 0 && <ul className="flex flex-col gap-[8px]">{products.map(row)}</ul>}
        {published.length > 0 && <ul className="flex flex-col gap-[8px]">{published.map(row)}</ul>}
      </div>
    </details>
  );
}

function ScannedPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "scan" || !t.job.session) return null;
  const job = t.job;
  const s = job.session!;
  const kept = s.read.filter((x) => x.quotes);
  const apps = kept.filter((x) => x.kind === "reviews").map((x) => x.title.replace(/^App Store reviews: /, ""));
  const threads = kept.filter((x) => x.kind === "thread").length;
  const pages = kept.filter((x) => x.kind === "page").length;
  const people = peopleQuotes(s.read);
  const said = people === 1 ? "1 quote" : `${people} quotes`;
  const read = [apps.length ? `App Store reviews of ${apps.join(", ")}` : "", threads ? `${threads} Hacker News ${threads === 1 ? "thread" : "threads"}` : "", pages ? `${pages} ${pages === 1 ? "forum page" : "forum pages"}` : ""].filter(Boolean).join(", ");
  const refused = s.skipped.unreadable;
  const mineOffer = job.target.kind === "product" && !job.mine && s.read.some((x) => x.kind === "reviews" && x.sourceId);
  const isMineThen = job.mine;
  // Asked again: everything it found it had read already, so nothing here is a verdict on what's there.
  const already = s.thin && !s.read.some((x) => x.kind !== "article") && s.skipped.before > 0;
  return (
    <div className="flex flex-col gap-[8px]">
      {already ? (
        <p className="text-body text-fg">Nothing new: I've read all of this already, and what it says is in your problems.</p>
      ) : s.thin ? (
        <p className="text-body text-fg">
          I found little{s.problems.length ? `: ${s.problems.length === 1 ? "1 problem" : `${s.problems.length} problems`} from ${said}` : ""}, so I won't call it a pattern. {read ? `I read ${read}.` : "Nothing I could read spoke to it."}
        </p>
      ) : (
        <p className="text-body text-fg">
          {s.problems.length} problems, from {said}: {read}.
        </p>
      )}
      {!s.thin && <p className="text-caption text-fg-muted">{isMineThen ? "Your own app's reviews count as your customers' words; the rest is what people say publicly." : "This is what people say publicly, so it stays in We believe until your own customers say it too."}</p>}
      {(refused > 0 || s.skipped.reddit > 0) && (
        <p className="text-caption text-fg-subtle">
          {refused > 0 ? `${refused} ${refused === 1 ? "site" : "sites"} wouldn't let me read ${refused === 1 ? "its page" : "their pages"}. ` : ""}
          {s.skipped.reddit > 0 ? "Reddit doesn't let apps read it. " : ""}
          Paste a thread here to add it.
        </p>
      )}
      {s.noWeb && <p className="text-caption text-fg-subtle">There's no web search here, so I read only what I can reach directly.</p>}
      <p className="text-caption text-fg-muted">{moreLine(job.mine ? "company" : "idea")}</p>
      <KnownFold known={s.known ?? []} />
      {!s.thin && s.problems.length > 0 && <ShareBlock job={job} />}
      <ReplyChips>
        {!s.thin && !job.plan && (
          <button type="button" className={r.replyChipPrimary} onClick={() => void planStart(t.id)}>
            <QalamAIGlyph size={12} /> Work out what to build first
          </button>
        )}
        {(s.problems.length > 0 || already) && (
          <button type="button" className={s.thin || job.plan ? r.replyChipPrimary : r.replyChip} onClick={openProblems}>
            See them ranked
          </button>
        )}
        {!s.thin && s.problems.length > 0 && (
          <button type="button" className={r.replyChip} onClick={() => void goalForTopProblem()}>
            Find goals for a problem
          </button>
        )}
        {s.thin && !already && (
          <button type="button" className={r.replyChip} onClick={addMaterial}>
            Add what you have
          </button>
        )}
        {mineOffer && (
          <button type="button" className={r.replyChip} onClick={() => void scanIsMine(t.id)}>
            This is my product
          </button>
        )}
      </ReplyChips>
    </div>
  );
}

/** Another scan's problems are in this project: where this one goes is theirs to say. */
function ScanWherePart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "scan") return null;
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-body text-fg">This project is about something else, and problems from unrelated products would run together. Start a new project for this?</p>
      <ReplyChips>
        <button type="button" className={r.replyChipPrimary} onClick={() => void scanInNewProject(t.id)}>
          Start a new project
        </button>
        <button type="button" className={r.replyChip} onClick={() => scanHere(t.id)}>
          Keep it in this one
        </button>
      </ReplyChips>
    </div>
  );
}

/** A line of what's settled so far in a plan. */
const Settled = ({ label, value }: { label: string; value: string }) => (
  <p className="text-caption text-fg-muted">
    {label}: <span className="text-fg" dir="auto">{value}</span>
  </p>
);

/** Who the quotes show, each with the words that show them; or their own words. */
function AudiencesStep({ id, list }: { id: string; list: readonly ScanAudience[] }) {
  const [own, setOwn] = useState("");
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-body text-fg">{list.length ? "Who should this be for first? Here's who the quotes show." : "These quotes don't say who wrote them, so I won't guess. Who do you picture using this first?"}</p>
      {list.map((a) => (
        <div key={a.id} className="flex flex-col gap-[6px] rounded-lg bg-raised px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <p className="text-body font-medium text-fg" dir="auto">{a.name}</p>
          {a.about && <p className="text-caption text-fg-muted" dir="auto">{a.about}</p>}
          <ul className="flex flex-col gap-[4px]">
            {a.quotes.slice(0, 2).map((q) => (
              <li key={q.ref} className="text-caption text-fg-subtle" dir="auto">
                “{q.text.length > 140 ? `${q.text.slice(0, 139)}…` : q.text}”
              </li>
            ))}
          </ul>
          <button type="button" className={clsx(r.replyChip, "self-start")} onClick={() => pickAudience(id, a)}>
            Build for them
          </button>
        </div>
      ))}
      <form
        className="flex gap-[6px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim()) pickAudience(id, { name: own });
        }}
      >
        <input aria-label="Someone else" dir="auto" value={own} onChange={(e) => setOwn(e.target.value)} placeholder={list.length ? "Someone else" : "Who they are"} className={clsx(r.field, r.fieldInput, "min-w-0 flex-1")} />
        <button type="submit" disabled={!own.trim()} className={clsx(r.buttonSm, r.buttonSecondary, "shrink-0")}>
          Build for them
        </button>
      </form>
    </div>
  );
}

/** A first goal about learning: worded by code, its numbers a suggestion until they take it. */
function GoalStep({ id, name, goal }: { id: string; name: string; goal: { action: GoalAction; reach: number; of: number } }) {
  const set = (o: Partial<typeof goal>) => setPlanGoal(id, { ...goal, ...o });
  const num = (v: string, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : fallback;
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-body text-fg">A first goal, to learn whether they want this before you build much. What would show you they do?</p>
      <ReplyChips>
        {GOAL_ACTIONS.map((a) => (
          <button key={a.id} type="button" className={a.id === goal.action ? r.replyChipPrimary : r.replyChip} onClick={() => set({ action: a.id })}>
            {a.label}
          </button>
        ))}
      </ReplyChips>
      <p className="flex flex-wrap items-center gap-[6px] text-caption text-fg-muted">
        <input aria-label="How many" type="number" min={1} value={goal.reach} onChange={(e) => set({ reach: num(e.target.value, goal.reach) })} className={clsx(r.field, r.fieldInput, "w-[52px]")} />
        of
        <input aria-label="Out of how many" type="number" min={1} value={goal.of} onChange={(e) => set({ of: num(e.target.value, goal.of) })} className={clsx(r.field, r.fieldInput, "w-[52px]")} />
        <span>These numbers are only a suggestion: change them to what would convince you.</span>
      </p>
      <p className="text-body font-medium text-fg" dir="auto">{firstGoal(name, goal.action, goal.reach, goal.of).title}</p>
      <ReplyChips>
        <button type="button" className={r.replyChipPrimary} onClick={() => void planFirst(id)}>
          Use this goal
        </button>
      </ReplyChips>
    </div>
  );
}

/** What to build first: the strongest signal so far, what has to be true, and the others a click away. */
function PickedStep({ id, plan }: { id: string; plan: ScanPlan }) {
  const b = plan.build!;
  const d = b.drafts.find((x) => x.id === plan.chosen) ?? b.drafts[0];
  const isPick = d.id === b.pick?.draft;
  const risk = riskiest(d);
  const others = b.drafts.filter((x) => x.id !== d.id);
  const placed = plan.step === "placed";
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-caption text-fg-muted">Strongest signal so far, from what people say publicly: not proof.</p>
      <Settled label="The problem" value={b.problem} />
      <div className="flex flex-col gap-[6px] rounded-lg bg-raised px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        <p className="text-micro font-medium text-fg-subtle">Build first</p>
        <p className="text-body font-medium text-fg" dir="auto">{d.title}</p>
        <p className="text-caption text-fg-muted" dir="auto">{d.description}</p>
        {isPick && b.pick?.why && <p className="text-caption text-fg" dir="auto">{b.pick.why}</p>}
        {risk && <Settled label="What has to be true" value={risk.text} />}
        {d.test && <Settled label="Test it first" value={d.test.what} />}
        {d.test?.suggested && <Settled label="A suggested pass line" value={d.test.suggested} />}
      </div>
      {others.length > 0 && !placed && (
        <div className="flex flex-col gap-[4px]">
          <p className="text-caption text-fg-subtle">Can wait, or pick one instead:</p>
          {others.map((x) => {
            const why = b.pick?.later.find((l) => l.draft === x.id)?.why;
            return (
              <button key={x.id} type="button" className="q-item flex flex-col rounded-md px-[8px] py-[4px] text-left hover:bg-hover" onClick={() => chooseDraft(id, x.id)}>
                <span className="text-caption text-fg" dir="auto">{x.title}</span>
                {why && <span className="text-micro text-fg-subtle" dir="auto">{why}</span>}
              </button>
            );
          })}
        </div>
      )}
      {placed && <p className="text-caption text-fg-muted">It's on the canvas: the goal, the problem under it, then the solution and its test.</p>}
      {plan.brief ? (
        <BriefStep id={id} brief={plan.brief} />
      ) : (
        <ReplyChips>
          {!placed && (
            <button type="button" className={r.replyChipPrimary} onClick={() => void placeFirstBuild(id)}>
              Put it on the canvas
            </button>
          )}
          <button type="button" className={placed ? r.replyChipPrimary : r.replyChip} onClick={() => void briefStart(id)}>
            Write a brief for your coding agent
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

/** A brief: what it lacks, being written, then a tile on the canvas to open or copy. */
const BRIEF_WORD: Record<BriefShape, string> = { build: "brief", message: "message plan", steps: "list of steps" };

function BriefStep({ id, brief, shape = "build" }: { id: string; brief: BriefState; shape?: BriefShape }) {
  const word = BRIEF_WORD[shape];
  const [copied, setCopied] = useState(false);
  const started = useCanvasChat((s) => s.live[id]?.started);
  // Not known yet is not gone.
  const kept = useBriefs((s) => !s.loaded || s.list.some((b) => b.id === brief.id));
  if (brief.step === "asking") return <p className="text-body text-fg">A few things for the {word}. Skip any you can't answer.</p>;
  if (brief.step === "writing") return <Progress label={`Writing the ${word}`} started={started ?? Date.now()} tokens={0} note="This takes under a minute." />;
  if (brief.step === "failed")
    return (
      <div className="flex flex-col gap-[6px]">
        <p className="text-body text-fg">{brief.error === "You stopped it." ? "You stopped it." : `I couldn't write it: ${brief.error ?? "something went wrong"}`}</p>
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => briefAgain(id)}>
            Try again
          </button>
        </ReplyChips>
      </div>
    );
  if (!kept)
    return (
      <div className="flex flex-col gap-[6px]">
        <p className="text-body text-fg-muted">This {word} has been taken off the canvas.</p>
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => briefAgain(id)}>
            Write it again
          </button>
        </ReplyChips>
      </div>
    );
  const copy = () =>
    brief.id &&
    void getBrief(brief.id)
      .then((b) => navigator.clipboard.writeText(b.body))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-body text-fg">The {word} is on the canvas, under its card. Click it there to read it.</p>
      {brief.id && (
        <ReplyChips>
          <button type="button" className={r.replyChipPrimary} onClick={() => openBrief(brief.id!)}>
            Open it
          </button>
          <button type="button" className={r.replyChip} onClick={copy}>
            {copied ? "Copied" : shape === "build" ? "Copy for your coding agent" : "Copy it"}
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

function BriefPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  return t?.job.kind === "brief" ? <BriefStep id={t.id} brief={t.job.brief} shape={t.job.shape} /> : null;
}

/** From a scan's problems to what to build first, the step it's on and what's settled. */
function ScanPlanPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "scan" || !t.job.plan) return null;
  const p = t.job.plan;
  const live = useCanvasChat.getState().live[t.id];
  const goal = p.audience && p.goal ? firstGoal(p.audience.name, p.goal.action, p.goal.reach, p.goal.of).title : "";
  return (
    <div className="flex flex-col gap-[8px] pt-[4px]">
      {p.audience && p.step !== "audiences" && <Settled label="For" value={p.audience.name} />}
      {goal && p.step !== "goal" && <Settled label="First goal" value={goal} />}
      {p.step === "questioning" && <Progress label="Working out what to ask" started={live?.started ?? t.at} tokens={0} note="A few short questions, then who it's for." />}
      {p.step === "asking" && <p className="text-body text-fg">A few questions first. Skip any you can't answer.</p>}
      {p.step === "reading" && <Progress label="Reading who these people are" started={live?.started ?? t.at} tokens={0} note="This takes under a minute." />}
      {p.step === "audiences" && <AudiencesStep id={t.id} list={p.audiences ?? []} />}
      {p.step === "goal" && p.audience && p.goal && <GoalStep id={t.id} name={p.audience.name} goal={p.goal} />}
      {p.step === "picking" && <Progress label="Drafting what to build, then picking one" started={live?.started ?? t.at} tokens={0} note="This takes a minute or two." />}
      {(p.step === "picked" || p.step === "placed") && p.build && <PickedStep id={t.id} plan={p} />}
      {p.step === "failed" && (
        <>
          <p className="text-body text-fg">{p.error === "You stopped it." ? "You stopped it." : `I couldn't finish: ${p.error ?? "something went wrong"}`}</p>
          <ReplyChips>
            <button type="button" className={r.replyChip} onClick={() => planAgain(t.id)}>
              Try again
            </button>
          </ReplyChips>
        </>
      )}
    </div>
  );
}

function ScanAgainPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "scan") return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => scanAgain(t.id)}>
        Try again
      </button>
    </ReplyChips>
  );
}

function NoEnginePart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  if (t?.job.kind !== "noEngine") return null;
  const mode = t.job.mode;
  return (
    <div className="flex flex-wrap gap-[6px]">
      <a href={placeHref("connections")} className={r.replyChipPrimary}>
        Set up Qalam AI
      </a>
      {mode && t.said && (
        <button type="button" className={r.replyChip} onClick={() => retake(t.id, mode)}>
          Try again
        </button>
      )}
    </div>
  );
}

export const PARTS: Record<string, PartComponent> = {
  noEngine: NoEnginePart,
  brief: BriefPart,
  planLook: LookedPart,
  planAnswered: PlanAnsweredPart,
  planSkip: PlanSkipPart,
  planProposed: PlanProposedPart,
  planPlaced: PlanPlacedPart,
  planRetry: PlanRetryPart,
  justAnswer: JustAnswerPart,
  scanning: ScanningPart,
  scanned: ScannedPart,
  scanAgain: ScanAgainPart,
  scanWhere: ScanWherePart,
  scanPlan: ScanPlanPart,
  taken: TakenPart,
  asOwn: AsOwnPart,
  working: WorkingPart,
  answer: AnswerPart,
  choose: ChoosePart,
  added: AddedPart,
  statement: StatementPart,
  switch: SwitchPart,
  pages: PagesPart,
  docs: DocsPart,
  dumping: DumpingPart,
  took: TookPart,
  answered: AnsweredPart,
  analysis: AnalysisPart,
  skip: SkipPart,
  place: PlacePart,
  retry: RetryPart,
  off: OffPart,
  proposed: ProposedPart,
  placed: PlacedPart,
  opening: OpeningPart,
  looked: LookedPart,
  cancel: CancelPart,
  goalFits: GoalFitsPart,
  goalIdeas: GoalIdeasPart,
  goalOn: GoalOnPart,
  goalNumber: GoalNumberPart,
  goalDone: GoalDonePart,
  goalRetry: GoalRetryPart,
};
