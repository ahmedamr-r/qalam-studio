import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Doc, RouteRef } from "@/doc/schema";
import { asksOf, askText } from "@/proto/asks";
import { walkthrough, type Clip, type Machine, type PlayState } from "@/proto/walk";
import { studio } from "@/doc/store";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { Button } from "../../controls";
import { Boundary } from "../Failure";
import { generateNext } from "../next";
import { usePrototypeMode } from "../store";
import { AgentView, listed, startPropose, tickStep, useAgent } from "./AgentView";
import type { PlayerProps } from "../runtime";
import { createCursor, type Cursor } from "./cursor";
import { liveElement, scrollerOf } from "./dom";
import { Markers, type Mark } from "./Markers";
import { PlaybackStrip } from "./PlaybackStrip";
import { play } from "./playback";
import { StepsPanel } from "./StepsPanel";

/**
 * The prototype session: the compiled prototype playing live, and — for a screen with a route —
 * what it does, step by step. The steps list and the numbered markers on the device show where
 * each step starts; the playback strip performs them with a cursor, and picking a step or a clip
 * starts the prototype where it begins (worked out ahead by playing the steps before it,
 * proto/walk.ts). Touching the device takes over from playback.
 */
export function Session({
  doc,
  screen,
  screenKey,
  machine,
  size,
  Proto,
  restart,
  aside,
}: {
  doc: Doc;
  /** The screen it starts on (its id), and its key in the code. */
  screen: string;
  screenKey: string;
  /** The compiled route machine; null when the prototype has no routes. */
  machine: Machine | null;
  /** The screen's size, to fit it in the stage. */
  size: { w: number; h: number };
  Proto: ComponentType<PlayerProps>;
  /** Bumps when the session should start over. */
  restart: number;
  /** Beside the stage (the code). */
  aside?: ReactNode;
}) {
  const route = doc.proto?.routes?.[screen];
  const steps = useMemo(() => route?.steps ?? [], [route]);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const device = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const cursor = useRef<Cursor | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const [mount, setMount] = useState<{ n: number; from?: { state: PlayState; y: number } }>({ n: 0 });
  const [clips, setClips] = useState<Clip[]>([]);
  const [at, setAt] = useState<{ clip: number; action: number } | null>(null);
  const [last, setLast] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [live, setLive] = useState<PlayState | null>(null);
  // A screen wider or taller than the stage (a dashboard) is shown smaller, whole: CSS zoom keeps its layout, so the cursor and markers measure what's drawn.
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setFit(Math.min(1, (el.clientWidth - 48) / size.w, (el.clientHeight - 48) / size.h));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w, size.h]);
  const phone = (doc.nodes[screen]?.meta.spec?.platform ?? "mobile") === "mobile";
  const radius = phone ? 28 : 12;
  // The prototype re-renders only when it's remounted, not when the session's own state moves.
  const Player = useMemo(() => memo(Proto), [Proto]);
  const onChange = useCallback((s: unknown) => setLive(s as PlayState), []);

  useEffect(() => {
    if (!layer.current) return;
    const c = createCursor(layer.current);
    cursor.current = c;
    return () => c.dispose();
  }, []);

  // A screen with no route yet still has layers to point at (what Qalam AI proposes).
  const find = useCallback((ref: RouteRef) => (device.current ? liveElement(device.current, doc, screen, screenKey, route ?? { overlays: {}, addOns: {}, rules: [] }, ref) : null), [doc, screen, screenKey, route]);

  // The walkthrough, once the screen shows: how far it scrolls is measured there.
  useEffect(() => {
    if (!machine || !steps.length) {
      setClips([]);
      return;
    }
    const t = setTimeout(() => {
      const sc = device.current && scrollerOf(device.current);
      const max = sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : 0;
      setClips(walkthrough(machine, doc, screen, screenKey, { max }).clips);
    }, 150);
    return () => clearTimeout(t);
  }, [machine, doc, screen, screenKey, steps]);

  const stop = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setAt(null);
  }, []);
  useEffect(() => stop, [stop]);

  /** Starts the live prototype where clip `i` begins (0: from the start). */
  const jump = useCallback(
    (i: number) => {
      stop();
      setLast(i);
      setMount((m) => ({ n: m.n + 1, from: i > 0 ? clips[i]?.from : undefined }));
    },
    [clips, stop],
  );

  const playFrom = useCallback(
    async (i: number) => {
      jump(i);
      const c = new AbortController();
      ctl.current = c;
      // The prototype starts over where the clip begins before the cursor moves.
      await new Promise((r) => setTimeout(r, 200));
      if (c.signal.aborted || !device.current || !cursor.current) return;
      const stage = { device: device.current, find, scroller: () => (device.current ? scrollerOf(device.current) : null), cursor: cursor.current };
      await play(
        stage,
        clips,
        i,
        (clip, action) => {
          // Played to the end: Play starts over.
          setAt(clip < 0 ? null : { clip, action });
          setLast(clip < 0 ? 0 : clip);
        },
        c.signal,
      );
      if (ctl.current === c) ctl.current = null;
    },
    [clips, find, jump],
  );

  // Restart (from the header): the prototype from its start, nothing playing.
  const jumpTo = useRef(jump);
  jumpTo.current = jump;
  const restarted = useRef(restart);
  useEffect(() => {
    if (restarted.current === restart) return;
    restarted.current = restart;
    jumpTo.current(0);
  }, [restart]);

  const onStart = !live || live.screen === screenKey;
  // While Qalam AI proposes or builds here, it's asked once.
  const agentBusy = useAgent((a) => a.screen === screen && a.state.phase !== "idle" && a.state.phase !== "built");
  // Opened to propose (from what Generate left for the prototype): Qalam AI starts reading the screen.
  const asked = usePrototypeMode((s) => s.propose === screen);
  useEffect(() => {
    if (!asked) return;
    usePrototypeMode.setState({ propose: null });
    if (!agentBusy) void startPropose(screen, studio().doc, askText(studio().doc.proto?.routes?.[screen]));
  }, [asked, agentBusy, screen]);
  // What the markers mark: the proposal while one is being picked from (a marker picks its step), else the steps built.
  const proposal = useAgent((a) => (a.screen === screen && a.state.phase === "proposed" ? a.state.proposal : null));
  const proposing = !!proposal;
  const marks: Mark[] = useMemo(
    () => (proposal ? listed(proposal).map((s) => ({ key: s.candidate.id, at: s.candidate.at, label: s.label, dim: !s.ticked })) : steps.map((s) => ({ key: s.id, at: s.at, label: s.label }))),
    [proposal, steps],
  );
  const pickMark = (i: number) => (proposal ? tickStep(screen, listed(proposal)[i].candidate.id) : jump(i));
  // Markers point at the screen: not while a sheet or dialog covers it.
  const overlayOpen = !!live?.open.some((p) => route?.overlays[p]);
  // On a page this screen goes on to that isn't designed yet: Generate it from here.
  const pending = live ? machine?.PENDING?.[live.screen] : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <StepsPanel
          steps={steps}
          active={at?.clip ?? null}
          hover={hover}
          onHover={setHover}
          onPick={(i) => jump(i)}
          agent={<AgentView screen={screen} doc={studio().doc} hover={proposing ? hover : null} onHover={setHover} />}
          onPropose={agentBusy ? undefined : () => void startPropose(screen, studio().doc, askText(route))}
          queued={asksOf(route)}
        />
        {/* Shown at 1:1: Motion measures layout on screen, so a scaled device would throw off its morphs. Margin auto centres it and still scrolls when it's taller. */}
        <div ref={stage} className="flex min-w-0 flex-1 overflow-auto bg-canvas p-[24px]" data-prototype-stage>
          <div ref={frame} className="relative m-auto shrink-0">
            <div
              ref={device}
              className="overflow-hidden bg-black shadow-modal"
              style={{ borderRadius: radius, ...(fit < 1 ? { zoom: fit } : {}) }}
              data-prototype-device
              // Touching the prototype takes over from playback.
              onPointerDownCapture={(e) => {
                if (e.isTrusted && ctl.current) stop();
              }}
            >
              <Boundary key={mount.n}>
                <Player from={mount.from} onChange={onChange} />
              </Boundary>
            </div>
            <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: radius * fit }} />
            {pending?.from === screenKey && (
              <div className="absolute inset-x-0 bottom-[25%] flex justify-center">
                <Button size="sm" variant="secondary" onClick={() => void generateNext(screen, pending.page)}>
                  <QalamAIGlyph size={14} /> Generate {pending.name}
                </Button>
              </div>
            )}
            {!at && onStart && !overlayOpen && marks.length > 0 && (
              <div className="pointer-events-none absolute inset-0">
                <Markers frame={frame} device={device} steps={marks} find={find} hover={hover} onHover={setHover} onPick={pickMark} />
              </div>
            )}
          </div>
        </div>
        {aside}
      </div>
      {clips.length > 0 && <PlaybackStrip clips={clips} at={at} onPlay={() => void playFrom(last)} onPause={stop} onPick={jump} />}
    </div>
  );
}
