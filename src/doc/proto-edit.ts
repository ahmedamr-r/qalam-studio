/**
 * Editing the prototype by hand (the Prototype tab). The ops are pure: each takes the prototype
 * and returns the next one, sharing what it didn't touch, or `p` itself when nothing changes.
 * Links and tracks are addressed by their index in `p.links` / `p.tracks`, states by screen and
 * name. `editProto` applies an op to the document as one undo step (autosaved with it).
 */
import { DEFAULT_DELAY, DEFAULT_STATE, MAX_LINKS, MAX_STATE_NAME, MAX_STATES, MAX_TRACKS, emptyProto, isSpecPath, parseStateKey, pathMatches } from "./proto";
import type { Doc, MotionRef, ProtoLink, ProtoRef, ProtoTrack, ProtoTransitionKind, ProtoTrigger, Prototype, TrackPreset } from "./schema";
import { studio } from "./store";
import { isSealed } from "./board";

// ---------------------------------------------------------------------------
// Reading the document

/** A screen: a top-level frame that isn't a group, nor a Discovery card or sticky. */
export const isScreen = (doc: Doc, id: string): boolean => {
  const n = doc.nodes[id];
  return n?.type === "frame" && !n.parentId && !n.meta.group && !isSealed(n);
};

export const screenIds = (doc: Doc): string[] => doc.roots.filter((id) => isScreen(doc, id));

/** The components on a screen in layer order: each spec path ("header.0", "body.1.children.0"…) with its layer. */
export function componentsOf(doc: Doc, screen: string): { path: string; id: string }[] {
  const out: { path: string; id: string }[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const p = doc.nodes[c]?.meta.specPath;
      if (p !== undefined && isSpecPath(p) && !seen.has(p)) {
        seen.add(p);
        out.push({ path: p, id: c });
      }
      walk(c);
    }
  };
  walk(screen);
  return out;
}

export const componentPaths = (doc: Doc, screen: string): string[] => componentsOf(doc, screen).map((c) => c.path);

/** The layer of the component at a spec path on a screen. */
export function componentAt(doc: Doc, screen: string, path: string): string | undefined {
  let hit: string | undefined;
  const walk = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      if (hit) return;
      if (doc.nodes[c]?.meta.specPath === path) hit = c;
      else walk(c);
    }
  };
  walk(screen);
  return hit;
}

/**
 * What the Prototype tab edits for a selection: the screen it is on and the component it is in,
 * if any (`node` is that component's layer, or the screen). Links start from either. Null for no
 * selection, several layers, or a layer that isn't on a screen.
 */
export function protoScope(doc: Doc, selection: string[]): { screen: string; path?: string; node: string } | null {
  if (selection.length !== 1) return null;
  let n = doc.nodes[selection[0]];
  if (!n) return null;
  let path: string | undefined;
  let node = n.id;
  while (n.parentId) {
    if (path === undefined && n.meta.specPath !== undefined && isSpecPath(n.meta.specPath)) {
      path = n.meta.specPath;
      node = n.id;
    }
    const parent = doc.nodes[n.parentId];
    if (!parent) return null;
    n = parent;
  }
  if (!isScreen(doc, n.id)) return null;
  return path !== undefined ? { screen: n.id, path, node } : { screen: n.id, node: n.id };
}

// ---------------------------------------------------------------------------
// Links

const isStateLink = (l: ProtoLink, name?: string) => typeof l.to === "object" && "state" in l.to && (name === undefined || l.to.state === name);
/** What a link does, for telling an edit that changes nothing. */
const linkKey = (l: ProtoLink) => JSON.stringify([l.from.screen, l.from.path ?? null, l.on, l.on === "delay" ? (l.after ?? null) : null, l.to, l.transition.kind, l.transition.motion]);
const clampDelay = (ms: number) => Math.round(Math.min(60_000, Math.max(0, Number.isFinite(ms) ? ms : DEFAULT_DELAY)));

/** Links leaving a screen, from anywhere on it (`path` undefined) or from one component, with their indices. */
export function linksFrom(p: Prototype | undefined, screen: string, path?: string): { link: ProtoLink; index: number }[] {
  return (p?.links ?? []).flatMap((link, index) => (link.from.screen === screen && (path === undefined || link.from.path === path) ? [{ link, index }] : []));
}

/** A new link from `from`: tap → the next screen in the document (else back), smart, spring.gentle. */
export function newLink(doc: Doc, from: ProtoRef): ProtoLink {
  const at = doc.roots.indexOf(from.screen);
  const others = screenIds(doc).filter((id) => id !== from.screen);
  const next = others.find((id) => doc.roots.indexOf(id) > at) ?? others[0];
  return { from, on: "tap", to: next ? { screen: next } : "back", transition: { kind: "smart", motion: "native" } };
}

export function addLink(p: Prototype, link: ProtoLink): Prototype {
  if (p.links.length >= MAX_LINKS || (link.from.path !== undefined && !isSpecPath(link.from.path))) return p;
  return { ...p, links: [...p.links, link] };
}

