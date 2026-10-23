/**
 * Prototype helpers (pure): validating a stored or opened prototype, and reading its references.
 * The prototype is a declarative layer over the screens (see Prototype in schema.ts); codegen/
 * compiles it, so nothing here animates.
 */
import { isMotionRef, nativeDefault } from "@/design-system/motion";
import { normalizeRoutes, normalizeVars, pruneRoutes } from "@/proto/routes";
import type { Doc, MotionRef, ProtoLink, ProtoRef, ProtoTrack, ProtoTransitionKind, ProtoTrigger, Prototype, TakeGroup, TrackPreset } from "./schema";

export const PROTO_TRIGGERS = ["tap", "press", "hover", "delay"] as const satisfies readonly ProtoTrigger[];
export const TRANSITION_KINDS = ["smart", "push", "dissolve", "sheet"] as const satisfies readonly ProtoTransitionKind[];
export const TRACK_PRESETS = ["fade-up", "scale-in", "pulse", "shimmer"] as const satisfies readonly TrackPreset[];

/** The state every screen opens in. */
export const DEFAULT_STATE = "default";
/** A delay link without `after`. */
export const DEFAULT_DELAY = 800;

export const MAX_LINKS = 200;
export const MAX_TRACKS = 100;
/** Named states per screen. */
export const MAX_STATES = 12;
/** Longest state name. */
export const MAX_STATE_NAME = 40;

export const emptyProto = (): Prototype => ({ links: [], states: {}, tracks: [] });

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** "body", "body.1", "body.1.children.0" (and, where wildcards are allowed, "body.*"). */
const PATH = /^(header|sidebar|hero|body|footer)(\.(\d+|\*)(\.children\.(\d+|\*))*)?$/;

export const isSpecPath = (p: string, wildcards = false) => PATH.test(p) && (wildcards || !p.includes("*"));

function ref(v: unknown, wildcards = false): ProtoRef | null {
  const o = obj(v);
  const screen = str(o?.screen, 40);
  if (!o || !screen) return null;
  if (o.path === undefined || o.path === null || o.path === "") return { screen };
  const path = str(o.path, 80);
  return path && isSpecPath(path, wildcards) ? { screen, path } : null;
}

function link(v: unknown): ProtoLink | null {
  const o = obj(v);
  const from = ref(o?.from);
  if (!o || !from || !oneOf(PROTO_TRIGGERS, o.on)) return null;
  const t = obj(o.transition);
  if (!t || !oneOf(TRANSITION_KINDS, t.kind) || !isMotionRef(t.motion)) return null;
  const to = o.to === "back" ? "back" : obj(o.to);
  let target: ProtoLink["to"];
  if (to === "back") target = "back";
  else if (str(to?.screen, 40)) target = { screen: str(to!.screen, 40)! };
  else if (str(to?.state, 40)) target = { state: str(to!.state, 40)! };
  else return null;
  const out: ProtoLink = { from, on: o.on, to: target, transition: { kind: t.kind, motion: nativeDefault(t.kind, t.motion as MotionRef) } };
  if (o.on === "delay") out.after = typeof o.after === "number" && Number.isFinite(o.after) ? Math.round(Math.min(60_000, Math.max(0, o.after))) : DEFAULT_DELAY;
  return out;
}

function track(v: unknown): ProtoTrack | null {
  const o = obj(v);
  const target = ref(o?.target, true);
  if (!o || !target || !oneOf(TRACK_PRESETS, o.preset) || !isMotionRef(o.motion)) return null;
  const out: ProtoTrack = { target, preset: o.preset, motion: o.motion };
  if (typeof o.stagger === "number" && Number.isFinite(o.stagger) && o.stagger > 0) out.stagger = Math.round(Math.min(2000, o.stagger));
  return out;
}

/** Validate a prototype read from storage or an opened file; garbage becomes undefined. */
export function normalizeProto(x: unknown): Prototype | undefined {
  const o = obj(x);
  if (!o) return undefined;
  const p = emptyProto();
  const start = str(o.start, 40);
  if (start) p.start = start;
  p.links = (Array.isArray(o.links) ? o.links : []).map(link).filter((l): l is ProtoLink => !!l).slice(0, MAX_LINKS);
  p.tracks = (Array.isArray(o.tracks) ? o.tracks : []).map(track).filter((t): t is ProtoTrack => !!t).slice(0, MAX_TRACKS);
  for (const [screen, raw] of Object.entries(obj(o.states) ?? {})) {
    const named: Record<string, Record<string, unknown>> = {};
    for (const [name, diff] of Object.entries(obj(raw) ?? {}).slice(0, MAX_STATES)) {
      const d = obj(diff);
      if (!d || name === DEFAULT_STATE || !str(name, MAX_STATE_NAME)) continue;
      const clean = Object.fromEntries(Object.entries(d).filter(([k]) => !!parseStateKey(k)));
      if (Object.keys(clean).length) named[name.slice(0, MAX_STATE_NAME)] = clean;
    }
    if (Object.keys(named).length) p.states[screen] = named;
  }
  const keys = obj(o.keys);
  if (keys) {
    for (const [screen, raw] of Object.entries(keys)) {
      const m = Object.fromEntries(Object.entries(obj(raw) ?? {}).filter(([path, key]) => isSpecPath(path) && !!str(key, 40)));
      if (Object.keys(m).length) (p.keys ??= {})[screen] = m as Record<string, string>;
    }
  }
  const routes = normalizeRoutes(o.routes);
  if (routes) p.routes = routes;
  const vars = normalizeVars(o.vars);
  if (vars) p.vars = vars;
  const takes = (Array.isArray(o.takes) ? o.takes : []).flatMap((g): TakeGroup[] => {
    const t = obj(g);
    const frames = [...new Set((Array.isArray(t?.frames) ? t.frames : []).filter((f): f is string => !!str(f, 40)))].slice(0, 8);
    if (!t || frames.length < 2) return [];
    const chosen = typeof t.chosen === "string" && frames.includes(t.chosen) ? t.chosen : frames[0];
    return [{ frames, chosen, ...(t.collapsed === true ? { collapsed: true } : {}) }];
  });
  if (takes.length) p.takes = takes.slice(0, 20);
  if (o.feel === "android") p.feel = "android";
  return p.links.length || p.tracks.length || Object.keys(p.states).length || p.keys || p.start || p.routes || p.vars || p.takes ? p : undefined;
}

