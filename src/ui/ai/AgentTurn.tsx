import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { BellRing, Check, Crosshair, Hash, PanelTop, ShoppingBag, Square, TextCursorInput, Type } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { descendants, topFrameOf } from "@/doc/geometry";
import { useGhosts } from "@/doc/ghosts";
import type { Doc } from "@/doc/schema";
import { CATALOG_BY_NAME } from "@/design-system/components";
import { specPaths } from "@/design-system/partial-spec";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import { getController } from "../CanvasView";
import { r } from "../recipes";
import { useAgents, type Agent, type AgentCreated, type AgentStep } from "./agents";
import { followAgent } from "./follow";
import { agentColor } from "./AgentCursors";
import { elapsed } from "./common";
import type { ChatTurn } from "./chatTypes";

/**
 * A Generate turn told the way Qalam AI works: its approach, the run's steps with their timings,
 * then a paragraph per screen with the elements it built under it ("Creating…" while it runs,
 * "Created" after). Chips point at the layers on the canvas: hover to outline, click to select.
 */

const CATEGORY_ICON = { layout: Hash, navigation: PanelTop, input: TextCursorInput, content: Type, feedback: BellRing, commerce: ShoppingBag } as const;

const iconFor = (component: string) => CATEGORY_ICON[CATALOG_BY_NAME.get(component)?.category ?? "layout"] ?? Square;

/** Component at a spec path, to label chips of finished turns. */
function instAt(spec: ScreenSpec, path: string): Inst | undefined {
  const [region, ...rest] = path.split(".");
  let list = spec[region as "body"] as Inst[] | undefined;
  let inst: Inst | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "children") {
      list = inst?.children;
      continue;
    }
    inst = list?.[Number(rest[i])];
  }
  return inst;
}

/** Node with this spec path under a root, in the document or a ghost. */
function nodeAt(doc: Doc, rootId: string | undefined, path: string): string | undefined {
  if (!rootId || !doc.nodes[rootId]) return undefined;
  return descendants(doc, rootId).find((id) => doc.nodes[id]?.meta.specPath === path);
}

/** Every spec path under a root, to its node (one walk per screen). */
function pathIndex(doc: Doc, rootId: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!rootId || !doc.nodes[rootId]) return out;
  for (const id of descendants(doc, rootId)) {
    const p = doc.nodes[id]?.meta.specPath;
    if (p && !out.has(p)) out.set(p, id);
  }
  return out;
}

/**
 * The Generate narrative. `live` = the run was watched in this session, so its steps were timed
 * (a turn reopened from history shows the story without the step list).
 */
export function GenerateSteps({ t, live }: { t: ChatTurn; live?: boolean }) {
  const agent = useAgents((s) => s.agents.find((a) => a.turnId === t.id));
  const doc = useStudio((s) => s.doc);
  const o = t.outcome?.kind === "generate" ? t.outcome : undefined;

  // Finished: the story rebuilt from the outcome and the screens on the canvas.
  const finished = useMemo((): AgentStep[] => {
    if (!o) return [];
    const steps: AgentStep[] = o.approach ? [{ key: "approach", text: o.approach, writing: false, created: [] }] : [];
    o.variants.forEach((v, i) => {
      const root = o.frameIds[i];
      const index = pathIndex(doc, root);
      // A section edit lists only what it put in.
      const only = o.section ? new Set(o.section.paths) : null;
      const created: AgentCreated[] = specPaths(v).filter((p) => !only || only.has(p)).map((p) => {
        const id = index.get(p);
        const component = instAt(v, p)?.component ?? "";
        return { variant: i, specPath: p, name: (id && doc.nodes[id]?.name) || component, component };
      });
      const name = (root && doc.nodes[root]?.name) || v.name;
      steps.push({ key: `screen-${i}`, title: o.section ? `${o.section.names.join(", ")} in ${name}` : name, text: o.section ? "" : (v.rationale ?? ""), writing: false, created });
    });
    return steps;
  }, [o, doc]);

  const steps = agent?.steps.length ? agent.steps : finished;
  const running = !!agent;
  const approach = steps.find((s) => s.key === "approach");
  const screens = steps.filter((s) => s.key !== "approach");
  if (!steps.length && !(live && running)) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      {approach && (
        <p className="text-body leading-[20px] text-fg-muted" dir="auto">
          {approach.text}
          {approach.writing && <Caret />}
        </p>
      )}
      {live && <RunSteps t={t} agent={agent} screens={screens} />}
      {screens.map((s, i) => (
        <div key={s.key} className="flex flex-col gap-[6px]">
          {(s.title || s.text) && (
            <p className="text-body leading-[20px] text-fg-muted" dir="auto">
              {s.title && <b className="font-medium text-fg">{s.title}. </b>}
              {s.text}
              {s.writing && <Caret />}
            </p>
          )}
          {s.created.length > 0 && <CreatedRow items={s.created} live={running && i === screens.length - 1} animate={!!live} turnId={t.id} frameIds={o?.frameIds} />}
        </div>
      ))}
    </div>
  );
}