export interface LinkPatch {
  from?: ProtoRef;
  on?: ProtoTrigger;
  /** ms, for delay links. */
  after?: number;
  to?: ProtoLink["to"];
  kind?: ProtoTransitionKind;
  motion?: MotionRef;
}

/** Change a link. A delay link always has its delay (800 ms when it becomes one); other triggers drop it. */
export function updateLink(p: Prototype, index: number, patch: LinkPatch): Prototype {
  const cur = p.links[index];
  if (!cur || (patch.from?.path !== undefined && !isSpecPath(patch.from.path))) return p;
  const on = patch.on ?? cur.on;
  const next: ProtoLink = { from: patch.from ?? cur.from, on, to: patch.to ?? cur.to, transition: { kind: patch.kind ?? cur.transition.kind, motion: patch.motion ?? cur.transition.motion } };
  if (on === "delay") next.after = clampDelay(patch.after ?? cur.after ?? DEFAULT_DELAY);
  if (linkKey(next) === linkKey(cur)) return p;
  const links = p.links.slice();
  links[index] = next;
  return { ...p, links };
}

export function removeLink(p: Prototype, index: number): Prototype {
  if (!p.links[index]) return p;
  return { ...p, links: p.links.filter((_, i) => i !== index) };
}

/** Why a link wouldn't play (null when it would): its component, screen or state is gone. */
export function linkProblem(doc: Doc, p: Prototype | undefined, l: ProtoLink): string | null {
  if (l.from.path !== undefined && !componentAt(doc, l.from.screen, l.from.path)) return `Nothing on the screen is at ${l.from.path}`;
  if (l.to === "back") return null;
  if ("screen" in l.to) return isScreen(doc, l.to.screen) ? null : "Its screen is gone";
  if (l.to.state !== DEFAULT_STATE && !statesOf(p, l.from.screen).includes(l.to.state)) return `The screen has no state “${l.to.state}”`;
  return null;
}

// ---------------------------------------------------------------------------
// Start

/** Where Prototype mode starts (undefined: the first screen a link leaves from). */
export function setStart(p: Prototype, screen: string | undefined): Prototype {
  if (p.start === screen) return p;
  const { start: _old, ...rest } = p;
  return screen ? { ...rest, start: screen } : rest;
}

// ---------------------------------------------------------------------------
// States

/** A screen's named states, in the order they were made ("default" is the screen as it is). */
export const statesOf = (p: Prototype | undefined, screen: string): string[] => Object.keys(p?.states[screen] ?? {});

/** Why a screen's state can't be called `name` (null when it can); `current` is the state being renamed. */
export function stateNameError(p: Prototype | undefined, screen: string, name: string, current?: string): string | null {
  const n = name.trim();
  if (!n) return "Name the state";
  if (n.length > MAX_STATE_NAME) return `Keep it under ${MAX_STATE_NAME} characters`;
  if (n === DEFAULT_STATE) return `“${DEFAULT_STATE}” is the screen as it is`;
  if (n !== current && statesOf(p, screen).includes(n)) return "Another state has that name";
  return null;
}

/**
 * Add a named state to a screen: `name`, or the first free "State N". It changes nothing until
 * props are set in it. `name` is "" when no state was added (a bad name, or the screen is full).
 */
export function addState(p: Prototype, screen: string, name?: string): { proto: Prototype; name: string } {
  const names = statesOf(p, screen);
  if (names.length >= MAX_STATES) return { proto: p, name: "" };
  let n = name?.trim() ?? "";
  if (name !== undefined && stateNameError(p, screen, n)) return { proto: p, name: "" };
  if (!n) {
    let i = 1;
    while (names.includes(`State ${i}`)) i++;
    n = `State ${i}`;
  }
  return { proto: { ...p, states: { ...p.states, [screen]: { ...p.states[screen], [n]: {} } } }, name: n };
}

/** Rename a state; the screen's links into it follow. Unchanged when the new name is taken or invalid. */
export function renameState(p: Prototype, screen: string, from: string, to: string): Prototype {
  const states = p.states[screen];
  const name = to.trim();
  if (!states || !(from in states) || name === from || stateNameError(p, screen, name, from)) return p;
  const renamed = Object.fromEntries(Object.entries(states).map(([k, v]) => [k === from ? name : k, v]));
  const links = p.links.map((l) => (l.from.screen === screen && isStateLink(l, from) ? { ...l, to: { state: name } } : l));
  return { ...p, states: { ...p.states, [screen]: renamed }, links };
}

/** Remove a state and the screen's links into it (undo brings both back). */
export function removeState(p: Prototype, screen: string, name: string): Prototype {
  const states = p.states[screen];
  if (!states || !(name in states)) return p;
  const rest = Object.fromEntries(Object.entries(states).filter(([k]) => k !== name));
  const all = { ...p.states };
  if (Object.keys(rest).length) all[screen] = rest;
  else delete all[screen];
  return { ...p, states: all, links: p.links.filter((l) => !(l.from.screen === screen && isStateLink(l, name))) };
}

