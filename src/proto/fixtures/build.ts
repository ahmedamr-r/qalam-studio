/**
 * Building a fixture route (tests): a screen and its parts as the studio places them — the parts
 * in a row under the screen — then the route its recipes make, one after another, from what a
 * scan of each frame finds. Fixtures are written by product kind (a ride, a transfer, a shop) so
 * every recipe is checked on several (see recipes.test.ts).
 */
import type { ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes } from "@/design-system/place";
import type { Doc, RouteProto, VarDef } from "@/doc/schema";
import { PART_DROP, PART_GAP } from "../edit";
import { applyDelta, type RouteDelta } from "../recipes";
import { DEFAULT_DISMISS, TOAST_MS } from "../routes";
import { scanFrame, type FrameScan } from "../scan";

export interface Fixture {
  doc: Doc;
  screen: string;
  /** Part id → its frame. */
  frames: Record<string, string>;
  /** What a scan finds on the screen, and on each part. */
  scan: FrameScan;
  scanOf: (part: string) => FrameScan;
  /** Recipes that couldn't apply, and why. */
  skipped: string[];
}

/** A recipe as a fixture applies it: given the route so far and the fixture. */
export type Step = (route: RouteProto, f: Fixture) => RouteDelta;

/** A fixture: a screen, its parts by id, and the recipes that make its route. */
export interface FixtureDef {
  screen: ScreenSpec;
  parts: Record<string, ScreenSpec>;
  steps: Step[];
}

/** A fixture built in a document of its own. */
export const fixture = (def: FixtureDef): Fixture => build(def.screen, def.parts, def.steps);

/**
 * The route a fixture's recipes make over a screen already in `doc` (its parts there by the same
 * ids) — how the studio loads one: from the route it has (its parts), adding each recipe's part.
 */
export function routeFrom(doc: Doc, screen: string, frames: Record<string, string>, steps: Step[]): { route: RouteProto; appVars: Record<string, VarDef>; skipped: string[] } {
  const scans = new Map<string, FrameScan>();
  const f: Fixture = {
    doc,
    screen,
    frames,
    scan: scanFrame(doc, screen),
    scanOf: (part) => {
      if (!scans.has(part)) scans.set(part, scanFrame(doc, frames[part]));
      return scans.get(part)!;
    },
    skipped: [],
  };
  let route: RouteProto = doc.proto?.routes?.[screen] ?? { overlays: {}, addOns: {}, rules: [] };
  let appVars: Record<string, VarDef> = {};
  for (const step of steps) {
    const d = step(route, f);
    if (d.skipped) {
      f.skipped.push(d.skipped);
      continue;
    }
    route = applyDelta(route, d);
    appVars = { ...appVars, ...d.appVars };
  }
  return { route, appVars, skipped: f.skipped };
}

function build(screen: ScreenSpec, parts: Record<string, ScreenSpec>, steps: Step[]): Fixture {
  const doc: Doc = { nodes: {}, roots: [] };
  const add = (spec: ScreenSpec, at: { x: number; y: number }) => {
    const nodes = buildScreenNodes(spec, "builtin", at, "ai");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    return nodes[0];
  };
  const root = add(screen, { x: 0, y: 0 });
  const route: RouteProto = { overlays: {}, addOns: {}, rules: [] };
  const frames: Record<string, string> = {};
  let x = 0;
  for (const [part, spec] of Object.entries(parts)) {
    const n = add(spec, { x, y: root.h + PART_DROP });
    x += n.w + PART_GAP;
    frames[part] = n.id;
    const kind = spec.surface ?? "sheet";
    if (kind === "bar") route.addOns[part] = { frame: n.id, region: "bottom" };
    else route.overlays[part] = { frame: n.id, kind, dismiss: [...DEFAULT_DISMISS[kind]], ...(kind === "toast" ? { ms: TOAST_MS } : {}) };
  }
  doc.proto = { links: [], states: {}, tracks: [], start: root.id, routes: { [root.id]: route } };
  const built = routeFrom(doc, root.id, frames, steps);
  doc.proto = { ...doc.proto, routes: { [root.id]: built.route }, ...(Object.keys(built.appVars).length ? { vars: built.appVars } : {}) };
  const scans = new Map<string, FrameScan>();
  return {
    doc,
    screen: root.id,
    frames,
    scan: scanFrame(doc, root.id),
    scanOf: (part) => {
      if (!scans.has(part)) scans.set(part, scanFrame(doc, frames[part]));
      return scans.get(part)!;
    },
    skipped: built.skipped,
  };
}

/** A text's spec, shorter. */
export const text = (t: string, style = "body", tone = "primary") => ({ component: "Text", props: { text: t, style, tone } });