const Caret = () => <span aria-hidden className="q-caret ml-[2px] inline-block h-[14px] w-[2px] translate-y-[2px] rounded-[1px] bg-fg-subtle" />;

type StepState = "done" | "running" | "todo";

/**
 * When each step of a watched run started and ended (by turn and step key), so the step list can
 * show "0.8s". Kept outside React: a turn's card can remount (chat switch) while its run goes on.
 */
const stepTimes = new Map<string, { start: number; end?: number }>();

function timed(turnId: string, key: string, state: StepState, now: number): { start: number; end?: number } | undefined {
  const id = `${turnId}:${key}`;
  let m = stepTimes.get(id);
  if (state !== "todo" && !m) stepTimes.set(id, (m = { start: now }));
  if (m && state === "done" && m.end === undefined) m.end = now;
  return m;
}

/** The run's steps: read the brief, draft each screen (with its layer count), then the self-check. */
function RunSteps({ t, agent, screens }: { t: ChatTurn; agent?: Agent; screens: AgentStep[] }) {
  const running = t.status === "running";
  const phase = agent?.phase;
  const o = t.outcome?.kind === "generate" ? t.outcome : undefined;
  // Replays and samples skip the self-check (the recording is already checked).
  const checks = !t.request.replay && !t.sample;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(i);
  }, [running]);

  const now = Date.now();
  const thinking = running && (!phase || phase === "thinking") && !screens.length;
  const rows: { key: string; label: string; state: StepState; meta?: string }[] = [{ key: "brief", label: thinking ? "Reading the brief" : "Read the brief", state: thinking ? "running" : "done" }];
  screens.forEach((s, i) => {
    const last = i === screens.length - 1;
    const drafting = running && last && phase !== "checking" && !o;
    const name = s.title ?? `Screen ${i + 1}`;
    rows.push({ key: s.key, label: drafting ? `Drafting ${name}` : `Drafted ${name}`, state: drafting ? "running" : "done", meta: drafting && s.created.length ? `${s.created.length} layers` : undefined });
  });
  if (checks) {
    const checking = running && (phase === "checking" || (!!o && !o.repair));
    rows.push({ key: "check", label: "Self-check: contrast, spacing, RTL", state: checking ? "running" : o?.repair || (!running && o) ? "done" : "todo" });
  }
  if (t.status === "stopped" || t.status === "error") for (const row of rows) if (row.state === "running") row.state = "todo";

  return (
    <div className={r.chatSteps} role="list" aria-label="Steps">
      {rows.map((row, i) => {
        const m = timed(t.id, row.key, row.state, now);
        const start = i === 0 ? Math.min(m?.start ?? t.started, t.started) : m?.start;
        const secs = start !== undefined && m?.end !== undefined ? (m.end - start) / 1000 : null;
        return (
          <div key={row.key} role="listitem" data-state={row.state} className={r.chatStep}>
            <span className="grid size-[14px] shrink-0 place-items-center text-fg-subtle">
              {row.state === "done" ? (
                <Check size={12} strokeWidth={2} />
              ) : row.state === "running" ? (
                <span className="ds-spin size-[12px] rounded-full border-[1.5px] border-line-strong" style={{ borderTopColor: "var(--ai-2)", borderRightColor: "var(--ai-3)" }} />
              ) : (
                <span className="size-[6px] rounded-full shadow-[inset_0_0_0_1px_var(--color-fg-faint)]" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className={r.chatStepTime}>{row.state === "running" ? row.meta : secs !== null ? `${secs.toFixed(1)}s` : null}</span>
          </div>
        );
      })}
    </div>
  );
}

function CreatedRow({ items, live, animate, turnId, frameIds }: { items: AgentCreated[]; live: boolean; animate: boolean; turnId: string; frameIds?: string[] }) {
  const row = useRef<HTMLDivElement>(null);
  // Keep the newest chip in view while building.
  useEffect(() => {
    if (row.current) row.current.scrollLeft = live ? row.current.scrollWidth : 0;
  }, [items.length, live]);
  const ghosts = useGhosts((s) => s.list);
  // Chips of a watched run pop in as they arrive (q-stagger); a reopened turn shows them at once.
  const [initial] = useState(items.length);

  /** The layer a chip points at: the finished screen's, else the one being built. */
  const resolve = (c: AgentCreated): string | undefined => {
    const doc = studio().doc;
    const real = nodeAt(doc, frameIds?.[c.variant], c.specPath);
    if (real) return real;
    const g = ghosts.find((x) => x.turnId === turnId && x.index === c.variant);
    return g ? nodeAt(g.doc, g.doc.roots[0], c.specPath) : undefined;
  };

  return (
    <div className="flex min-w-0 items-center gap-[8px]">
      <span className={clsx("shrink-0 text-caption", live ? "q-shimmer-text" : "text-fg-subtle")}>{live ? "Creating" : "Created"}</span>
      <div ref={row} className={clsx("flex min-w-0 flex-1 gap-[6px] overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] ds-noscrollbar", animate && "q-stagger")}>
        {items.map((c, i) => {
          const Icon = iconFor(c.component);
          return (
            <button
              key={`${c.variant}-${c.specPath}`}
              type="button"
              title={`${c.name} (${c.component})`}
              onMouseEnter={() => studio().setHover(resolve(c) ?? null)}
              onMouseLeave={() => studio().setHover(null)}
              onClick={() => {
                const id = resolve(c);
                const doc = studio().doc;
                if (!id || !doc.nodes[id]) return;
                studio().select([id]);
                getController()?.zoomToFit([topFrameOf(doc, id)]);
              }}
              // A batch that lands together staggers; chips streaming in one by one pop as they arrive.
              style={{ "--i": i < initial ? i : 0 } as CSSProperties}
              className="q-item q-press flex h-[24px] shrink-0 items-center gap-[6px] rounded-md bg-muted px-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-active hover:text-fg"
            >
              <Icon size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" />
              <span className="max-w-[140px] truncate">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Building" → "Qalam AI is building…"; other lines (a research step) as they are. */
function sentence(word: string): string {
  const w = word.replace(/…$/, "");
  return /^[A-Z][a-z]+ing\b/.test(w) ? `Qalam AI is ${w[0].toLowerCase()}${w.slice(1)}…` : `${w}…`;
}

/** One line under a running turn: what Qalam AI is doing (shimmering), Follow, tokens and the elapsed time. */
export function StatusLine({ t, fallback }: { chatId?: string; t: ChatTurn; fallback: string }) {
  const agent = useAgents((s) => s.agents.find((a) => a.turnId === t.id));
  const following = useAgents((s) => s.following === t.id);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);
  const word = t.activity ?? agent?.activity ?? fallback;
  const layers = agent?.phase === "building" ? agent.steps.reduce((n, s) => n + s.created.length, 0) : 0;
  return (
    <div className={clsx(r.chatStatus, "min-h-[24px]")} role="status">
      {agent && <span aria-hidden className="size-[6px] shrink-0 rotate-45 rounded-[1px]" style={{ background: agentColor(agent.color) }} title={agent.name} />}
      <span className="q-shimmer-text min-w-0 truncate">
        {sentence(word)}
        {layers > 0 && ` · ${layers} layers`}
      </span>
      {agent && !following && agent.target && (
        <button
          type="button"
          onClick={() => followAgent(t.id)}
          className={clsx(r.buttonBase, r.buttonGhost, "h-[22px] gap-[4px] rounded-md px-[6px] text-caption")}
          title={`Move the camera with the ${agent.name}'s cursor`}
        >
          <Crosshair size={12} absoluteStrokeWidth strokeWidth={1.25} /> Follow
        </button>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-[8px] font-normal text-fg-subtle tnum">
        {t.tokens > 0 && <span>{t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}k` : t.tokens} tok</span>}
        <span>{elapsed(now - t.started)}</span>
      </span>
    </div>
  );
}
