import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { worldBounds, type Box } from "@/doc/geometry";
import { useReservations } from "@/doc/reservations";
import { reducedMotion } from "../motion";
import { toScreenBox } from "./anchor";
import { bubbleText, useAgents, type Agent } from "./agents";
import { chatBottomInset } from "./chatFrame";
import { unfollow } from "./follow";

interface Vp {
  w: number;
  h: number;
}

/** An agent's identity colour (teal, rose, lime, sky; darker set in light), for its arrow, avatar and follow frame. */
export const agentColor = (i: number) => `var(--color-agent-${(i % 4) + 1})`;
/** Text on an agent colour: ink in dark, white in light (every pair ≥ 4.5:1). */
export const agentInk = (_i?: number) => "var(--color-agent-ink)";

/** How long a cursor takes to fade out when its work ends (--dur-fast). */
const LEAVE_MS = 150;

interface CursorProps {
  id: string;
  target: Box;
  color: number;
  name: string;
  activity: string;
  text: string;
}

/**
 * Qalam AI's cursors on the canvas: one per running request, pointing at what it's building, with
 * a nacre name tag ("Designer · building") and what it's thinking underneath. New elements glow
 * once when they land. Layers being restyled or fixed get a cursor parked on them. While the camera
 * follows an agent, the canvas is framed in its colour. The View menu's "Multiplayer cursors" hides
 * the cursors (not the glows or the follow frame). Only the frame's "stop following" tag takes
 * pointer events.
 */
export default function AgentCursors({ vp }: { vp: Vp }) {
  const agents = useAgents((s) => s.agents);
  const followingId = useAgents((s) => s.following);
  const following = agents.find((a) => a.turnId === followingId) ?? null;
  const reservations = useReservations((s) => s.list);
  const shown = useStudio((s) => s.view.agentCursors);
  // Work with its own agent cursor doesn't get a second, parked one.
  const veils = reservations.filter((r) => r.nodeIds.length && !(r.owner && agents.some((a) => a.turnId === r.owner || a.claims === r.owner)));
  const doc = useStudio((s) => s.doc);

  const cursors: CursorProps[] = [];
  if (shown) {
    for (const a of agents) {
      if (!a.target) continue;
      const text = bubbleText(a);
      cursors.push({ id: a.turnId, target: a.target, color: a.color, name: a.name, activity: a.activity, text: text === `${a.activity}…` ? "" : text });
    }
    veils.forEach((r, i) => {
      const id = r.nodeIds.find((n) => doc.nodes[n]);
      if (!id) return;
      const b = worldBounds(doc, id);
      cursors.push({ id: r.id, target: { x: b.x, y: b.y, w: b.w, h: Math.min(b.h, 160) }, color: (agents.length + i + 2) % 4, name: "Qalam AI", activity: r.label, text: "" });
    });
  }
  const live = useRetained(cursors, LEAVE_MS);

  return (
    <>
      {agents.map((a) => a.glows.map((g) => <GlowBox key={`${a.turnId}-${g.id}`} box={g.box} />))}
      {live.map(({ item, leaving }) => (
        <Cursor key={item.id} vp={vp} leaving={leaving} {...item} />
      ))}
      {following && <FollowFrame key={following.turnId} agent={following} />}
    </>
  );
}

/**
 * The list as given, plus items that just left it, kept for `ms` (flagged `leaving`) so they can
 * fade out. Runs before paint, so a leaving item never blinks.
 */
