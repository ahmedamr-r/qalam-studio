import { Play, Waypoints } from "lucide-react";
import { playScreen, playableScreen } from "../prototype/store";
import { useKnowledge } from "@/knowledge/store";
import { openWhy, screenDecision } from "../knowledge/why";
import { useChats } from "./chats";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { ArrowUp, BookOpen, Check, ChevronDown, Lightbulb, Minus, RotateCcw, Square, TriangleAlert, Undo2, X } from "lucide-react";
import { useStudio, studio } from "@/doc/store";
import { onComponentsPage } from "@/doc/pages";
import { selectionBounds } from "@/doc/geometry";
import { isCovered, screenBriefFor } from "@/doc/brief";
import { useReservations } from "@/doc/reservations";
import type { GoalVerdict } from "@/doc/schema";
import { useVectorEdit } from "@/engine/vector-state";
import { useCommand } from "@/commands";
import { HEURISTIC_LABEL, MAX_QUESTIONS, type CritiqueIssue } from "@/ai/critique";
import { Button, IconBtn, Kbd, Tag, Tip } from "../controls";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { usePresence } from "../motion";
import { r } from "../recipes";
import { ErrorNote, Progress } from "./common";
import { placeCard, toScreenBox } from "./anchor";
import Reservations from "./Reservations";
import AgentCursors from "./AgentCursors";
import FlagTips from "../FlagTips";
import { useAgents } from "./agents";
import { useChatFrame } from "./chatFrame";
import { useProjectType } from "@/projects/mode";
import {
  answer,
  canFixIssue,
  closeCritique,
  conclude,
  critiqueAgain,
  fixAll,
  fixIssue,
  issueFixBusy,
  issueScreen,
  openIssues,
  retry,
  screensOf,
  setMinimised,
  skip,
  startCritique,
  stop,
  undoFix,
  undoIssueFix,
  useCritique,
  MAX_SCREENS,
  type CritiqueSession,
  type SessionIssue,
} from "./critiqueSession";

const CARD_W = 360;
const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * DOM layer over the canvas for AI work in progress, the critique pill and card, and lint mark
 * tooltips. Only the pill, card and tooltips take pointer events. It steps aside (100ms fade) while
 * a vector is being edited, so nothing covers the anchors.
 */
export default function CanvasOverlay() {
  // The Components page is documentation, not screens: no critique there.
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const screens = useProjectType() !== "discovery" && !onComponents;
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const vectorEditing = useVectorEdit((s) => !!s.nodeId);
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // Development only: drive the overlays from the console or a headless check.
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __qalamOverlay: unknown }).__qalamOverlay = { critique: useCritique, reservations: useReservations, agents: useAgents };
  }, []);
  return (
    <div
      ref={ref}
      data-hidden={vectorEditing || undefined}
      className="pointer-events-none absolute inset-0 z-[6] overflow-hidden transition-[opacity,visibility] duration-quick ease-out-quad data-[hidden]:invisible data-[hidden]:opacity-0"
    >
      {vp.w > 0 && (
        <>
          {!onComponents && <Reservations vp={vp} />}
          {!onComponents && <AgentCursors vp={vp} />}
          <FlagTips vp={vp} host={ref.current?.parentElement ?? null} />
          {/* Critique reviews screens: not on a Discovery board. */}
          {screens && <CritiquePill vp={vp} />}
          {screens && <CritiqueCard vp={vp} />}
        </>
      )}
    </div>
  );
}

const hover = (id: string | null) => studio().setHover(id || null);

// ---------------------------------------------------------------------------

/**
 * "Critique" above the top-right of selected screens. It pops in when screens are selected, fades
 * out (100ms) while they're dragged or another tool is on, and back in after a short pause so quick
 * nudges don't blink it. Positioned with a transform; never animated as it follows the selection.
 */