/**
 * The prototype without what points at screens that are gone (deleted, cut). Returns `p` itself
 * when nothing does. Runs with the edit that removed them, so undo brings both back.
 */
export function pruneProto(p: Prototype, roots: readonly string[]): Prototype {
  const has = new Set(roots);
  const linkOk = (l: ProtoLink) => has.has(l.from.screen) && (typeof l.to !== "object" || !("screen" in l.to) || has.has(l.to.screen));
  const gone = (o: Record<string, unknown> | undefined) => !!o && Object.keys(o).some((id) => !has.has(id));
  const routes = p.routes ? pruneRoutes(p.routes, roots) : undefined;
  // Takes keep what's left of them (two at least); a chosen one deleted hands over to the first left.
  const takesOk = !p.takes || p.takes.every((g) => g.frames.every((f) => has.has(f)));
  const takes = takesOk
    ? p.takes
    : p.takes!.flatMap((g) => {
        const frames = g.frames.filter((f) => has.has(f));
        return frames.length < 2 ? [] : [{ ...g, frames, chosen: frames.includes(g.chosen) ? g.chosen : frames[0] }];
      });
  if (p.links.every(linkOk) && p.tracks.every((t) => has.has(t.target.screen)) && !gone(p.states) && !gone(p.keys) && (!p.start || has.has(p.start)) && routes === p.routes && takesOk) return p;
  const keep = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => has.has(id)));
  const out: Prototype = { links: p.links.filter(linkOk), tracks: p.tracks.filter((t) => has.has(t.target.screen)), states: keep(p.states) };
  if (p.start && has.has(p.start)) out.start = p.start;
  if (p.keys) out.keys = keep(p.keys);
  if (routes) out.routes = routes;
  if (p.vars) out.vars = p.vars;
  if (takes?.length) out.takes = takes;
  if (p.feel) out.feel = p.feel;
  return out;
}

/** "body.1.props.current" → the instance at "body.1" and its prop "current". */
export function parseStateKey(key: string): { path: string; prop: string } | null {
  const i = key.indexOf(".props.");
  if (i < 0) return null;
  const path = key.slice(0, i);
  const prop = key.slice(i + ".props.".length);
  return isSpecPath(path) && /^[A-Za-z][\w-]*$/.test(prop) ? { path, prop } : null;
}

/** Does a spec path match a pattern ("body.*" matches "body.2", not "body.2.children.0")? */
export function pathMatches(pattern: string, path: string): boolean {
  const a = pattern.split(".");
  const b = path.split(".");
  return a.length === b.length && a.every((seg, i) => seg === "*" || seg === b[i]);
}

/** Screens the prototype points at, in document order. */
export function protoScreens(doc: Doc, p: Prototype | undefined = doc.proto): string[] {
  if (!p) return [];
  const used = new Set<string>();
  if (p.start) used.add(p.start);
  for (const l of p.links) {
    used.add(l.from.screen);
    if (typeof l.to === "object" && "screen" in l.to) used.add(l.to.screen);
  }
  for (const t of p.tracks) used.add(t.target.screen);
  for (const id of Object.keys(p.states)) used.add(id);
  for (const [id, r] of Object.entries(p.routes ?? {})) {
    used.add(id);
    for (const ru of r.rules) for (const a of ru.then) if (a.do === "go") used.add(a.screen);
  }
  // A route's overlays and add-ons play inside their screen, never as screens of their own.
  const parts = new Set(Object.values(p.routes ?? {}).flatMap((r) => [...Object.values(r.overlays), ...Object.values(r.addOns)].map((x) => x.frame)));
  return doc.roots.filter((id) => used.has(id) && !parts.has(id));
}

/** Where Prototype mode starts among `screens`: the prototype's start, else the first screen a link leaves from, else the first. */
export function startScreen(p: Prototype | undefined, screens: string[]): string | undefined {
  if (p?.start && screens.includes(p.start)) return p.start;
  const from = p?.links.find((l) => screens.includes(l.from.screen))?.from.screen;
  return from ?? screens[0];
}
