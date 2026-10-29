import { useEffect, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Minus, RotateCcw, Square, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { selectionBounds, type Box } from "@/doc/geometry";
import { isOstCard, treeBounds } from "@/doc/board";
import { revealCard } from "@/discovery/ops";
import { CHALLENGE_LABEL, DUMP_MAX_CHARS, MAX_DUMP_ROUNDS, type DumpChallenge, type DumpSession } from "@/discovery/dump";
import type { SourceRecord } from "@/discovery/sources";
import { SAMPLE_DUMP_ANSWERS } from "@/ai/fixtures-discovery";
import { toQuestion } from "../ai/plan";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { AnswersSummary, Questionnaire, qr } from "../ai/Questionnaire";
import { ErrorNote, Progress } from "../ai/common";
import { placeCard, toScreenBox } from "../ai/anchor";
import { useChatFrame } from "../ai/chatFrame";
import { Button, IconBtn, Tag, Tip } from "../controls";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r } from "../recipes";
import { getController } from "../CanvasView";
import { glideToLayer } from "./canvas";
import { answerRound, closeBrainDump, placeDump, retryDump, saveRound, sessionOf, setDraft, skipRest, startDump, stopDump, useDump } from "./dump";
import { openSource, useSources } from "./sources";
import { Dictated } from "../voice/MicButton";

const W = 380;
const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** Where the card sits: beside the tree the dump was pasted next to, else the selection. */
function anchorBox(doc: ReturnType<typeof studio>["doc"], session: DumpSession | null, selection: string[]): Box | null {
  if (session?.anchor && isOstCard(doc.nodes[session.anchor]) && !doc.nodes[session.anchor].parentId) return treeBounds(doc, session.anchor);
  const picked = selection.filter((id) => doc.nodes[id]);
  return picked.length ? selectionBounds(doc, picked) : null;
}

/**
 * The brain dump on the canvas: write or paste the thinking, then Qalam AI's reading of it, its
 * pushback, and its questions round by round, until it places the dump on the board for review.
 * Minimised, it's a bubble beside the tree (a dot when Qalam AI is waiting on the builder).
 */
export default function BrainDump({ vp }: { vp: { w: number; h: number } }) {
  const open = useDump((s) => s.open);
  const minimised = useDump((s) => s.minimised);
  const source = useSources((s) => (open?.sourceId ? s.list.find((x) => x.id === open.sourceId) : undefined));
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);
  const selection = useStudio((s) => s.selection);
  const bottomInset = useChatFrame((s) => s.bottom);
  const [h, setH] = useState(420);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  if (!open || (open.sourceId && !source)) return null;
  const session = sessionOf(source);
  const box = anchorBox(doc, session, selection);
  const area = { w: vp.w, h: vp.h - bottomInset };
  if (minimised) return <Bubble box={box} session={session} vp={area} />;
  const pos = box ? placeCard(box, cam, area, { w: W, h }) : { left: vp.w - W - 8, top: 8, side: "right" as const };
  return (
    <div
      ref={setEl}
      role="dialog"
      aria-label="Brain dump"
      style={{ left: pos.left, top: pos.top, width: W, maxHeight: area.h - 16, "--radix-popper-transform-origin": pos.side === "right" ? "0 0" : "100% 0" } as CSSProperties}
      className={clsx(r.card, "q-pop pointer-events-auto absolute z-[3] flex flex-col overflow-hidden text-fg")}
      // Keys typed here must not reach the canvas shortcuts (Backspace would delete the selection).
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[8px] pl-[14px]">
        <QalamAIGlyph size={16} done={session?.phase === "placed"} />
        <span className="shrink-0 text-body font-semibold">Brain dump</span>
        {source && (
          <span className="flex min-w-0 flex-1 items-center gap-[6px] text-caption font-medium text-fg-subtle" title={source.title}>
            <span className="text-fg-faint" aria-hidden>
              ·
            </span>
            <span className="truncate" dir="auto">
              {source.title}
            </span>
          </span>
        )}
        {!source && <span className="flex-1" />}
        {session?.sample && <Tag tone="warning">Sample</Tag>}
        <IconBtn size="sm" label="Minimise" onClick={() => useDump.setState({ minimised: true })}>
          <Minus size={14} {...icon} />
        </IconBtn>
        <IconBtn size="sm" label="Close the brain dump" onClick={closeBrainDump}>
          <X size={14} {...icon} />
        </IconBtn>
      </header>
      {source && session ? <Session source={source} s={session} /> : <Compose draft={open.draft} />}
    </div>
  );
}