function CritiquePill({ vp }: { vp: { w: number; h: number } }) {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const cam = useStudio((s) => s.camera);
  const resting = useStudio((s) => !s.txBase && s.tool === "select" && !s.editingTextId);
  const session = useCritique((s) => s.session);
  // "Why this design?" follows the decisions recorded for the screen.
  useKnowledge((s) => s.traces);
  useChats((s) => s.chats);

  const ids = selection.filter((id) => doc.nodes[id]);
  if (!ids.length || !ids.every((id) => !doc.nodes[id].parentId && doc.nodes[id].type === "frame")) return null;
  const critiqued =
    !!session &&
    screensOf(doc, ids)
      .slice(0, MAX_SCREENS)
      .every((id) => session.screenIds.includes(id));
  const why = ids.length === 1 ? screenDecision(ids[0]) : null;
  // One screen (not a sheet or bar it opens): play it with everything it opens and shows.
  const play = ids.length === 1 && playableScreen(doc, ids[0]);
  if (critiqued && !why && !play) return null;
  const box = toScreenBox(selectionBounds(doc, ids)!, cam);
  if (box.x > vp.w || box.y > vp.h || box.x + box.w < 0 || box.y + box.h < 0) return null;
  const covered = ids.slice(0, MAX_SCREENS).every((id) => isCovered(screenBriefFor(doc.brief, doc, id)));
  const n = Math.min(ids.length, MAX_SCREENS);
  const label = covered ? "Verdict ready" : ids.length > MAX_SCREENS ? `Critique first ${MAX_SCREENS}` : n > 1 ? `Critique ${n} screens` : "Critique";
  const x = Math.round(Math.min(Math.max(box.x + box.w, 150), vp.w - 8));
  // Above the canvas's frame name label (18px), so the two never overlap.
  const y = Math.round(Math.max(8, Math.min(box.y - 54, vp.h - 36)));
  return (
    <div
      data-hidden={!resting || undefined}
      className="absolute top-0 left-0 z-[3] transition-opacity delay-[80ms] duration-fast ease-out-quad data-[hidden]:pointer-events-none data-[hidden]:opacity-0 data-[hidden]:delay-0 data-[hidden]:duration-quick data-[hidden]:ease-in-quad"
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <div className="flex -translate-x-full items-center gap-[6px]">
        {play && (
          <Tip label="Play this screen as a prototype, with what it opens and shows" side="top">
            <button
              key={`play:${ids[0]}`}
              type="button"
              data-state="open"
              onClick={() => playScreen(ids[0])}
              style={{ "--radix-popper-transform-origin": "100% 100%" } as CSSProperties}
              className={clsx(r.critiquePill, "q-item q-press pointer-events-auto whitespace-nowrap hover:bg-elevated")}
            >
              <Play size={14} absoluteStrokeWidth strokeWidth={1.25} aria-hidden /> Prototype
            </button>
          </Tip>
        )}
        {why && (
          <Tip label="What Qalam AI followed to make this, and how to fix it" side="top">
            <button
              key={`why:${ids[0]}`}
              type="button"
              data-state="open"
              onClick={() => openWhy(why.ref, why.at)}
              style={{ "--radix-popper-transform-origin": "100% 100%" } as CSSProperties}
              className={clsx(r.critiquePill, "q-item q-press pointer-events-auto whitespace-nowrap hover:bg-elevated")}
            >
              <Waypoints size={14} absoluteStrokeWidth strokeWidth={1.25} aria-hidden /> Why this design?
            </button>
          </Tip>
        )}
        {!critiqued && (
          <Tip label={covered ? "The Knowledge hub already covers this: get a verdict straight away" : "Qalam AI critique: design heuristics, then questions about the goal"} side="top">
            <button
              key={ids.join()}
              type="button"
              data-state="open"
              onClick={() => startCritique(ids)}
              style={{ "--radix-popper-transform-origin": "100% 100%" } as CSSProperties}
              className={clsx(r.critiquePill, "q-item q-press pointer-events-auto whitespace-nowrap hover:bg-elevated")}
            >
              <QalamAIGlyph size={14} /> {label}
            </button>
          </Tip>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const busy = (s: CritiqueSession) => s.status === "busy" || s.fix?.status === "running" || issueFixBusy(s);

function CritiqueCard({ vp }: { vp: { w: number; h: number } }) {
  const live = useCritique((s) => s.session);
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);
  const bottomInset = useChatFrame((s) => s.bottom);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [h, setH] = useState(360);
  // Closing or minimising plays the card out (100ms) from the session it last showed.
  const last = useRef<CritiqueSession | null>(null);
  if (live && !live.minimised) last.current = live;
  const card = usePresence<HTMLDivElement>(!!live && !live.minimised);
  const presenceRef = card.ref;
  const cardRef = useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      presenceRef(node);
    },
    [presenceRef],
  );
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const bubble = live?.minimised ? <Bubble s={live} vp={vp} /> : null;
  const session = card.mounted ? last.current : null;
  if (!session) return bubble;
  const screens = session.screenIds.filter((id) => doc.nodes[id]);
  const box = screens.length ? selectionBounds(doc, screens) : null;

  // Keep clear of the tool bar and the chat window at the bottom of the canvas.
  const area = { w: vp.w, h: vp.h - bottomInset };
  const pos = box ? placeCard(box, cam, area, { w: CARD_W, h }) : { left: vp.w - CARD_W - 8, top: 8, side: "right" as const };
  const names = session.screenIds.map((id) => doc.nodes[id]?.name ?? session.names[id]).join(", ");
  const running = busy(session);
  return (
    <>
      {bubble}
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Design critique"
        data-state={card.state}
        style={{ left: pos.left, top: pos.top, width: CARD_W, maxHeight: area.h - 16, "--radix-popper-transform-origin": pos.side === "right" ? "0 0" : "100% 0" } as CSSProperties}
        className={clsx(r.card, "q-pop absolute z-[3] flex flex-col overflow-hidden text-fg", card.state === "open" ? "pointer-events-auto" : "pointer-events-none")}
        // Keys typed here must not reach the canvas shortcuts (Backspace would delete the selection).
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[8px] pl-[14px]">
          <QalamAIGlyph size={16} done={session.status === "done" && !running} />
          <span className="shrink-0 text-body font-semibold">Critique</span>
          <span className="flex min-w-0 flex-1 items-center gap-[6px] text-caption font-medium text-fg-subtle" title={names}>
            <span className="text-fg-faint" aria-hidden>
              ·
            </span>
            <span className="truncate">{names}</span>
          </span>
          {session.sample && <Tag tone="warning">Sample</Tag>}
          <IconBtn size="sm" label="Minimise" onClick={() => setMinimised(true)}>
            <Minus size={14} {...icon} />
          </IconBtn>
          <IconBtn size="sm" label="Close critique" onClick={closeCritique}>
            <X size={14} {...icon} />
          </IconBtn>
        </header>
        <CardBody s={session} />
        <footer className="flex h-[44px] shrink-0 items-center justify-between gap-[8px] border-t border-line-subtle pr-[8px] pl-[8px]">
          <button
            type="button"
            onClick={() => studio().setLeftTab("knowledge")}
            className={clsx(r.buttonGhost, "q-press inline-flex h-[28px] items-center gap-[6px] rounded-md px-[8px] text-caption")}
          >
            <BookOpen size={14} {...icon} /> Saved to Knowledge hub
          </button>
          {running ? (
            <Button size="sm" onClick={stop}>
              <Square size={10} fill="currentColor" {...icon} /> Stop
            </Button>
          ) : canFix(session) ? (
            <Button size="sm" onClick={fixAll} title="Revise the screens to resolve every issue above that isn't fixed yet, in one undo step. Hand-drawn screens are rebuilt from catalog components.">
              <QalamAIGlyph size={12} /> {Object.values(session.issueFixes).some((f) => f.status === "done") ? "Fix the rest" : "Fix all"}
            </Button>
          ) : session.status === "done" && !session.fix ? (
            <Button size="sm" variant="secondary" onClick={closeCritique}>
              Done
            </Button>
          ) : null}
        </footer>
      </div>
    </>
  );
}

/** The minimised critique: a round bubble beside the screens, with the working ring while Qalam AI is busy and a dot when it has a question. */
function Bubble({ s: session, vp }: { s: CritiqueSession; vp: { w: number; h: number } }) {
  const doc = useStudio((st) => st.doc);
  const cam = useStudio((st) => st.camera);
  const screens = session.screenIds.filter((id) => doc.nodes[id]);
  const box = screens.length ? selectionBounds(doc, screens) : null;
  const s = box ? toScreenBox(box, cam) : { x: vp.w - 48, y: 8, w: 0, h: 0 };
  const running = busy(session);
  return (
    <div
      className="absolute top-0 left-0 z-[3]"
      style={{ transform: `translate(${Math.round(Math.max(8, Math.min(s.x + s.w + 10, vp.w - 40)))}px, ${Math.round(Math.max(8, Math.min(s.y, vp.h - 40)))}px)` }}
    >
      <Tip label={session.status === "asking" ? "Qalam AI has a question" : running ? "Qalam AI is critiquing" : "Show critique"} side="right">
        <button
          type="button"
          aria-label="Show critique"
          onClick={() => setMinimised(false)}
          data-busy={running || undefined}
          className="q-ai-ring q-item q-press pointer-events-auto grid size-[32px] place-items-center rounded-full rounded-bl-sm bg-raised shadow-floating hover:bg-elevated motion-safe:animate-[q-pop-in_var(--dur-spring-bouncy)_var(--ease-spring-bouncy)_both] motion-safe:[--motion-pop-scale:0.6]"
        >
          <QalamAIGlyph size={16} done={session.status === "done" && !running} />
          {session.status === "asking" && <span className="absolute -top-[2px] -right-[2px] size-[10px] rounded-full bg-fg shadow-[0_0_0_2px_var(--color-canvas)]" aria-label="Has a question" />}
        </button>
      </Tip>
    </div>
  );
}

function CardBody({ s }: { s: CritiqueSession }) {
  const [allIssues, setAllIssues] = useState(false);
  const firstTurn = !s.transcript.length && !s.issues.length;
  const shown = allIssues ? s.issues : s.issues.slice(0, 3);
  return (
    <div className="flex min-h-0 flex-col gap-[14px] overflow-y-auto p-[14px]">
      {s.sample && (
        <p className="flex gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-warning">
          <TriangleAlert size={14} {...icon} className="mt-[1px] shrink-0" />
          <span>Qalam AI isn&apos;t configured, so this is a recorded critique of the “Order tracking · Map first” demo screen.</span>
        </p>
      )}
      {(s.dropped > 0 || s.outlineOnly > 0) && (
        <p className="text-caption text-fg-subtle">
          {s.dropped > 0 && `Critiquing the first ${s.screenIds.length} of ${s.screenIds.length + s.dropped} selected screens. `}
          {s.outlineOnly > 0 && `${s.outlineOnly} screen${s.outlineOnly > 1 ? "s" : ""} sent as structure only (image size limit).`}
        </p>
      )}
      {s.status === "busy" && firstTurn && (
        <Progress tokens={s.tokens} started={s.busySince} label={s.activity ?? `Reviewing ${s.screenIds.length > 1 ? `${s.screenIds.length} screens` : "the screen"}…`} />
      )}

      {s.summary && <p className="text-body leading-[20px] text-fg">{s.summary}</p>}

      {s.issues.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-baseline justify-between gap-[8px]">
            <span className="text-caption font-semibold text-fg">
              Heuristic issues <span className="font-normal text-fg-subtle tnum">· {s.issues.length}</span>
            </span>
            <span className="text-caption text-fg-subtle tnum">{severityCounts(s.issues)}</span>
          </div>
          {shown.map((i) => (
            <IssueRow key={i.id} s={s} i={i} />
          ))}
          {s.issues.length > 3 && (
            <button
              type="button"
              aria-expanded={allIssues}
              onClick={() => setAllIssues(!allIssues)}
              className={clsx(r.buttonGhost, "q-press -ml-[6px] inline-flex h-[24px] items-center gap-[4px] self-start rounded-md px-[6px] text-caption")}
            >
              <ChevronDown size={12} {...icon} className="q-chevron" /> {allIssues ? "Show fewer" : `Show all ${s.issues.length}`}
            </button>
          )}
        </div>
      )}

      {s.transcript.length > 0 && (
        <div className="flex flex-col gap-[10px] border-t border-line-subtle pt-[14px]">
          {s.transcript.map((t, k) => (
            <div key={k} className="text-caption">
              <div className="text-fg-subtle" dir="auto">
                {t.question}
              </div>
              {t.answer === null ? (
                <div className="mt-[2px] text-fg-subtle italic">Skipped</div>
              ) : (
                <div className="mt-[2px] font-medium text-fg" dir="auto">
                  {t.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {s.status === "busy" && !firstTurn && <Progress tokens={s.tokens} started={s.busySince} label={s.concluding ? "Weighing the verdict…" : "Thinking about your answer…"} />}
      {s.status === "error" && (
        <div className="flex flex-col gap-[8px]">
          <ErrorNote message={s.error ?? "Something went wrong."} />
          <Button size="sm" variant="secondary" className="self-start" onClick={retry}>
            <RotateCcw size={12} {...icon} /> Retry
          </Button>
        </div>
      )}

      {s.fix ? (
        <FixBlock s={s} />
      ) : (
        <>
          {s.status === "asking" && s.question && <QuestionBlock s={s} />}
          {s.goalFit && (s.status === "done" || s.goalFit.verdict !== "unknown") && <VerdictBlock s={s} final={s.status === "done"} />}
        </>
      )}
    </div>
  );
}

/** "1 critical · 2 major · 3 minor", leaving out severities with none. */
function severityCounts(issues: SessionIssue[]): string {
  return (["critical", "major", "minor"] as const)
    .map((sev) => [sev, issues.filter((i) => i.severity === sev).length] as const)
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev}`)
    .join(" · ");
}

/** Severity on the shared Tag tones (warning and danger carry their icon). */
function Severity({ s }: { s: CritiqueIssue["severity"] }) {
  return <Tag tone={s === "critical" ? "danger" : s === "major" ? "warning" : "neutral"}>{s === "critical" ? "Critical" : s === "major" ? "Major" : "Minor"}</Tag>;
}

function IssueRow({ s, i }: { s: CritiqueSession; i: SessionIssue }) {
  const doc = useStudio((st) => st.doc);
  const f = s.issueFixes[i.id];
  const done = f?.status === "done";
  // A fix rebuilds the screen's layers, so the layer may be gone: fall back to the screen.
  const target = [i.nodeId, i.screenId].find((id) => id && doc.nodes[id]) ?? "";
  return (
    <div
      onMouseEnter={() => target && hover(target)}
      onMouseLeave={() => hover(null)}
      className={clsx(
        "flex flex-col gap-[8px] rounded-lg p-[10px] transition-[box-shadow,background-color] duration-fast ease-out-quad hover:duration-0",
        done ? "bg-success-subtle" : "shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line)]",
      )}
    >
      <div className="flex min-h-[24px] items-center gap-[8px]">
        <Severity s={i.severity} />
        <span className="min-w-0 flex-1 truncate text-caption text-fg-subtle">{HEURISTIC_LABEL[i.heuristic] ?? i.heuristic}</span>
        <IssueFixControl s={s} i={i} />
      </div>
      <button
        type="button"
        disabled={!target}
        onClick={() => studio().select([target])}
        className={clsx("rounded-sm text-left text-body leading-[20px]", done ? "text-fg-muted" : "text-fg")}
        dir="auto"
      >
        {i.issue}
      </button>
      {done ? (
        <div className="flex flex-col gap-[4px] rounded-md bg-field px-[10px] py-[8px] text-caption text-fg">
          {f.changes.length ? (
            f.changes.map((c, k) => (
              <div key={k} className="flex gap-[6px]" dir="auto">
                <Check size={14} {...icon} className="mt-[1px] shrink-0 text-success" />
                <span>{c}</span>
              </div>
            ))
          ) : (
            <span className="text-fg-muted">Revised without listing its changes.</span>
          )}
          {f.rebuilt && <span className="text-fg-muted">The screen was drawn by hand, so it was rebuilt from catalog components.</span>}
        </div>
      ) : (
        i.fix && (
          <div className="flex gap-[8px] rounded-md bg-field px-[10px] py-[8px] text-caption text-fg-muted" dir="auto">
            <Lightbulb size={14} {...icon} className="mt-[1px] shrink-0 text-fg-subtle" />
            <span>{i.fix}</span>
          </div>
        )
      )}
      {f?.status === "error" && <ErrorNote message={f.error ?? "The fix didn't go through."} />}
    </div>
  );
}

/** The right side of an issue's header: its Fix button, or where its fix is. */
function IssueFixControl({ s, i }: { s: CritiqueSession; i: SessionIssue }) {
  const f = s.issueFixes[i.id];
  const canUndo = useStudio((st) => f?.status === "done" && st.past.length === f.pastLen);
  const handDrawn = useStudio((st) => !st.doc.nodes[issueScreen(s, i)]?.meta.spec);
  if (f?.status === "queued") return <span className="shrink-0 text-caption text-fg-subtle">Waiting…</span>;
  if (f?.status === "running")
    return (
      <span className="flex shrink-0 items-center gap-[6px] text-caption font-medium" role="status">
        <QalamAIGlyph size={12} /> <span className="q-shimmer-text">Fixing…</span>
      </span>
    );
  if (f?.status === "done")
    return (
      <span className="flex shrink-0 items-center gap-[6px]">
        <span className="flex items-center gap-[4px] text-caption font-medium text-success">
          <Check size={14} {...icon} /> Fixed
        </span>
        {f.sample && <Tag tone="warning">Sample</Tag>}
        {canUndo && (
          <Button size="sm" variant="ghost" onClick={() => undoIssueFix(i.id)}>
            <Undo2 size={12} {...icon} /> Undo
          </Button>
        )}
      </span>
    );
  if (!canFixIssue(s, i)) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => fixIssue(i.id)}
      title={`Revise the screen to fix just this issue, in one undo step.${handDrawn ? " It was drawn by hand, so it will be rebuilt from catalog components." : ""}`}
    >
      {f?.status === "error" ? <RotateCcw size={12} {...icon} /> : <QalamAIGlyph size={12} />} {f?.status === "error" ? "Retry" : "Fix"}
    </Button>
  );
}

/** Qalam AI's question, in the AI card language the chat's questionnaire uses: glyph and step, the question, quick answers, free text. */
function QuestionBlock({ s }: { s: CritiqueSession }) {
  const q = s.question!;
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText("");
    // Keep typing flow if the designer was already in the card; never steal focus from the canvas.
    if (box.current?.closest("[role=dialog]")?.contains(document.activeElement)) input.current?.focus({ preventScroll: true });
  }, [q.text]);
  const send = () => text.trim() && answer(text);
  return (
    <div ref={box} className="q-rise flex flex-col gap-[10px] rounded-lg bg-ai-subtle p-[12px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ai)_18%,transparent)]">
      <div className="flex items-center gap-[6px] text-micro font-medium text-ai tnum">
        <QalamAIGlyph size={12} /> Question {s.transcript.length + 1} of {MAX_QUESTIONS}
      </div>
      <p className="text-body leading-[20px] font-medium text-fg" dir="auto">
        {q.text}
      </p>
      {q.why && (
        <p className="-mt-[4px] text-caption text-fg-muted" dir="auto">
          {q.why}
        </p>
      )}
      {q.options.length > 0 && (
        <div key={q.text} className="q-stagger flex flex-wrap gap-[6px]">
          {q.options.map((o, k) => (
            <button
              key={o}
              type="button"
              onClick={() => answer(o)}
              style={{ "--i": k } as CSSProperties}
              className="q-item q-press h-[28px] rounded-md bg-raised px-[10px] text-caption font-medium text-fg shadow-button hover:bg-elevated light:hover:bg-muted"
              dir="auto"
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <textarea
          ref={input}
          rows={2}
          dir="auto"
          value={text}
          placeholder="Or type your answer…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="ds-textarea block w-full resize-none pr-[38px] placeholder:text-fg-faint"
        />
        <button
          type="button"
          aria-label="Send answer"
          disabled={!text.trim()}
          onClick={send}
          className="q-press q-press-icon absolute right-[6px] bottom-[6px] grid size-[24px] place-items-center rounded-md bg-inverse text-fg-inverse shadow-button-invert transition-[opacity,scale,background-color] duration-fast hover:bg-inverse/90 disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowUp size={14} {...icon} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" className="-ml-[4px]" onClick={skip}>
          Skip
        </Button>
        <Button size="sm" variant="secondary" onClick={conclude}>
          Give me the verdict
        </Button>
      </div>
    </div>
  );
}

const VERDICT: Record<GoalVerdict, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  meets: { label: "Meets the goal", tone: "success" },
  partially: { label: "Partially meets the goal", tone: "warning" },
  misses: { label: "Misses the goal", tone: "danger" },
  unknown: { label: "Not enough context yet", tone: "neutral" },
};

function VerdictBlock({ s, final }: { s: CritiqueSession; final: boolean }) {
  const g = s.goalFit!;
  const v = VERDICT[g.verdict] ?? VERDICT.unknown;
  if (!final)
    return (
      <p className="text-caption text-fg-subtle">
        Current read: <span className="font-medium text-fg-muted">{v.label.toLowerCase()}</span> · {g.confidence} confidence
      </p>
    );
  return (
    <div className="q-rise flex flex-col gap-[10px] border-t border-line-subtle pt-[14px]">
      <div className="flex items-center gap-[8px]">
        <Tag tone={v.tone}>{v.label}</Tag>
        <span className="text-caption text-fg-subtle">{g.confidence} confidence</span>
      </div>
      {g.rationale && <p className="text-body leading-[20px] text-fg">{g.rationale}</p>}
      {g.mustChange.length > 0 && (
        <div className="flex flex-col gap-[2px]">
          <div className="pb-[4px] text-caption font-semibold text-fg">To meet the goal</div>
          {g.mustChange.map((m, k) => (
            <button
              key={k}
              type="button"
              onMouseEnter={() => hover(m.nodeId)}
              onMouseLeave={() => hover(null)}
              onClick={() => m.nodeId && studio().select([m.nodeId])}
              className={clsx("-mx-[6px] flex gap-[8px] rounded-md px-[6px] py-[4px] text-left text-caption text-fg", m.nodeId ? "q-item hover:bg-hover" : "cursor-default")}
            >
              <span className="w-[12px] shrink-0 text-fg-subtle tnum">{k + 1}</span>
              <span dir="auto">{m.change}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Something is left to fix, and no fix is running or applied. */
function canFix(s: CritiqueSession): boolean {
  if (s.fix && s.fix.status !== "error" && s.fix.status !== "undone") return false;
  if (issueFixBusy(s)) return false;
  const must = s.goalFit?.verdict === "meets" ? 0 : (s.goalFit?.mustChange.length ?? 0);
  return openIssues(s).length + must > 0;
}

function FixBlock({ s }: { s: CritiqueSession }) {
  const f = s.fix!;
  const canUndo = useStudio((st) => st.past.length === f.pastLen);
  const undoKeys = useCommand("edit.undo")?.keys[0];
  const multi = s.screenIds.length > 1;
  if (f.status === "running") return <Progress tokens={f.tokens} started={f.started} label={`Fixing ${multi ? `${s.screenIds.length} screens` : "the screen"}…`} />;
  if (f.status === "error")
    return (
      <div className="flex flex-col gap-[8px] border-t border-line-subtle pt-[12px]">
        <ErrorNote message={f.error ?? "The fix didn't go through."} />
      </div>
    );
  if (f.status === "undone") return <p className="border-t border-line-subtle pt-[12px] text-caption text-fg-subtle">Fix undone. The screens are back to how they were.</p>;
  return (
    <div className="q-rise flex flex-col gap-[8px] rounded-lg bg-success-subtle p-[12px]">
      <div className="flex items-center gap-[6px] text-body font-semibold text-success">
        <Check size={14} {...icon} /> Fixed {multi ? `${s.screenIds.length - f.failed.length} screens` : "the screen"} · <span className="tnum">{f.changes.length}</span> change
        {f.changes.length === 1 ? "" : "s"}
        {f.sample && <Tag tone="warning">Sample</Tag>}
      </div>
      {f.changes.length > 0 && (
        <ul className="flex flex-col gap-[4px] text-caption text-fg">
          {f.changes.map((c, k) => (
            <li key={k} className="flex gap-[8px]" dir="auto">
              <span className="mt-[6px] size-[4px] shrink-0 rotate-45 rounded-[1px] bg-fg-subtle" aria-hidden />
              <span>
                {multi && <span className="font-medium">{c.screen}: </span>}
                {c.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
      {f.rebuilt.length > 0 && (
        <p className="text-caption text-fg-muted">
          {f.rebuilt.join(", ")} {f.rebuilt.length > 1 ? "were" : "was"} drawn by hand, so {f.rebuilt.length > 1 ? "they were" : "it was"} rebuilt from catalog components.
        </p>
      )}
      {f.failed.length > 0 && (
        <p className="flex gap-[6px] text-caption text-danger">
          <TriangleAlert size={14} {...icon} className="mt-[1px] shrink-0" />
          <span>
            Couldn&apos;t fix {f.failed.join(", ")}
            {f.error ? `: ${f.error}` : "."}
          </span>
        </p>
      )}
      <div className="flex items-center justify-between gap-[8px] pt-[2px]">
        <Button size="sm" variant="ghost" className="-ml-[4px]" disabled={!canUndo} onClick={undoFix}>
          <Undo2 size={12} {...icon} /> Undo fix
        </Button>
        <Button size="sm" variant="secondary" onClick={critiqueAgain}>
          <QalamAIGlyph size={12} /> Critique again
        </Button>
      </div>
      {!canUndo && (
        <p className="flex flex-wrap items-center gap-[4px] text-micro text-fg-subtle">
          You&apos;ve edited since the fix; step back through it with {undoKeys ? <Kbd keys={undoKeys} size="sm" /> : "Undo"}
        </p>
      )}
    </div>
  );
}