export function useRetained<T extends { id: string }>(items: T[], ms: number): { item: T; leaving: boolean }[] {
  const prev = useRef<T[]>([]);
  const [gone, setGone] = useState<T[]>([]);
  const ids = items.map((i) => i.id).join("|");
  useLayoutEffect(() => {
    const now = new Set(items.map((i) => i.id));
    const left = prev.current.filter((p) => !now.has(p.id));
    prev.current = items;
    // Back again: no longer leaving.
    setGone((g) => {
      const kept = g.filter((x) => !now.has(x.id));
      const added = left.filter((l) => !kept.some((k) => k.id === l.id));
      return added.length || kept.length !== g.length ? [...kept, ...added] : g;
    });
    if (!left.length) return;
    const t = setTimeout(() => setGone((g) => g.filter((x) => !left.some((l) => l.id === x.id))), ms);
    return () => clearTimeout(t);
    // `items` is a new array every render; its ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, ms]);
  const live = new Set(items.map((i) => i.id));
  return [...items.map((item) => ({ item, leaving: false })), ...gone.filter((g) => !live.has(g.id)).map((item) => ({ item, leaving: true }))];
}

/** Where the arrow's tip goes on a target: its bottom-right corner, pulled inside big elements. */
function tipOf(t: Box, zoom: number): { x: number; y: number } {
  const inset = Math.min(24 / zoom, t.w / 3, t.h / 3);
  return { x: t.x + t.w - inset, y: t.y + t.h - inset };
}

function Cursor({ vp, target, color, name, activity, text, leaving }: CursorProps & { vp: Vp; leaving: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const goal = useRef(target);
  goal.current = target;
  const wake = useRef<() => void>(() => {});
  // Pops in from the tip on the bouncy spring; under reduced motion it only fades.
  const [enter] = useState(() => ({ "--motion-pop-scale": reducedMotion() ? 1 : 0.6 }) as CSSProperties);

  // Glide in world space and project through the camera, so panning never drags it. The loop
  // sleeps once the cursor has arrived and wakes when the target or the camera moves.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const still = reducedMotion();
    let pos = tipOf(goal.current, studio().camera.zoom);
    const place = () => {
      const s = toScreenBox({ ...pos, w: 0, h: 0 }, studio().camera);
      const floor = vp.h - chatBottomInset() - 28;
      const x = Math.min(Math.max(s.x, 8), vp.w - 24);
      const y = Math.min(Math.max(s.y, 8), floor);
      if (!el.current) return;
      el.current.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      // Near the right edge the tag opens to the left, and just above the chat window it opens
      // upwards, so it stays in view.
      el.current.dataset.flip = x > vp.w - 300 ? "1" : "0";
      el.current.dataset.up = y > floor - 90 && y > 120 ? "1" : "0";
    };
    const frame = (now: number) => {
      const zoom = studio().camera.zoom;
      const want = tipOf(goal.current, zoom);
      const k = still || !last ? (still ? 1 : 0.15) : 1 - Math.exp(-(now - last) / 110);
      pos = { x: pos.x + (want.x - pos.x) * k, y: pos.y + (want.y - pos.y) * k };
      last = now;
      if (Math.abs(want.x - pos.x) * zoom < 0.25 && Math.abs(want.y - pos.y) * zoom < 0.25) {
        pos = want;
        place();
        raf = 0;
        return;
      }
      place();
      raf = requestAnimationFrame(frame);
    };
    wake.current = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    place();
    const unsub = useStudio.subscribe((st, prev) => {
      if (st.camera === prev.camera) return;
      place();
      wake.current();
    });
    return () => {
      cancelAnimationFrame(raf);
      wake.current = () => {};
      unsub();
    };
  }, [vp.w, vp.h]);

  useEffect(() => wake.current(), [target.x, target.y, target.w, target.h]);

  return (
    <div ref={el} className="group absolute top-0 left-0 z-[1] will-change-transform" aria-hidden>
      <div
        data-state={leaving ? "closed" : "open"}
        style={enter}
        className="origin-top-left data-[state=closed]:animate-[q-fade-out_var(--dur-fast)_var(--ease-in-quad)_forwards] data-[state=open]:animate-[q-pop-in_var(--dur-spring-bouncy)_var(--ease-spring-bouncy)_both]"
      >
        <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.3)]">
          <path d="M1.5 1.5 14 8.2 8.2 9.6 5.6 15.4Z" fill={agentColor(color)} stroke="var(--color-agent-ink)" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
        <div className="absolute top-[15px] left-[13px] flex w-max max-w-[280px] flex-col items-start gap-[4px] group-data-[flip=1]:right-[4px] group-data-[flip=1]:left-auto group-data-[flip=1]:items-end group-data-[up=1]:top-auto group-data-[up=1]:bottom-[2px] group-data-[up=1]:flex-col-reverse">
          <span className="inline-flex h-[20px] max-w-full items-center rounded-[4px_10px_10px_10px] px-[7px] text-micro font-semibold whitespace-nowrap text-[#141412] shadow-[0_1px_2px_rgb(0_0_0/.25)] [background:var(--ai-gradient-soft)] group-data-[flip=1]:rounded-[10px_4px_10px_10px] group-data-[up=1]:rounded-[10px_10px_10px_4px] group-data-[flip=1]:group-data-[up=1]:rounded-[10px_10px_4px_10px]">
            <span className="truncate">
              {name} · {activity.toLowerCase()}
            </span>
          </span>
          {text && <span className="line-clamp-3 max-w-[260px] rounded-lg bg-elevated px-[10px] py-[6px] text-caption whitespace-pre-line text-fg-muted shadow-popover">{text}</span>}
        </div>
      </div>
    </div>
  );
}

/** Figma's follow frame: the canvas outlined in the agent's colour, with its name to stop following. */
function FollowFrame({ agent }: { agent: Agent }) {
  const c = agentColor(agent.color);
  return (
    <>
      <div className="q-fade absolute inset-0 z-[2]" style={{ boxShadow: `inset 0 0 0 2px ${c}` }} />
      <button
        type="button"
        onClick={unfollow}
        title="Stop following"
        data-state="open"
        data-side="bottom"
        className="q-pop q-press pointer-events-auto absolute top-0 left-1/2 z-[2] flex h-[24px] -translate-x-1/2 items-center gap-[6px] rounded-b-md pr-[6px] pl-[10px] text-caption font-medium whitespace-nowrap"
        style={{ background: c, color: agentInk(agent.color) }}
      >
        Following {agent.name}
        <X size={12} absoluteStrokeWidth strokeWidth={1.75} />
      </button>
    </>
  );
}

/** True when an animationend is the glow's own one-shot fade finishing (not a bubbled child animation). */
export function isGlowFadeEnd(e: { animationName: string; target: unknown; currentTarget: unknown }): boolean {
  return e.animationName === "ds-glow" && e.target === e.currentTarget;
}

/**
 * A new element landing: the working ring flashes once around it (1.3s), then nothing. The ring's
 * conic orbit is an infinite animation, so the box unmounts the moment its fade ends instead of
 * spinning invisibly until the store prunes it. Never mounted under reduced motion (the CSS hides it
 * there, and with no fade there would be no animationend to unmount it).
 */
function GlowBox({ box }: { box: Box }) {
  const cam = useStudio((s) => s.camera);
  const [done, setDone] = useState(reducedMotion);
  if (done) return null;
  const s = toScreenBox(box, cam);
  return (
    <div
      className="ds-glow absolute"
      style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
      onAnimationEnd={(e) => isGlowFadeEnd(e) && setDone(true)}
    >
      <div data-busy className="q-ai-ring q-ai-frame absolute inset-0 rounded-[3px]" />
    </div>
  );
}
