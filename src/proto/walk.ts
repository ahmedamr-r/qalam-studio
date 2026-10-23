/**
 * Walkthroughs (pure): a route's steps played in order on its compiled prototype — the module's
 * own `step`, the same code the studio plays — the way the session's playback strip and cursor
 * perform them. Each clip is a step's actions with what it takes to reach them added (a tab
 * tapped first when the pick a step makes is in a section another tab shows), and where the
 * prototype is when the clip starts: jumping to a clip starts the live prototype there.
 */
import type { Doc, Expr, PlayAction, RouteProto, RouteRef, RouteStep } from "@/doc/schema";
import { layerAddress, subLayers } from "./items";
import { findLayer, refFrame } from "./routes";
import { componentAt } from "./scope";

/** The compiled module's state, as far as a walkthrough reads it. */
export interface PlayState {
  screen: string;
  open: string[];
  data: Record<string, unknown>;
  app: Record<string, unknown>;
  scrollTo?: { y: number; n: number };
}

/** What a walkthrough needs of the compiled module. */
export interface Machine {
  initial: (screen: string) => PlayState;
  step: (s: PlayState, a: Record<string, unknown>) => PlayState;
  TAPS: Record<string, { rule: string; it?: string }[]>;
  /** Pages not designed yet, by their placeholder's screen key: the screen that goes there, and the page. */
  PENDING?: Record<string, { from: string; page: string; name: string }>;
}

export interface Clip {
  step: RouteStep;
  /** Its actions, with what it takes to reach them. */
  actions: PlayAction[];
  /** Where the prototype is when the clip starts, and how far its screen is scrolled. */
  from: { state: PlayState; y: number };
}

/** The layer a ref points at in the design (the first, for a pattern; the n-th option, for a sub-ref). */
export function refLayer(doc: Doc, screen: string, route: RouteProto, ref: RouteRef): string | null {
  const frame = refFrame(doc, screen, ref);
  if (!frame) return null;
  const id = ref.path ? findLayer(doc, frame, ref.path, componentAt(route, ref)) : frame;
  if (!id || !ref.sub) return id;
  const subs = subLayers(doc, id, ref.sub.role);
  return subs[ref.sub.nth ?? 0] ?? null;
}

/** What tapping a ref runs: the module's TAPS for that layer. */
function runsAt(doc: Doc, screen: string, key: string, route: RouteProto, taps: Machine["TAPS"], ref: RouteRef) {
  const id = refLayer(doc, screen, route, ref);
  const n = id ? doc.nodes[id] : undefined;
  return n ? (taps[`${key}|${ref.part ?? ""}|${layerAddress(doc, n.id)}|${n.name}`] ?? null) : null;
}

/** `v == k` (or several of them, or'd): the values of `v` that make it hold; null for anything else. */
function equalsOf(e: Expr): { v: string; values: unknown[] } | null {
  if (!e || typeof e !== "object" || !("op" in e)) return null;
  if (e.op === "==") {
    const [a, b] = e.a;
    const v = a && typeof a === "object" && "v" in a ? a.v : null;
    return v !== null && (b === null || typeof b !== "object") ? { v, values: [b] } : null;
  }
  if (e.op === "or") {
    const parts = e.a.map(equalsOf);
    if (parts.some((p) => !p) || new Set(parts.map((p) => p!.v)).size !== 1) return null;
    return { v: parts[0]!.v, values: parts.flatMap((p) => p!.values) };
  }
  return null;
}

/**
 * What to tap first so a layer on the screen shows: when it's in something shown only while a
 * pick holds (a tab's section), the option that makes the pick — if it isn't made already.
 */
export function revealFor(doc: Doc, screen: string, route: RouteProto, ref: RouteRef, state: PlayState): PlayAction | null {
  if (ref.part) return null;
  const id = refLayer(doc, screen, route, ref);
  const p = id ? doc.nodes[id]?.meta.specPath : undefined;
  if (p === undefined) return null;
  for (const b of route.bindings ?? []) {
    if (b.kind !== "visible" || b.ref.part || !b.ref.path || b.ref.path.includes("*")) continue;
    if (p !== b.ref.path && !p.startsWith(`${b.ref.path}.`)) continue;
    const eq = equalsOf(b.e);
    if (!eq || eq.values.includes(state.data[eq.v])) continue;
    const opener = route.rules.find((ru) => "ref" in ru.when && !ru.when.ref.part && ru.then.some((a) => a.do === "set" && a.v === eq.v && eq.values.includes(a.e as unknown)));
    if (opener && "ref" in opener.when) return { do: "tap", ref: opener.when.ref };
  }
  return null;
}

/**
 * Every step's clip, from the screen's start: the actions with what reaches them, and the state
 * each clip starts from. `max`: how far the screen scrolls (measured where it plays).
 */
export function walkthrough(
  mod: Machine,
  doc: Doc,
  screen: string,
  key: string,
  opts: { max: number },
): { clips: Clip[]; end: { state: PlayState; y: number }; dead: { step: string; ref: RouteRef }[] } {
  const route = doc.proto?.routes?.[screen];
  let state = mod.initial(key);
  let y = 0;
  const clips: Clip[] = [];
  // Taps that run nothing: a step that wouldn't show what it says.
  const dead: { step: string; ref: RouteRef }[] = [];
  if (!route) return { clips, end: { state, y }, dead };
  let current = "";
  const scrolled = (to: number) => {
    y = Math.max(0, Math.min(to, opts.max));
    state = mod.step(state, { do: "scrolled", y, max: opts.max });
  };
  const tap = (ref: RouteRef) => {
    const runs = runsAt(doc, screen, key, route, mod.TAPS, ref);
    if (!runs?.length) dead.push({ step: current, ref });
    const asked = state.scrollTo?.n;
    for (const r of runs ?? []) state = mod.step(state, { do: "run", rule: r.rule, it: r.it });
    // A rule that scrolls (a chip to its section) moves the screen: it scrolls there.
    if (state.scrollTo && state.scrollTo.n !== asked) scrolled(state.scrollTo.y);
  };
  for (const step of route.steps ?? []) {
    current = step.id;
    // A step after one that left the screen starts back on it.
    if (state.screen !== key) {
      state = mod.step(state, { do: "back" });
      y = 0;
    }
    const from = { state, y };
    const actions: PlayAction[] = [];
    for (const a of step.play) {
      if (a.do === "scroll") {
        actions.push(a);
        scrolled(a.y);
        continue;
      }
      const reveal = revealFor(doc, screen, route, a.ref, state);
      if (reveal && reveal.do === "tap") {
        actions.push(reveal);
        tap(reveal.ref);
      }
      actions.push(a);
      if (a.do === "tap") tap(a.ref);
    }
    clips.push({ step, actions, from });
  }
  return { clips, end: { state, y }, dead };
}
