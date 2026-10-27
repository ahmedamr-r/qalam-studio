import { WhyLink } from "../knowledge/why";
import { useEffect, useState, type ComponentType } from "react";
import clsx from "clsx";
import {
  ArrowLeftRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Component,
  Download,
  FileSearch,
  Info,
  Link2,
  Merge,
  MessageCircleQuestion,
  Network,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  SwatchBook,
  TriangleAlert,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { revealLayers } from "../pages";
import { descendants, topFrameOf } from "@/doc/geometry";
import { contrastRatio, normalizeHex } from "@/design-system/resolve";
import { PLATFORMS } from "@/design-system/platform";
import { runCommand, useCommand } from "@/commands/registry";
import type { Suggestion } from "@/ai/schemas";
import type { Category, Finding } from "@/lint/rules";
import { assetURL } from "@/doc/assets";
import { Button, CommandKbd, Swatch, Tag } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { getController } from "../CanvasView";
import { download } from "../exporter";
import { ErrorNote, Progress } from "./common";
import { GenerateSteps, StatusLine } from "./AgentTurn";
import { MadeComponents } from "./MadeComponents";
import { LookCard } from "./LookCard";
import { clearDecisions, loadDecisions, saveDecisions, type DetectiveRow } from "./aiStore";
import { addDetectiveTokens, applySample, fixFindings, isLiveCritique, retry, updateDetectiveRows } from "./chats";
import { showCard } from "./critiqueSession";
import { DirectionView } from "./DirectionTool";
import { TuneView } from "./TuneTool";
import { ExtractView, ShotStrip } from "./ExtractTool";
import { ComponentView } from "./ComponentTool";
import { ResearchView } from "./ResearchView";
import { PlanView } from "./PlanTool";
import { PrototypeAsks } from "../prototype/PrototypeAsks";
import { connectorLabels, useAvailableConnectors } from "./connectors";
import { TOOL_LABEL, type AuditOutcome, type ChatTool, type ChatTurn, type CritiqueOutcome, type DetectiveOutcome, type GenerateOutcome } from "./chatTypes";
import DiscoveryTurnView from "../discovery/DiscoveryTurn";

export type ToolIcon = ComponentType<{ size?: number; className?: string }>;

/** A lucide icon on the 1.25px grid. */
const lucide = (Icon: LucideIcon): ToolIcon =>
  function ToolGlyph({ size = 14, className }) {
    return <Icon size={size} absoluteStrokeWidth strokeWidth={1.25} className={className} />;
  };

/** Generate is Qalam AI's own act: the pencil and its nuqta, never a sparkle. */
function GenerateGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return <QalamAIGlyph size={size >= 18 ? 18 : size >= 16 ? 16 : size >= 14 ? 14 : 12} className={className} />;
}

export const TOOL_ICON: Record<ChatTool, ToolIcon> = {
  generate: GenerateGlyph,
  critique: lucide(MessageCircleQuestion),
  detective: lucide(FileSearch),
  audit: lucide(ShieldCheck),
  direction: lucide(ArrowLeftRight),
  tune: lucide(SlidersHorizontal),
  extract: lucide(SwatchBook),
  discovery: lucide(Network),
  component: lucide(Component),
};

const RUNNING_LABEL: Record<ChatTool, string> = {
  generate: "Composing layouts…",
  critique: "Thinking…",
  detective: "Detecting intent…",
  audit: "Reviewing the screens…",
  direction: "Switching direction…",
  tune: "Diagnosing the design system…",
  extract: "Looking at your screenshots…",
  discovery: "Drafting the tree…",
  component: "Reading the component…",
};

/** Tools whose view shows their own progress, errors and model (they run in phases). */
const OWN_STATUS: ChatTool[] = ["critique", "extract"];

const LANG_LABEL = { en: "English", ar: "Arabic", both: "EN + AR" } as const;

/** A card inside a turn: hairline, no fill. */
const cardBox = "rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
/** A filled note inside a turn (summaries, samples, what was added). */
const noteBox = "rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
/** Something applied or saved. */
const doneBox = "flex items-start gap-[8px] rounded-lg bg-success-subtle px-[10px] py-[8px] text-caption text-fg [&>svg]:mt-[2px] [&>svg]:shrink-0 [&>svg]:text-success";
/** Something to look at (with its icon: colour is never the only signal). */
const warnBox = "flex items-start gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-fg [&>svg]:mt-[2px] [&>svg]:shrink-0 [&>svg]:text-warning";
const linkBtn = clsx(r.link, "self-start text-caption font-medium");

function focusNode(id: string) {
  const { doc } = studio();
  if (!id || !doc.nodes[id]) return;
  // On whichever page it is.
  if (revealLayers([id], { glide: false })) getController()?.zoomToFit([topFrameOf(studio().doc, id)]);
}

/**
 * One request and Qalam AI's answer: the request as a bubble on the right, the answer beside the
 * Qalam AI glyph. The glyph's hollow nuqta fills when a run watched in this session completes.
 * `fresh` = the turn was added while the chat was open (it rises in; older turns just appear).
 */
