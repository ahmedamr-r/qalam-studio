/**
 * Takes: the alternatives Generate drew for one screen are takes of one route, side by side. The
 * chosen one is the route — its prototype, its wires, its parts; the others wait, or are tucked
 * away. Using another take moves the route to it: its parts move under it, keeping what Qalam AI
 * wrote in them; its steps are built again by code on the take's own layers (what code can't build
 * again is said); where it went on to pages already designed, it still goes; and other screens
 * that went to the take before go to this one.
 */
import type { CompileOptions } from "@/codegen/compile";
import { worldBounds } from "@/doc/geometry";
import { emptyProto } from "@/doc/proto";
import type { Doc, Prototype, RouteAction, RouteProto, RouteRef, TakeGroup, VarDef } from "@/doc/schema";
import { studio } from "@/doc/store";
import { buildSteps } from "./agent/build";
import { candidates, type Candidate } from "./agent/candidates";
import { queueAsks } from "./asks";
import { RECIPE_NAMES } from "./recipes";
import { newRuleId, partFrames } from "./routes";

/** The takes a frame is one of. */
export const takeGroupOf = (doc: Doc, frame: string): TakeGroup | undefined => doc.proto?.takes?.find((g) => g.frames.includes(frame));

/** The prototype with `frames` as takes of one screen, the first chosen. */
export function withTakes(p: Prototype, frames: string[]): Prototype {
  return { ...p, takes: [...(p.takes ?? []).filter((g) => !g.frames.some((f) => frames.includes(f))), { frames, chosen: frames[0] }] };
}

/**
 * What a Generate answer places becomes: alternatives of a new screen are takes of one route (an
 * Arabic version of one isn't another take, nor are revised screens); what its brief asked to see
 * happen waits on the chosen take — or, with no new screens, on the screens it was about. Right
 * after the screens are placed, in their undo step.
 */
export function placeRoute(frames: string[], interactions: string[] | undefined, request: { screens?: { id: string }[]; lang?: string } | undefined) {
  const alts = request?.screens?.length ? [] : frames.slice(0, request?.lang === "both" ? -1 : undefined);
  if (alts.length > 1)
    studio().mutate(
      (d) => {
        d.proto = withTakes(d.proto ?? emptyProto(), alts);
      },
      { history: false },
    );
  queueAsks(alts.length > 1 ? [alts[0]] : frames.length ? frames : (request?.screens ?? []).map((s) => s.id), interactions, !frames.length);
}

export interface TakeReport {
  /** The steps built again on the take, and what couldn't be (by name). */
  rebuilt: string[];
  left: string[];
}

const sameRef = (a: RouteRef, b: RouteRef) => (a.part ?? "") === (b.part ?? "") && a.path === b.path && a.sub?.role === b.sub?.role && a.sub?.nth === b.sub?.nth;
const goes = (a: RouteAction): a is Extract<RouteAction, { do: "go" }> => a.do === "go";

/**
 * The document with `frame` the chosen take (see the file's comment), and what happened to the
 * steps; null when it's chosen already or isn't a take.
 */