const stateKey = (path: string, prop: string) => `${path}.props.${prop}`;

/** What a state sets: each component prop it changes, in the order they were set. */
export function stateChanges(p: Prototype | undefined, screen: string, state: string): { path: string; prop: string; value: unknown }[] {
  return Object.entries(p?.states[screen]?.[state] ?? {}).flatMap(([k, value]) => {
    const ref = parseStateKey(k);
    return ref ? [{ ...ref, value }] : [];
  });
}

/** Set a component's prop in a state (body.1 › current = 3). */
export function setStateProp(p: Prototype, screen: string, state: string, path: string, prop: string, value: unknown): Prototype {
  const diff = p.states[screen]?.[state];
  const key = stateKey(path, prop);
  if (!diff || !parseStateKey(key) || value === undefined || Object.is(diff[key], value)) return p;
  return { ...p, states: { ...p.states, [screen]: { ...p.states[screen], [state]: { ...diff, [key]: value } } } };
}

/** Back to the component's own value in that state. */
export function clearStateProp(p: Prototype, screen: string, state: string, path: string, prop: string): Prototype {
  const diff = p.states[screen]?.[state];
  const key = stateKey(path, prop);
  if (!diff || !(key in diff)) return p;
  const rest = Object.fromEntries(Object.entries(diff).filter(([k]) => k !== key));
  return { ...p, states: { ...p.states, [screen]: { ...p.states[screen], [state]: rest } } };
}

// ---------------------------------------------------------------------------
// Tracks

const trackKey = (t: ProtoTrack) => JSON.stringify([t.target.screen, t.target.path ?? null, t.preset, t.motion, t.stagger ?? 0]);

/** A screen's tracks (`path` undefined), or the ones that play on one component: its own and wildcards that cover it. */
export function tracksOf(p: Prototype | undefined, screen: string, path?: string): { track: ProtoTrack; index: number }[] {
  return (p?.tracks ?? []).flatMap((track, index) =>
    track.target.screen === screen && (path === undefined || (track.target.path !== undefined && pathMatches(track.target.path, path))) ? [{ track, index }] : [],
  );
}

/** A new track: a component fades up; a screen's body sections fade up in turn (the whole screen when it has one section or none). */
export function newTrack(doc: Doc, screen: string, path?: string): ProtoTrack {
  if (path !== undefined) return { target: { screen, path }, preset: "fade-up", motion: "medium.emphasized" };
  const sections = componentPaths(doc, screen).filter((x) => /^body\.\d+$/.test(x));
  return sections.length > 1
    ? { target: { screen, path: "body.*" }, preset: "fade-up", stagger: 60, motion: "medium.emphasized" }
    : { target: { screen }, preset: "fade-up", motion: "medium.emphasized" };
}

export function addTrack(p: Prototype, track: ProtoTrack): Prototype {
  if (p.tracks.length >= MAX_TRACKS || (track.target.path !== undefined && !isSpecPath(track.target.path, true))) return p;
  return { ...p, tracks: [...p.tracks, track] };
}

export interface TrackPatch {
  target?: ProtoRef;
  preset?: TrackPreset;
  motion?: MotionRef;
  /** ms between the components a wildcard matches; 0 removes it. */
  stagger?: number;
}

/** Change a track. Only a wildcard target keeps a stagger (one component has nothing to stagger). */
export function updateTrack(p: Prototype, index: number, patch: TrackPatch): Prototype {
  const cur = p.tracks[index];
  if (!cur || (patch.target?.path !== undefined && !isSpecPath(patch.target.path, true))) return p;
  const next: ProtoTrack = { target: patch.target ?? cur.target, preset: patch.preset ?? cur.preset, motion: patch.motion ?? cur.motion };
  const stagger = patch.stagger ?? cur.stagger;
  if (stagger && stagger > 0 && next.target.path?.includes("*")) next.stagger = Math.round(Math.min(2000, stagger));
  if (trackKey(next) === trackKey(cur)) return p;
  const tracks = p.tracks.slice();
  tracks[index] = next;
  return { ...p, tracks };
}

export function removeTrack(p: Prototype, index: number): Prototype {
  if (!p.tracks[index]) return p;
  return { ...p, tracks: p.tracks.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------------------
// Applying an edit

const isEmpty = (p: Prototype) => !p.links.length && !p.tracks.length && !Object.keys(p.states).length && !p.keys && !p.start;

/**
 * Apply an op to the document's prototype as one undo step; a prototype left with nothing in it is
 * removed. `live` edits (a scrubbed delay) join one transaction until studio().commitTx().
 */
export function editProto(op: (p: Prototype) => Prototype, opts?: { live?: boolean }): void {
  const cur = studio().doc.proto;
  const next = op(cur ?? emptyProto());
  if (next === cur || (!cur && isEmpty(next))) return;
  if (opts?.live) studio().beginTx();
  studio().mutate((d) => {
    if (isEmpty(next)) delete d.proto;
    else d.proto = next;
  });
}