export function TurnView({ chatId, t, fresh }: { chatId: string; t: ChatTurn; fresh?: boolean }) {
  const own = OWN_STATUS.includes(t.tool);
  // Watched live: mounted while running (a new request, or a chat opened mid-run).
  const [live] = useState(t.status === "running");
  return (
    <div id={`turn-${t.id}`} className={clsx("flex scroll-mt-[16px] flex-col gap-[10px]", fresh && "q-rise")}>
      <RequestBubble t={t} />
      <div className="flex items-start gap-[10px]">
        <QalamAIGlyph size={16} done={t.status !== "running"} className={clsx("mt-[2px] shrink-0", !live && "[&_.q-nuqta-hole]:[animation:none]")} />
        <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
          {t.tool === "generate" && t.plan && <PlanView chatId={chatId} t={t} />}
          {t.tool === "generate" && <GenerateSteps t={t} live={live} />}
          {t.status === "running" && !own && <StatusLine chatId={chatId} t={t} fallback={t.tool === "audit" && t.outcome ? "Reviewing the findings…" : RUNNING_LABEL[t.tool]} />}
          {t.status === "error" && !own && (
            <div className="flex flex-col gap-[6px]">
              <ErrorNote message={t.error ?? "Something went wrong."} onSample={t.tool === "generate" || (t.tool === "detective" && t.request.source?.mode !== "image") ? () => void applySample(chatId, t.id) : undefined} />
              <Button size="sm" variant="secondary" className="self-start" onClick={() => retry(chatId, t.id)}>
                <RotateCcw size={12} absoluteStrokeWidth strokeWidth={1.25} /> Try again
              </Button>
            </div>
          )}
          {t.status === "stopped" && !own && (
            <div className="flex items-center gap-[8px] text-caption text-fg-subtle">
              Stopped.
              <button type="button" className={linkBtn} onClick={() => retry(chatId, t.id)}>
                Run again
              </button>
            </div>
          )}
          {t.research && <ResearchView r={t.research} />}
          {t.outcome?.kind === "generate" && <GenerateView chatId={chatId} t={t} o={t.outcome} live={live} />}
          {t.outcome?.kind === "detective" && <DetectiveView chatId={chatId} turnId={t.id} o={t.outcome} sample={!!t.sample} systemName={t.request.system?.name} onRerun={() => retry(chatId, t.id)} />}
          {t.outcome?.kind === "audit" && <AuditView chatId={chatId} t={t} o={t.outcome} />}
          {t.outcome?.kind === "critique" && <CritiqueView t={t} o={t.outcome} />}
          {t.outcome?.kind === "direction" && <DirectionView o={t.outcome} onReview={() => studio().setAITab("audit")} />}
          {t.outcome?.kind === "tune" && <TuneView chatId={chatId} t={t} o={t.outcome} sample={!!t.sample} />}
          {t.tool === "extract" && <ExtractView chatId={chatId} t={t} />}
          {t.outcome?.kind === "discovery" && <DiscoveryTurnView t={t} o={t.outcome} />}
          {t.outcome?.kind === "component" && <ComponentView chatId={chatId} t={t} o={t.outcome} />}
          {t.status === "done" && t.model && !own && <div className="font-mono text-micro text-fg-subtle">{t.model}</div>}
          <WhyLink t={t} />
        </div>
      </div>
    </div>
  );
}

function RequestBubble({ t }: { t: ChatTurn }) {
  const connectors = useAvailableConnectors();
  const Icon = TOOL_ICON[t.tool];
  const q = t.request;
  const meta: string[] = [];
  if (q.plan) meta.push("Plan first");
  if (q.platform && !(t.plan && !t.plan.platformFixed && t.plan.phase !== "ready" && t.plan.phase !== "skipped")) meta.push(PLATFORMS[q.platform].label);
  if (q.lang) meta.push(LANG_LABEL[q.lang]);
  if (q.system) meta.push(q.system.name);
  if (q.revise) meta.push(`changes ${q.revise.name}`);
  if (q.section) meta.push(`only ${q.section.names.join(", ")} in ${q.section.name}`);
  else if (q.screens?.length) meta.push(q.screens.map((s) => s.name).join(", "));
  if (t.tool === "extract" && q.source) meta.push(q.source.sample ? "Sample screenshot" : `${q.source.count} screenshot${q.source.count > 1 ? "s" : ""}`);
  const lookups = connectorLabels(q.connectors, connectors);
  if (lookups.length) meta.push(`with ${lookups.join(" + ")}`);
  else if (t.tool === "audit") meta.push("All screens");
  const src = q.source;
  return (
    <div className={clsx(r.chatUser, "flex max-w-[min(440px,88%)] flex-col gap-[4px]")}>
      <div className="flex min-w-0 items-center gap-[6px] text-micro font-medium text-fg-subtle">
        <Icon size={12} className="shrink-0" />
        <span className="shrink-0 text-fg-muted">{TOOL_LABEL[t.tool]}</span>
        {meta.length > 0 && <span className="truncate font-normal">· {meta.join(" · ")}</span>}
      </div>
      {src?.images && t.tool === "extract" ? <ShotStrip refs={src.images} /> : src?.mode === "image" && src.image && <AssetThumb src={src.image} />}
      {src && src.mode !== "image" ? (
        <div className="flex flex-col gap-[2px]">
          <span className="text-caption font-medium tnum">
            {src.mode === "json" ? "Token JSON" : "CSS"} · {src.count} raw values
          </span>
          <pre className="max-h-[64px] overflow-hidden font-mono text-micro whitespace-pre-wrap text-fg-subtle">{q.text.slice(0, 240)}</pre>
        </div>
      ) : (
        q.text &&
        !(src?.mode === "image" && q.text === "Screenshot") && (
          <p className="text-body leading-[20px] whitespace-pre-wrap text-fg" dir="auto">
            {q.text}
          </p>
        )
      )}
    </div>
  );
}