export function chooseTakeDoc(doc: Doc, frame: string, opts: Pick<CompileOptions, "typography">): { doc: Doc; moved: Record<string, { x: number; y: number }>; report: TakeReport } | null {
  const g = takeGroupOf(doc, frame);
  if (!g || g.chosen === frame || !doc.nodes[frame]) return null;
  const from = g.chosen;
  const takes = doc.proto!.takes!.map((x) => (x === g ? { ...x, chosen: frame } : x));
  const route = doc.proto?.routes?.[from];
  // Other screens that went to the take go to this one.
  const retarget = (r: RouteProto): RouteProto =>
    r.rules.some((ru) => ru.then.some((a) => goes(a) && a.screen === from)) ? { ...r, rules: r.rules.map((ru) => ({ ...ru, then: ru.then.map((a) => (goes(a) && a.screen === from ? { ...a, screen: frame } : a)) })) } : r;
  const others = Object.fromEntries(Object.entries(doc.proto?.routes ?? {}).filter(([id]) => id !== from).map(([id, r]) => [id, retarget(r)]));
  if (!route) return { doc: { ...doc, proto: { ...doc.proto!, takes, routes: others } }, moved: {}, report: { rebuilt: [], left: [] } };

  // Its parts move under the take, as they sat under the one before.
  const a = worldBounds(doc, from);
  const b = worldBounds(doc, frame);
  const moved: Record<string, { x: number; y: number }> = {};
  const nodes = { ...doc.nodes };
  for (const p of partFrames(doc, from)) {
    const n = doc.nodes[p.frame];
    moved[p.frame] = { x: n.x + b.x - a.x, y: n.y + b.y - a.y };
    nodes[p.frame] = { ...n, ...moved[p.frame] };
  }
  // Where it went on to pages already designed, from its parts' layers (they stay as they are).
  const went = route.rules.flatMap((ru) => {
    const ref = "ref" in ru.when ? ru.when.ref : undefined;
    return ref?.part ? ru.then.filter(goes).map((x) => ({ when: ru.when, ref, to: x.screen, transition: x.transition })) : [];
  });
  const pages = Object.entries(route.next ?? {}).map(([page, np]) => ({ np, bar: route.rules.some((ru) => "ref" in ru.when && !!ru.when.ref.part && !!route.addOns[ru.when.ref.part] && ru.then.some((x) => x.do === "next" && x.page === page)) }));
  // The route keeps its parts and starts over on the take's own layers.
  let next: Doc = { ...doc, nodes, proto: { ...doc.proto!, takes, routes: { ...others, [frame]: { overlays: route.overlays, addOns: route.addOns, rules: [] } } } };
  // Its steps again, by recipe, in the parts it has (none new: a step that needs one is said).
  const had = (route.steps ?? []).map((s) => s.recipe);
  const wanted = new Set<string>(had);
  const picked = candidates(next, frame)
    .filter((c) => wanted.has(c.recipe) && (!c.needs || c.part))
    .map((c): Candidate => {
      if (c.recipe !== "nextPage") return c;
      // A page the take goes on to keeps its name and what it shows.
      const page = pages.find((p) => p.bar === (c.opts?.from === "bar"));
      return page ? { ...c, opts: { ...c.opts, name: page.np.name, brief: page.np.brief } } : c;
    });
  const built = buildSteps(next, frame, picked.map((candidate) => ({ candidate })), opts);
  const appVars: Record<string, VarDef> = built.appVars;
  next = { ...built.doc, proto: { ...built.doc.proto!, vars: { ...built.doc.proto?.vars, ...appVars } } };
  // Pages already designed: where the take goes on to one from the same layer, it goes to that page;
  // a layer of its parts that went to one (they're as they were) still does.
  const r = next.proto!.routes![frame];
  if (r && went.length) {
    let rules = r.rules;
    const done = new Set<string>();
    rules = rules.map((ru) => {
      if (!("ref" in ru.when)) return ru;
      const ref = ru.when.ref;
      const w = went.find((x) => sameRef(x.ref, ref));
      if (!w) return ru;
      return { ...ru, then: ru.then.map((x) => (x.do === "next" ? (done.add(x.page), { do: "go" as const, screen: w.to, transition: w.transition }) : x)) };
    });
    for (const w of went)
      if (!rules.some((ru) => "ref" in ru.when && sameRef(ru.when.ref, w.ref) && ru.then.some((x) => goes(x) && x.screen === w.to)))
        rules = [...rules, { id: newRuleId({ ...r, rules }), when: w.when, then: [{ do: "go", screen: w.to, transition: w.transition }] }];
    const nextPages = Object.fromEntries(Object.entries(r.next ?? {}).filter(([k]) => !done.has(k)));
    const steps = r.steps?.map((s) => (s.recipe === "nextPage" ? { ...s, label: s.label.replace(/,? not designed yet$/, "") } : s));
    const route2: RouteProto = { ...r, rules, ...(steps ? { steps } : {}) };
    if (Object.keys(nextPages).length) route2.next = nextPages;
    else delete route2.next;
    next = { ...next, proto: { ...next.proto!, routes: { ...next.proto!.routes, [frame]: route2 } } };
  }
  const name = (recipe: string) => RECIPE_NAMES[recipe] ?? recipe;
  const ok = new Set<string>(built.results.filter((x) => x.ok).map((x) => picked.find((c) => c.id === x.id)!.recipe));
  return { doc: next, moved, report: { rebuilt: [...ok].map(name), left: had.filter((x) => !ok.has(x)).map(name) } };
}

/** Use a take: the route moves to it, as one undo step; what happened to its steps comes back. */
export function chooseTake(frame: string, opts: Pick<CompileOptions, "typography">): TakeReport | null {
  const out = chooseTakeDoc(studio().doc, frame, opts);
  if (!out) return null;
  studio().mutate((d) => {
    d.proto = out.doc.proto;
    for (const [id, at] of Object.entries(out.moved)) {
      const n = d.nodes[id];
      if (n) Object.assign(n, at);
    }
  });
  return out.report;
}

/** Tuck the other takes away behind the chosen one, or bring them back. One undo step. */
export function collapseTakes(frame: string, collapsed: boolean) {
  studio().mutate((d) => {
    const g = d.proto?.takes?.find((x) => x.frames.includes(frame));
    if (!g) return;
    if (collapsed) g.collapsed = true;
    else delete g.collapsed;
  });
}
