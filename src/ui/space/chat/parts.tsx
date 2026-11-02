import { BASES, BASIS_LABEL, countsLine, isBasis, mainBasis, type Basis } from "@/discovery/basis";
import { useRef, useState } from "react";
import clsx from "clsx";
import { Check, Quote, RotateCcw } from "lucide-react";
import { nanoid } from "nanoid";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { useGhosts } from "@/doc/ghosts";
import { CHALLENGE_LABEL, type DumpSession } from "@/discovery/dump";
import { KIND_LABEL } from "@/discovery/kinds";
import type { Proposal } from "@/discovery/proposals";
import type { AskAnswer, AskClaim, AskUnknown } from "@/hub/ask";
import { DUMP_WORDS, wordsIn, type ChatMode } from "@/space/route";
import { claimStrip } from "@/hub/ask";
import type { TopicInfo } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import type { PartData } from "../../chat/types";
import type { PartComponent } from "../../chat/ChatThread";
import { ReplyChips } from "../../chat/ChatThread";
import { DocsSent } from "../../chat/SourcePicker";
import { Progress } from "../../ai/common";
import { toQuestion } from "../../ai/plan";
import { AnswersSummary, qr } from "../../ai/Questionnaire";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { getController } from "../../CanvasView";
import { placeDump, readAnyway, retryDump, sessionOf, skipRest, useDump } from "../../discovery/dump";
import { ACCEPT } from "../../discovery/ingest";
import { REVIEW_TURN, acceptAll, acceptProposals, discardAll, discardProposals, startReview, useReview } from "../../discovery/review";
import { openSource, sourceOf, useSources } from "../../discovery/sources";
import { Button, Spinner, Tag, Tip } from "../../controls";
import { Dots, StatusDot } from "../../viz";
import { r } from "../../recipes";
import { useTopics } from "../../topics/list";
import { useWords } from "../../frame/store";
import { show } from "../links";
import { anotherFile, changeDocBasis, dropTurn, leaveFile, placeStatement, retake, takeAsBasis, turnOf, takeGoalNumber, useCanvasChat } from "./store";
import { titleFrom } from "@/space/route";

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
  const first = t.job.kind === "take" ? "Reading what it says" : t.job.kind === "find" ? "Looking on the web for what usually gets in the way of goals like it" : `Looking through the ${org} for “${said}”`;
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
function showGhosts() {
  const c = getController();
  const ids = useGhosts.getState().list.filter((g) => g.turnId === REVIEW_TURN).flatMap((g) => g.doc.roots);
  if (c && ids.length) requestAnimationFrame(() => c.glideToFit(ids));
}

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
          <button type="button" className={r.replyChip} onClick={showGhosts}>
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
              if (startReview({ kind: "dump", sourceId: d.source }, list)) showGhosts();
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
    <details className="group/answers rounded-lg px-[10px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
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

/**
 * What Qalam AI read on the web while finding a goal's problem: what it looked up, and each line
 * the pages bear out, with where (others' words, never what a card rests on). The opening look is
 * the find turn's; the later ones are its dump's, after the round they followed.
 */
function LookedPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  const d = useDumpOf(data.turn);
  const look = t?.job.kind === "find" ? t.job.look : data.look !== undefined ? d?.s.looks?.[Number(data.look)] : undefined;
  if (!look) return null;
  if (look.noWeb) return <p className="text-body leading-[20px] text-fg">I can&apos;t look on the web here, so I&apos;ll go by what you tell me.</p>;
  const what = look.query ? `I looked up “${look.query}”` : "I looked on the web for what usually gets in the way of goals like this";
  if (!look.lines.length) return <p className="text-body leading-[20px] text-fg">{what}, but nothing on the pages I read held up.</p>;
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-body leading-[20px] text-fg">{what}. What the pages say (others&apos; words, not your customers&apos;):</p>
      <ul className="flex flex-col gap-[6px]">
        {look.lines.map((l) => (
          <li key={l.id} className={clsx(qr.inset, "flex flex-col gap-[2px] px-[10px] py-[8px]")}>
            <span className="text-caption leading-[18px] text-fg" dir="auto">
              {l.text}
            </span>
            {l.url && (
              <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-micro text-fg-subtle hover:text-fg" title={l.quote ? `“${l.quote}”` : l.url}>
                {l.title || hostName(l.url)}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  if (!t || wordsIn(t.said) >= DUMP_WORDS) return null;
  const other: [ChatMode, string][] = [
    ["problem", "Add it as a problem"],
    ["goal", "Add it as a goal"],
  ];
  return (
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

/** The docs a message carried, under it. */
function DocsPart({ data }: { data: PartData }) {
  const t = useTurn(data.turn);
  return t?.docs?.length ? <DocsSent docs={t.docs} /> : null;
}

export const PARTS: Record<string, PartComponent> = {
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
};