function AssetThumb({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // assetURL caches its object URLs, so they aren't revoked here.
    let live = true;
    void assetURL(src).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  return url ? <img src={url} alt="Attached screenshot" className="max-h-[160px] self-start rounded-md bg-stage object-contain" /> : <div className="q-skeleton h-[64px] w-[48px] rounded-md" />;
}

// ---------------------------------------------------------------------------
// Generate

function GenerateView({ chatId, t, o, live }: { chatId: string; t: ChatTurn; o: GenerateOutcome; live: boolean }) {
  const doc = useStudio((s) => s.doc);
  const undoKeys = useCommand("edit.undo")?.keys[0]?.join("");
  const sample = !!t.sample;
  // Undo is offered while the canvas is exactly as this run left it (⌘Z then undoes the run's last step).
  const [after, setAfter] = useState<unknown>(null);
  useEffect(() => {
    if (live && t.status === "done") setAfter(studio().doc);
  }, [live, t.status]);
  const live_ = o.frameIds.filter((id) => doc.nodes[id]);
  return (
    <div className="flex flex-col gap-[10px]">
      {sample && (
        <span className="self-start">
          <Tag tone="neutral">Recorded sample · Food order tracking</Tag>
        </span>
      )}
      <p className="text-body leading-[20px] text-fg-muted">
        {o.section ? (
          <>
            Changed only <b className="font-medium text-fg">{o.section.names.join(", ")}</b>; the rest of the screen is as it was.
            {o.lostEdits && ` The change reshaped the screen, so it was rebuilt from its spec and your hand edits to it were undone${undoKeys ? ` (${undoKeys} brings them back)` : ""}.`}
          </>
        ) : (
          <>
            {o.partial ? "Stopped early: kept what was built so far. " : ""}
            {o.frameIds.length === 1 ? "Placed 1 screen on the canvas." : o.frameIds.length ? `Placed ${o.frameIds.length} screens on the canvas.` : "No screens to change: what you asked for happens on the screen."}
          </>
        )}
      </p>
      {o.look && <LookCard look={o.look} />}
      {o.repair && <SelfCheck r={o.repair} />}
      <div className={r.chatDiff}>
        {o.frameIds.map((id, i) => {
          const n = doc.nodes[id];
          const v = o.variants[i];
          if (!n)
            return (
              <div key={id} className="flex h-[24px] items-center gap-[8px] text-fg-subtle">
                <span className="w-[10px] font-mono text-micro">−</span>
                <span className="truncate line-through">{v?.name ?? "Screen"}</span>
                <span className="ml-auto text-micro">Deleted from the canvas</span>
              </div>
            );
          const ids = [id, ...descendants(doc, id)];
          const flags = ids.flatMap((x) => doc.nodes[x]?.meta.flags ?? []);
          const errors = flags.filter((f) => f.severity === "error").length;
          const warnings = flags.filter((f) => f.severity === "warning").length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => revealLayers([id])}
              className="q-item group/screen -mx-[4px] flex h-[26px] items-center gap-[8px] rounded-md px-[4px] text-left hover:bg-hover"
            >
              <span className="w-[10px] font-mono text-micro text-success">+</span>
              <span className="min-w-0 truncate text-fg" dir="auto">
                {n.name}
              </span>
              {v?.dir === "rtl" && <span className={r.chip}>RTL</span>}
              <span className="ml-auto flex shrink-0 items-center gap-[4px]">
                {errors > 0 && <Tag tone="danger">{errors} error{errors > 1 ? "s" : ""}</Tag>}
                {warnings > 0 && <Tag tone="warning">{warnings} warning{warnings > 1 ? "s" : ""}</Tag>}
                {!errors && !warnings && <Tag tone="success" icon={<Check size={12} strokeWidth={2} />}>System-clean</Tag>}
                <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-fg-faint group-hover/screen:text-fg-subtle" />
              </span>
            </button>
          );
        })}
      </div>
      {live_.length > 0 && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => revealLayers(live_)}
          >
            Review
          </Button>
          {after !== null && after === doc && (
            <Button size="sm" variant="ghost" className="gap-[6px] pr-[4px]" onClick={() => runCommand("edit.undo", "toolbar")}>
              Undo <CommandKbd command="edit.undo" size="sm" />
            </Button>
          )}
          <button
            type="button"
            className="q-item ml-auto inline-flex h-[24px] items-center gap-[6px] rounded-md px-[6px] text-caption text-fg-subtle hover:bg-hover hover:text-fg"
            title="Select these screens and tell Qalam AI what to change in the design system, so the next screens come out better"
            onClick={() => {
              // Keep one or two of these screens the designer picked (not the whole set selected on
              // arrival), else take the first one.
              const s = studio();
              const mine = new Set(s.selection.map((id) => topFrameOf(s.doc, id)).filter((id) => live_.includes(id)));
              if (!mine.size || mine.size > 2) revealLayers([live_[0]]);
              s.setAITab("tune");
            }}
          >
            <SlidersHorizontal size={12} absoluteStrokeWidth strokeWidth={1.25} /> Not right? Tune the system
          </button>
        </div>
      )}
      <MadeComponents chatId={chatId} turnId={t.id} o={o} />
      <PrototypeAsks screens={o.frameIds.length ? o.frameIds : (t.request.screens ?? []).map((s) => s.id)} />
      {o.offSystem.length > 0 && (
        <>
          <div className={clsx(r.eyebrow, "mt-[2px] flex items-center gap-[6px]")}>
            <TriangleAlert size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-warning" /> Not in the system → DS backlog
          </div>
          {o.offSystem.map((x, i) => (
            <div key={i} className={clsx(noteBox, "flex flex-col gap-[2px]")}>
              <div className="font-medium text-fg">{x.need}</div>
              <div>Used: {x.workaround}</div>
              <div className="text-fg">
                <span className="text-fg-subtle">Proposal: </span>
                {x.proposal}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** What the self-check found in the generated screens and what the repair pass changed. */
function SelfCheck({ r: rep }: { r: NonNullable<GenerateOutcome["repair"]> }) {
  const system = rep.system ? (
    <p className="text-caption text-fg-muted">
      {rep.system} issue{rep.system === 1 ? " comes" : "s come"} from the design system (its tokens or how it builds components, e.g. icon colours below 3:1 or targets under 44px), not from these screens: use <span className="font-medium text-fg">Tune the system</span> below to fix {rep.system === 1 ? "it" : "them"} for every screen.
    </p>
  ) : null;
  if (rep.error)
    return (
      <div className={warnBox}>
        <TriangleAlert size={14} absoluteStrokeWidth strokeWidth={1.25} />
        <span>The self-check couldn&apos;t fix the screens ({rep.error}). They&apos;re as generated; the flags on each screen show what&apos;s off.</span>
      </div>
    );
  if (!rep.found)
    return (
      <div className="flex flex-col gap-[4px]">
        <div className="flex items-center gap-[6px] text-caption text-fg-muted">
          <ShieldCheck size={14} absoluteStrokeWidth strokeWidth={1.25} className="text-success" /> Self-check: nothing to fix in the screens.
        </div>
        {system}
      </div>
    );
  const fixed = Math.max(0, rep.found - rep.remaining);
  return (
    <details className={clsx(noteBox, "group/check")}>
      <summary className="flex cursor-pointer list-none items-center gap-[6px] font-medium text-fg [&::-webkit-details-marker]:hidden">
        <ShieldCheck size={14} absoluteStrokeWidth strokeWidth={1.25} className="text-success" />
        <span className="tnum">
          Self-check: fixed {fixed} of {rep.found} issue{rep.found === 1 ? "" : "s"}
        </span>
        {rep.remaining > 0 && <span className="font-normal text-fg-subtle tnum">· {rep.remaining} left</span>}
        <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className="ml-auto text-fg-subtle transition-transform duration-fast group-open/check:rotate-90" />
      </summary>
      {rep.changes.length > 0 ? (
        <ul className="mt-[6px] flex list-disc flex-col gap-[2px] pl-[16px] marker:text-fg-faint">
          {rep.changes.slice(0, 12).map((c, i) => (
            <li key={i}>
              <span className="text-fg">{c.screen}</span> · {c.summary}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-[6px]">The repair didn&apos;t improve the screens, so they stay as generated.</p>
      )}
      {system && <div className="mt-[6px]">{system}</div>}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Detective

const ACTION_META: Record<Suggestion["action"], { label: string; icon: LucideIcon; tone: "neutral" | "warning" | "success" | "danger" }> = {
  split: { label: "Split", icon: Split, tone: "neutral" },
  merge: { label: "Merge", icon: Merge, tone: "warning" },
  "reuse-existing": { label: "Reuse", icon: Link2, tone: "success" },
  "new-token": { label: "New", icon: Plus, tone: "neutral" },
  drop: { label: "Drop", icon: X, tone: "danger" },
};

function DetectiveView({ chatId, turnId, o, sample, systemName, onRerun }: { chatId: string; turnId: string; o: DetectiveOutcome; sample: boolean; systemName?: string; onRerun: () => void }) {
  const rows = o.rows;
  const [addError, setAddError] = useState<string | null>(null);
  const setRows = (next: DetectiveRow[]) => updateDetectiveRows(chatId, turnId, next);
  const update = (key: string, patch: Partial<DetectiveRow>) => setRows(rows.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const remember = (approved: DetectiveRow[]) => {
    const list = loadDecisions().filter((d) => !approved.some((x) => d.value === x.value && d.suggested === x.name));
    for (const x of approved) list.push({ value: x.value, intent: x.intent, suggested: x.name, final: x.finalName });
    saveDecisions(list);
  };

  const decide = (row: DetectiveRow, decision: DetectiveRow["decision"]) => {
    update(row.key, { decision });
    if (decision === "approved") remember([row]);
  };

  const approveConfident = () => {
    const picked = rows.filter((x) => x.confidence >= 0.8 && !x.decision);
    const keys = new Set(picked.map((x) => x.key));
    setRows(rows.map((x) => (keys.has(x.key) ? { ...x, decision: "approved" as const } : x)));
    remember(picked);
  };

  // Split/merge groups sit together.
  const groups = new Map<string, DetectiveRow[]>();
  for (const x of rows) {
    const k = x.group || `solo-${x.key}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }

  const approved = rows.filter((x) => x.decision === "approved");
  const exportJSON = () => {
    const out: Record<string, unknown> = {};
    for (const x of approved) {
      const parts = x.finalName.split(/[./]/).filter(Boolean);
      let obj = out as Record<string, unknown>;
      parts.slice(0, -1).forEach((p) => (obj = (obj[p] ??= {}) as Record<string, unknown>));
      obj[parts[parts.length - 1]] = {
        $type: x.type === "color" ? "color" : x.type,
        $value: x.type === "color" ? (normalizeHex(x.value) ?? x.value) : x.value,
        $description: `${x.intent}. Used by: ${x.usage}`,
        $extensions: { "qalam.detective": { action: x.action, existingToken: x.existingToken || undefined, confidence: x.confidence } },
      };
    }
    download("detected.tokens.json", JSON.stringify(out, null, 2), "application/json");
  };

  return (
    <div className="flex flex-col gap-[10px]">
      {sample && (
        <span className="self-start">
          <Tag tone="neutral">Recorded sample · messy checkout CSS</Tag>
        </span>
      )}
      <div className={noteBox}>
        <p className="text-fg">{o.extract.summary}</p>
        <p className="mt-[4px] text-micro text-fg-subtle">
          Naming: <span className="font-mono text-fg-muted">{o.extract.namingConvention}</span>
        </p>
      </div>
      {o.rebuiltId && (
        <button type="button" onClick={() => focusNode(o.rebuiltId!)} className={clsx(linkBtn, "inline-flex items-center gap-[4px]")}>
          Rebuilt as an editable screen <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} />
        </button>
      )}
      <div className="flex flex-wrap gap-[6px]">
        <Button size="sm" variant="secondary" onClick={approveConfident}>
          <Check size={12} strokeWidth={2} /> Approve ≥ 0.8
        </Button>
        <Button size="sm" variant="secondary" disabled={!approved.length} onClick={() => setAddError(addDetectiveTokens(chatId, turnId))}>
          <Plus size={12} absoluteStrokeWidth strokeWidth={1.25} /> Add {approved.length || ""} to {systemName ?? "system"}
        </Button>
        <Button size="sm" variant="secondary" disabled={!approved.length} onClick={exportJSON}>
          <Download size={12} absoluteStrokeWidth strokeWidth={1.25} /> DTCG <span className="tnum">({approved.length})</span>
        </Button>
        {!sample && (
          <Button size="sm" variant="secondary" onClick={onRerun} disabled={!loadDecisions().length}>
            <RotateCcw size={12} absoluteStrokeWidth strokeWidth={1.25} /> Re-run with my naming
          </Button>
        )}
      </div>
      {addError && (
        <div className={warnBox}>
          <TriangleAlert size={14} absoluteStrokeWidth strokeWidth={1.25} />
          <span>{addError}</span>
        </div>
      )}
      {o.added && (
        <div className={doneBox}>
          <Check size={14} strokeWidth={2} />
          <div className="min-w-0">
            Added <span className="tnum">{o.added.paths.length}</span> token{o.added.paths.length === 1 ? "" : "s"} to <span className="font-medium">{o.added.systemName}</span>: <span className="font-mono text-micro">{o.added.paths.slice(0, 6).join(", ")}</span>
            {o.added.paths.length > 6 ? "…" : ""}
            {o.added.skipped.length > 0 && <div className="mt-[2px] text-fg-muted">Skipped: {o.added.skipped.map((x) => `${x.name} (${x.reason})`).join("; ")}</div>}
          </div>
        </div>
      )}
      {[...groups.entries()].map(([gk, list]) => {
        const grouped = !gk.startsWith("solo-") && list.length > 1;
        const kind = list[0].action;
        return (
          <div key={gk} className={clsx(grouped && "rounded-lg border border-dashed p-[6px]", grouped && (kind === "merge" ? "border-warning/40" : "border-line-strong"))}>
            {grouped && (
              <div className={clsx("mb-[6px] flex items-center gap-[6px] px-[4px] text-micro font-medium", kind === "merge" ? "text-warning" : "text-fg-muted")}>
                {kind === "split" ? <Split size={12} absoluteStrokeWidth strokeWidth={1.25} /> : <Merge size={12} absoluteStrokeWidth strokeWidth={1.25} />}
                {kind === "split" ? "Same value, different meanings: kept as separate tokens" : "Near-duplicates with one intent: merged"}
              </div>
            )}
            <div className="flex flex-col gap-[6px]">
              {list.map((x) => (
                <SuggestionRow
                  key={x.key}
                  row={x}
                  onName={(v) => {
                    update(x.key, { finalName: v });
                    if (x.decision === "approved") remember([{ ...x, finalName: v }]);
                  }}
                  onDecide={(d) => decide(x, d)}
                />
              ))}
            </div>
          </div>
        );
      })}
      <button type="button" className={clsx(r.link, "self-start text-micro text-fg-subtle")} onClick={() => clearDecisions()}>
        Forget my naming decisions
      </button>
    </div>
  );
}

const decideBtn = "q-item q-press q-press-icon grid size-[28px] shrink-0 place-items-center rounded-md";

function SuggestionRow({ row, onName, onDecide }: { row: DetectiveRow; onName: (v: string) => void; onDecide: (d: DetectiveRow["decision"]) => void }) {
  const meta = ACTION_META[row.action] ?? ACTION_META["new-token"];
  const hex = row.type === "color" ? normalizeHex(row.value) : null;
  const onWhite = hex ? contrastRatio(hex, "#FFFFFF") : 0;
  const onDark = hex ? contrastRatio(hex, "#0E1342") : 0;
  const approved = row.decision === "approved";
  const rejected = row.decision === "rejected";
  return (
    <div
      className={clsx(
        "rounded-lg p-[8px] transition-opacity duration-fast",
        approved ? "bg-success-subtle/50 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-success)_35%,transparent)]" : "bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
        rejected && "opacity-50",
      )}
    >
      <div className="flex items-center gap-[6px]">
        {hex ? <Swatch color={hex} size={22} /> : <span className="grid h-[22px] min-w-[22px] place-items-center rounded-md bg-muted px-[4px] text-micro font-medium text-fg-muted tnum">{row.value}</span>}
        <input className="h-[28px] min-w-0 flex-1 rounded-md bg-field px-[8px] font-mono text-caption font-medium text-fg outline-none transition-[box-shadow,background-color] duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus:bg-panel focus:shadow-focus-field focus:duration-0 focus-visible:outline-none" value={row.finalName} onChange={(e) => onName(e.target.value)} aria-label={`Token name for ${row.value}`} />
        <button
          type="button"
          aria-label="Approve"
          aria-pressed={approved}
          onClick={() => onDecide(approved ? undefined : "approved")}
          className={clsx(decideBtn, approved ? "bg-inverse text-fg-inverse shadow-button-invert hover:bg-inverse/90" : "bg-muted text-fg-muted hover:bg-active hover:text-fg")}
        >
          <Check size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Reject"
          aria-pressed={rejected}
          onClick={() => onDecide(rejected ? undefined : "rejected")}
          className={clsx(decideBtn, rejected ? "bg-danger-subtle text-danger" : "bg-muted text-fg-muted hover:bg-danger-subtle hover:text-danger")}
        >
          <X size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </button>
      </div>
      <div className="mt-[6px] flex flex-wrap items-center gap-[4px] text-micro">
        <Tag tone={meta.tone} icon={<meta.icon size={12} absoluteStrokeWidth strokeWidth={1.25} />}>
          {meta.label}
        </Tag>
        {row.existingToken && <Tag tone="success" icon={<Link2 size={12} absoluteStrokeWidth strokeWidth={1.25} />}>{row.existingToken}</Tag>}
        <span className="font-mono text-fg-subtle">{row.value}</span>
        <span className="ml-auto flex items-center gap-[6px] text-fg-subtle tnum">
          <span className="h-[4px] w-[40px] overflow-hidden rounded-full bg-active">
            <span className="block h-full rounded-full bg-fg-muted" style={{ width: `${Math.round(row.confidence * 100)}%` }} />
          </span>
          {Math.round(row.confidence * 100)}%
        </span>
      </div>
      <div className="mt-[6px] text-caption text-fg">
        <b className="font-medium">{row.intent}</b> <span className="text-fg-subtle">· {row.usage}</span>
      </div>
      <div className="mt-[2px] text-caption text-fg-muted">{row.reasoning}</div>
      {hex && (
        <div className="mt-[6px] flex gap-[4px]">
          <Tag tone={onWhite >= 4.5 ? "success" : "danger"} icon={onWhite >= 4.5 ? <Check size={12} strokeWidth={2} /> : undefined}>
            <span className="tnum">on white {onWhite.toFixed(1)}:1</span>
          </Tag>
          <Tag tone={onDark >= 4.5 ? "success" : "danger"} icon={onDark >= 4.5 ? <Check size={12} strokeWidth={2} /> : undefined}>
            <span className="tnum">on midnight {onDark.toFixed(1)}:1</span>
          </Tag>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit

const CATEGORY_LABEL: Record<Category, string> = {
  accessibility: "Accessibility",
  tokens: "Tokens",
  rtl: "RTL & Arabic",
  content: "Content",
  system: "Component system",
};

const FINDINGS_SHOWN = 6;

function AuditView({ chatId, t, o }: { chatId: string; t: ChatTurn; o: AuditOutcome }) {
  const [showJSON, setShowJSON] = useState(false);
  const [all, setAll] = useState(false);
  const counts = { error: 0, warning: 0, info: 0 };
  o.findings.forEach((f) => counts[f.severity]++);
  const cats = (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => o.findings.some((f) => f.category === c));
  const fixable = o.findings.filter((f) => f.fix).length;
  let shown = 0;

  return (
    <div className="flex flex-col gap-[10px]">
      {o.findings.length ? (
        <>
          <div className="grid grid-cols-3 gap-[6px]">
            <Stat n={counts.error} label="Errors" icon={<CircleAlert size={12} absoluteStrokeWidth strokeWidth={1.25} />} cls="bg-danger-subtle text-danger" />
            <Stat n={counts.warning} label="Warnings" icon={<TriangleAlert size={12} absoluteStrokeWidth strokeWidth={1.25} />} cls="bg-warning-subtle text-warning" />
            <Stat n={counts.info} label="Notes" icon={<Info size={12} absoluteStrokeWidth strokeWidth={1.25} />} cls="bg-muted text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" />
          </div>
          <div className="flex flex-wrap gap-[6px]">
            <Button size="sm" variant="primary" disabled={!fixable} onClick={() => fixFindings(chatId, t.id)}>
              <Wand2 size={12} absoluteStrokeWidth strokeWidth={1.25} /> Fix <span className="tnum">{fixable}</span> automatically
            </Button>
            <Button size="sm" variant="ghost" onClick={() => download("audit.json", JSON.stringify({ findings: o.findings, ai: o.ai }, null, 2), "application/json")}>
              <Download size={12} absoluteStrokeWidth strokeWidth={1.25} /> JSON
            </Button>
          </div>
        </>
      ) : (
        <div className={doneBox}>
          <ShieldCheck size={14} absoluteStrokeWidth strokeWidth={1.25} />
          <span className="font-medium">No linter issues. System-clean.</span>
        </div>
      )}
      {o.aiError && <ErrorNote message={`Qalam AI's review failed: ${o.aiError}`} />}
      {o.ai && (
        <div className="flex flex-col gap-[8px] rounded-lg bg-muted p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <div className="flex items-center gap-[6px]">
            <QalamAIGlyph size={14} />
            <span className="text-caption font-semibold text-fg">Qalam AI&apos;s review</span>
            <span className="ml-auto inline-flex h-[20px] items-center rounded-sm bg-active px-[6px] text-micro font-semibold text-fg tnum">{Math.round(o.ai.score)}/100</span>
          </div>
          <p className="text-caption text-fg-muted">{o.ai.summary}</p>
          <button type="button" className={clsx(r.link, "inline-flex items-center gap-[4px] self-start text-micro font-medium")} onClick={() => setShowJSON(!showJSON)}>
            <Braces size={12} absoluteStrokeWidth strokeWidth={1.25} /> {showJSON ? "Hide" : "Show"} linter JSON
          </button>
          {showJSON ? (
            <pre className="max-h-[320px] overflow-auto rounded-md bg-field p-[8px] font-mono text-micro text-fg-muted">{JSON.stringify(o.ai.issues, null, 2)}</pre>
          ) : (
            o.ai.issues.map((i, k) => (
              <button key={k} type="button" onClick={() => focusNode(i.nodeId)} className="q-item rounded-md bg-panel p-[8px] text-left text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
                <div className="flex items-center gap-[6px]">
                  <Tag tone={i.severity === "critical" ? "danger" : i.severity === "major" ? "warning" : "neutral"}>{i.severity[0].toUpperCase() + i.severity.slice(1)}</Tag>
                  <span className="font-mono text-micro text-fg-subtle">{i.rule}</span>
                </div>
                <div className="mt-[4px] text-fg">{i.issue}</div>
                {i.replaceWith && <div className="mt-[2px] font-mono text-micro text-fg-muted">→ {i.replaceWith}</div>}
                {i.rtlNote && <div className="mt-[2px] text-micro text-fg-muted">RTL: {i.rtlNote}</div>}
              </button>
            ))
          )}
        </div>
      )}
      {cats.map((c) => {
        const list = o.findings.filter((f) => f.category === c);
        const visible = all ? list : list.slice(0, Math.max(0, FINDINGS_SHOWN - shown));
        shown += visible.length;
        if (!visible.length) return null;
        return (
          <div key={c} className="flex flex-col gap-[6px]">
            <div className={r.eyebrow}>
              {CATEGORY_LABEL[c]} <span className="tnum">· {list.length}</span>
            </div>
            {visible.map((f) => (
              <FindingRow key={f.id} f={f} onFix={() => fixFindings(chatId, t.id, f)} />
            ))}
          </div>
        );
      })}
      {!all && o.findings.length > FINDINGS_SHOWN && (
        <button type="button" className={linkBtn} onClick={() => setAll(true)}>
          Show all {o.findings.length} findings
        </button>
      )}
    </div>
  );
}

function Stat({ n, label, cls, icon }: { n: number; label: string; cls: string; icon: React.ReactNode }) {
  return (
    <div className={clsx("flex flex-col gap-[2px] rounded-lg px-[10px] py-[8px]", cls)}>
      <div className="text-display font-semibold tnum">{n}</div>
      <div className="flex items-center gap-[4px] text-micro font-medium">
        {icon}
        {label}
      </div>
    </div>
  );
}

function FindingRow({ f, onFix }: { f: Finding; onFix: () => void }) {
  const Icon = f.severity === "error" ? CircleAlert : f.severity === "warning" ? TriangleAlert : Info;
  return (
    <div className="flex gap-[8px] rounded-lg p-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] transition-shadow duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0">
      <Icon size={14} absoluteStrokeWidth strokeWidth={1.25} className={clsx("mt-[1px] shrink-0", f.severity === "error" ? "text-danger" : f.severity === "warning" ? "text-warning" : "text-fg-subtle")} />
      <div className="min-w-0 flex-1">
        <button type="button" className="block max-w-full truncate text-caption font-medium text-fg hover:underline" onClick={() => focusNode(f.nodeId)} dir="auto">
          {f.nodeName}
        </button>
        <div className="text-caption text-fg-muted">{f.message}</div>
        <div className="mt-[6px] flex flex-wrap items-center gap-[4px]">
          {f.wcag && <span className={r.chip}>WCAG {f.wcag}</span>}
          <span className="inline-flex h-[20px] items-center rounded-sm bg-active px-[6px] font-mono text-micro text-fg-muted">{f.rule}</span>
          {f.fix && (
            <button type="button" onClick={onFix} className="q-press inline-flex h-[20px] items-center rounded-sm bg-inverse px-[6px] text-micro font-medium text-fg-inverse shadow-button-invert hover:bg-inverse/90 active:shadow-button-pressed">
              {f.fix.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Critique (the conversation itself is in the card on the canvas)

const VERDICT: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  meets: { label: "Meets the goal", tone: "success" },
  partially: { label: "Partially meets the goal", tone: "warning" },
  misses: { label: "Misses the goal", tone: "danger" },
};

function CritiqueView({ t, o }: { t: ChatTurn; o: CritiqueOutcome }) {
  useStudio((s) => s.doc.brief); // re-render when the Knowledge hub changes
  const live = isLiveCritique(t);
  const status =
    o.fix === "running"
      ? "Fixing the screens…"
      : o.status === "busy"
        ? "Thinking…"
        : t.status === "running"
          ? "Fixing an issue…"
          : o.status === "asking"
            ? `Question ${o.questions + 1} is waiting in the card on the canvas`
            : o.status === "error"
              ? (t.error ?? "The critique failed. Retry it in the card.")
              : o.status === "closed"
                ? "Closed before a verdict."
                : o.fix === "done"
                  ? "Fixed. Critique again in the card to check the result."
                  : "Verdict ready.";
  const v = o.verdict ? VERDICT[o.verdict] : undefined;
  return (
    <div className={clsx(cardBox, "flex flex-col gap-[8px]")}>
      {t.status === "running" ? (
        <Progress tokens={t.tokens} started={t.started} label={status} />
      ) : (
        <div className={clsx("flex items-center gap-[6px] text-caption font-medium", o.status === "error" ? "text-danger" : "text-fg")}>
          {o.status === "error" && <CircleAlert size={14} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0" />}
          {status}
        </div>
      )}
      {v && o.status === "done" && (
        <span className="self-start">
          <Tag tone={v.tone} icon={v.tone === "success" ? <Check size={12} strokeWidth={2} /> : undefined}>
            {v.label}
          </Tag>
        </span>
      )}
      {o.summary && <p className="text-caption text-fg-muted">{o.summary}</p>}
      {o.issues > 0 && (
        <div className="text-micro text-fg-subtle tnum">
          {o.issues} issue{o.issues > 1 ? "s" : ""} found{o.fixedIssues ? ` · ${o.fixedIssues} fixed` : ""}
        </div>
      )}
      <div className="flex flex-wrap gap-[6px]">
        {live && (
          <Button size="sm" variant="secondary" onClick={showCard}>
            <MessageCircleQuestion size={12} absoluteStrokeWidth strokeWidth={1.25} /> Show the card
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => studio().setLeftTab("knowledge")}>
          <BookOpen size={12} absoluteStrokeWidth strokeWidth={1.25} /> Knowledge hub
        </Button>
      </div>
    </div>
  );
}