/** The minimised card: a round bubble beside the tree, with the working ring while Qalam AI is busy and a dot when it waits on the builder. */
function Bubble({ box, session, vp }: { box: Box | null; session: DumpSession | null; vp: { w: number; h: number } }) {
  const cam = useStudio((s) => s.camera);
  const busy = useDump((s) => !!s.busy);
  const s = box ? toScreenBox(box, cam) : { x: vp.w - 48, y: 8, w: 0, h: 0 };
  const waiting = session?.phase === "asking" || session?.phase === "ready" || session?.phase === "failed";
  return (
    <div className="absolute top-0 left-0 z-[3]" style={{ transform: `translate(${Math.round(Math.max(8, Math.min(s.x + s.w + 10, vp.w - 40)))}px, ${Math.round(Math.max(8, Math.min(s.y, vp.h - 40)))}px)` }}>
      <Tip label={waiting ? "Qalam AI is waiting on you" : busy ? "Qalam AI is on your brain dump" : "Show the brain dump"} side="right">
        <button
          type="button"
          aria-label="Show the brain dump"
          onClick={() => useDump.setState({ minimised: false })}
          data-busy={busy || undefined}
          className="q-ai-ring q-item q-press pointer-events-auto grid size-[32px] place-items-center rounded-full rounded-bl-sm bg-raised shadow-floating hover:bg-elevated"
        >
          <QalamAIGlyph size={16} done={session?.phase === "placed"} />
          {waiting && <span className="absolute -top-[2px] -right-[2px] size-[10px] rounded-full bg-fg shadow-[0_0_0_2px_var(--color-canvas)]" aria-label="Waiting on you" />}
        </button>
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writing it

function Compose({ draft }: { draft: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const n = draft.trim().length;
  const over = draft.length > DUMP_MAX_CHARS;
  return (
    <div className="flex min-h-0 flex-col gap-[10px] overflow-y-auto p-[14px]">
      <p className="text-caption leading-[18px] text-fg-muted">Goals, needs, ideas, numbers, what you&apos;ve heard: as it comes. Qalam AI reads it, pushes back and asks before anything lands on the board.</p>
      <Dictated field={box} set={setDraft} max={DUMP_MAX_CHARS} className="flex flex-col">
        <textarea
          ref={box}
          aria-label="Your brain dump"
          autoFocus
          dir="auto"
          rows={10}
          className={clsx(r.textarea, "min-h-[180px] text-body")}
          placeholder="ok so the thing is…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && n >= 40 && !over) void startDump(draft);
          }}
        />
      </Dictated>
      <div className="flex items-center gap-[8px]">
        <span className={clsx("text-micro tnum", over ? "text-danger" : "text-fg-subtle")}>
          {draft.length.toLocaleString()} / {DUMP_MAX_CHARS.toLocaleString()}
        </span>
        <span className="flex-1" />
        <button type="button" className={qr.textBtn} onClick={() => void startDump("", { sample: true })}>
          Try the sample
        </button>
        <Button size="sm" disabled={n < 40 || over} onClick={() => void startDump(draft)} title={n < 40 ? "Write a little more first" : undefined}>
          <QalamAIGlyph size={12} /> Read it
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The conversation

function showCard(id: string) {
  revealCard(id);
  studio().select([id]);
  const c = getController();
  if (c) requestAnimationFrame(() => glideToLayer(c, id));
}

function Session({ source, s }: { source: SourceRecord; s: DumpSession }) {
  const busy = useDump((u) => (u.busy?.sourceId === source.id ? u.busy : null));
  const last = s.buckets.length - 1;
  const asking = s.phase === "asking" && !busy;
  return (
    <>
      <div className="flex min-h-0 flex-col gap-[14px] overflow-y-auto p-[14px]">
        {s.understanding && (
          <div className={qr.card}>
            <span className={qr.caption}>
              <QalamAIGlyph size={12} /> What I took from it
            </span>
            <p className="text-caption leading-[18px] text-fg" dir="auto">
              {s.understanding}
            </p>
          </div>
        )}
        {s.challenges.length > 0 && <Pushback source={source} list={s.challenges} />}
        {s.buckets.map((b, i) =>
          i < last || (i === last && (b.form.submitted || !asking)) ? (
            <div key={i} className="flex flex-col gap-[8px]">
              <AnswersSummary questions={b.questions.map(toQuestion)} answers={b.form.answers} label={`Your answers · round ${i + 1}`} />
              {b.analysis && (
                <div className={qr.card}>
                  <span className={qr.caption}>
                    <QalamAIGlyph size={12} /> What I took from your answers
                  </span>
                  <p className="text-caption leading-[18px] text-fg" dir="auto">
                    {b.analysis}
                  </p>
                </div>
              )}
            </div>
          ) : null,
        )}
        {asking && last >= 0 && <Round key={`${source.id}:${last}`} source={source} s={s} />}
        {busy && <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />}
        {!busy && s.phase === "failed" && s.failed && <ErrorNote message={s.failed.error === "Stopped." ? "You stopped Qalam AI before it finished." : `Qalam AI couldn't finish: ${s.failed.error}`} />}
        {!busy && s.phase === "ready" && (
          <p className="text-caption text-fg-muted">{s.skipped ? "Qalam AI places it with what you've answered so far." : "Qalam AI has what it needs. Nothing lands on the board until you accept it."}</p>
        )}
        {!busy && s.phase === "review" && <p className="text-caption text-fg-muted">Qalam AI&apos;s changes are on the board: accept or discard each under its card, or all of them from the top.</p>}
        {!busy && s.phase === "placed" && s.placed && <Placed s={s} />}
      </div>
      <footer className="flex h-[44px] shrink-0 items-center justify-end gap-[8px] border-t border-line-subtle pr-[8px] pl-[8px]">
        {busy ? (
          <Button size="sm" onClick={() => stopDump(source.id)}>
            <Square size={10} fill="currentColor" {...icon} /> Stop
          </Button>
        ) : s.phase === "failed" ? (
          <Button size="sm" onClick={() => retryDump(source.id)}>
            <RotateCcw size={12} {...icon} /> Try again
          </Button>
        ) : s.phase === "ready" ? (
          <Button size="sm" onClick={() => void placeDump(source.id)}>
            <QalamAIGlyph size={12} /> Place it on the board
          </Button>
        ) : s.phase === "asking" ? (
          <button type="button" className={qr.textBtn} onClick={() => void skipRest(source.id)}>
            Skip and place now
          </button>
        ) : (
          <Button size="sm" variant="secondary" onClick={closeBrainDump}>
            Done
          </Button>
        )}
      </footer>
    </>
  );
}

/** Qalam AI's pushback: what doesn't hold up, the builder's words it's about, and the card. */
function Pushback({ source, list }: { source: SourceRecord; list: DumpChallenge[] }) {
  const doc = useStudio((st) => st.doc);
  return (
    <section className="flex flex-col gap-[8px]" aria-label="Pushback">
      <span className="text-micro font-medium text-fg-subtle">Pushback</span>
      {list.map((c) => {
        const words = source.quotes.find((q) => q.id === c.quoteId);
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
              <button type="button" className="line-clamp-2 text-left text-micro text-fg-subtle hover:text-fg" dir="auto" title="Show in your text" onClick={() => openSource(source.id, words.id)}>
                Your words: “{words.text}”
              </button>
            )}
            {card && (
              <button type="button" onClick={() => showCard(c.cardId!)} className="q-item inline-flex h-[20px] max-w-full self-start items-center rounded-sm bg-active px-[6px] text-micro font-medium text-fg-muted hover:text-fg" title="Show the card">
                <span className="truncate">On “{card.title || "Untitled"}”</span>
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The round being asked. The sample's open questions come answered in the founder's words. */
function Round({ source, s }: { source: SourceRecord; s: DumpSession }) {
  const i = s.buckets.length - 1;
  const b = s.buckets[i];
  const questions = b.questions.map(toQuestion);
  const [form, setForm] = useState<FlowState>(() => {
    if (!s.sample) return b.form;
    const said = Object.fromEntries(b.questions.filter((q) => !q.options.length && SAMPLE_DUMP_ANSWERS[q.id] && !b.form.answers[q.id]).map((q) => [q.id, { kind: "text" as const, text: SAMPLE_DUMP_ANSWERS[q.id] }]));
    return { ...(b.form.visited.length ? b.form : initialFlow(questions)), answers: { ...b.form.answers, ...said } };
  });
  return (
    <Questionnaire
      title={i === 0 ? "Before Qalam AI places it" : `Round ${i + 1} of up to ${MAX_DUMP_ROUNDS}`}
      questions={questions}
      state={form}
      onChange={(f) => {
        setForm(f);
        saveRound(source.id, f);
      }}
      onSubmit={(f) => void answerRound(source.id, f)}
      review={{ submitLabel: "Send answers" }}
    />
  );
}

function Placed({ s }: { s: DumpSession }) {
  const c = s.placed!.counts;
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
  const said = [part(c.added, "card added", "cards added"), part(c.attached, "piece attached", "pieces attached"), part(c.edited, "card changed", "cards changed"), part(c.notes, "note", "notes")].filter(Boolean).join(" · ");
  return <p className="text-caption text-fg-muted tnum">{said ? `On the board: ${said}.` : "Nothing was accepted onto the board."}</p>;
}
