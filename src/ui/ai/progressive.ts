import type { ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes } from "@/design-system/place";
import { firstComponents, partialGenerate, specPaths, type PartialGenerate } from "@/design-system/partial-spec";
import type { Platform } from "@/design-system/platform";
import { worldBounds, type Box } from "@/doc/geometry";
import { clearGhosts, setGhost } from "@/doc/ghosts";
import type { Doc } from "@/doc/schema";

/**
 * Builds screens on the canvas while the model is still writing them. Each tick takes the latest
 * partial answer, reveals the next few components in reading order and redraws that screen as a
 * ghost (src/doc/ghosts.ts). Components are revealed at a readable pace even when the answer
 * arrives in one burst, and screens start one after another, like one designer at work.
 *
 * If the model starts its answer over (the CLI retries when an answer fails its schema check), the
 * screens already built stay up and each is swapped for its new version once that is complete:
 * starting again from empty frames would look like a second generation.
 */

export interface BuiltElement {
  variant: number;
  specPath: string;
  name: string;
  component: string;
}

export interface ProgressiveOpts {
  turnId: string;
  /** The system the screens are drawn with (without a design system, set once the look is picked: setSystem). */
  dsId: string;
  platform: Platform;
  /** World position of each screen, left to right. */
  slotAt: (index: number) => { x: number; y: number };
  reservationId?: string;
  onApproach?: (text: string, done: boolean) => void;
  onScreen?: (index: number, name: string, rationale: string, rationaleDone: boolean) => void;
  onCreated?: (e: BuiltElement, box: Box) => void;
  /** Where the work is happening now (the newest element, or a screen that just started). */
  onTarget?: (box: Box, index: number) => void;
}

interface Shown {
  count: number;
  key: string;
  spec?: ScreenSpec;
  paths: Set<string>;
  /** The screen's frame as last built, in world coordinates. */
  frame?: Box;
}

const MIN_TICK = 150;

export function createProgressiveBuild(o: ProgressiveOpts) {
  let latest: PartialGenerate | null = null;
  let dsId = o.dsId;
  let shown: Shown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastBuildMs = 0;
  let stopped = false;
  let revising = false;
  let drain: { resolve: () => void; until: number } | null = null;

  const tickMs = () => Math.max(MIN_TICK, lastBuildMs * 4);
  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(tick, tickMs());
  };

  const totals = () => latest!.variants.map((v) => (v.buildable ? specPaths(v.spec).length : 0));

  /** Build screen `i` as a ghost; `announce` lists its new elements (off while revising: they were listed). */
  function build(i: number, spec: ScreenSpec, announce = true) {
    const t0 = performance.now();
    let nodes;
    try {
      nodes = buildScreenNodes(spec, dsId, o.slotAt(i), "ai");
    } catch {
      return;
    }
    const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
    setGhost({ key: `${o.turnId}:${i}`, turnId: o.turnId, index: i, reservationId: o.reservationId, doc });
    lastBuildMs = performance.now() - t0;

    const s = shown[i];
    s.frame = worldBounds(doc, nodes[0].id);
    if (!announce) {
      for (const p of specPaths(spec)) s.paths.add(p);
      o.onTarget?.(s.frame, i);
      return;
    }
    // What's new since the last build of this screen, in reading order.
    const byPath = new Map(nodes.filter((n) => n.meta.specPath).map((n) => [n.meta.specPath!, n]));
    let target: Box | null = null;
    for (const p of specPaths(spec)) {
      if (s.paths.has(p)) continue;
      s.paths.add(p);
      const n = byPath.get(p);
      if (!n) continue;
      const box = worldBounds(doc, n.id);
      target = box;
      o.onCreated?.({ variant: i, specPath: p, name: n.name, component: n.meta.component ?? n.name }, box);
    }
    if (!target && s.paths.size === 0) {
      const f = worldBounds(doc, nodes[0].id);
      target = { x: f.x, y: f.y, w: f.w, h: Math.min(f.h, 120) };
    }
    if (target) o.onTarget?.(target, i);
  }

  /** After a restart: swap in each screen once its new version is complete; point at the one being rewritten. */
  function reviseTick() {
    const vars = latest!.variants;
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      if (!v.done) {
        // Still being rewritten: the cursor waits at the top of that screen.
        const f = shown[i]?.frame;
        const at = o.slotAt(i);
        o.onTarget?.(f ? { x: f.x, y: f.y, w: f.w, h: Math.min(f.h, 120) } : { x: at.x, y: at.y, w: 1, h: 1 }, i);
        break;
      }
      const s = (shown[i] ??= { count: 0, key: "", paths: new Set() });
      const key = JSON.stringify(v.spec);
      if (key === s.key) continue;
      s.key = key;
      s.spec = v.spec;
      s.count = specPaths(v.spec).length;
      build(i, v.spec, false);
    }
    const complete = vars.length > 0 && vars.every((v, i) => v.done && shown[i]?.key === JSON.stringify(v.spec));
    if (!complete) schedule();
    else if (drain) {
      drain.resolve();
      drain = null;
    }
  }

  function tick() {
    timer = undefined;
    if (stopped || !latest) return;
    const vars = latest.variants;
    o.onApproach?.(latest.approach, latest.approachDone);
    vars.forEach((v, i) => o.onScreen?.(i, v.name, v.rationale, v.rationaleDone));
    if (revising) return reviseTick();

    const total = totals();
    const behind = total.reduce((sum, t, i) => sum + t - (shown[i]?.count ?? 0), 0);
    let step = behind > 24 ? 3 : behind > 8 ? 2 : 1;
    if (drain) step = Math.max(step, Math.ceil(behind / Math.max(1, (drain.until - Date.now()) / tickMs())));

    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      if (!v.buildable) break;
      // Screens start one after another: wait until the one before is fully shown.
      if (i > 0 && (shown[i - 1]?.count ?? 0) < total[i - 1]) break;
      const s = (shown[i] ??= { count: 0, key: "", paths: new Set() });
      const add = Math.min(step, total[i] - s.count);
      s.count += add;
      step -= add;
      const spec = firstComponents(v.spec, s.count);
      const key = JSON.stringify(spec);
      if (key !== s.key) {
        s.key = key;
        s.spec = spec;
        build(i, spec);
      }
      if (step <= 0) break;
    }

    const left = total.reduce((sum, t, i) => sum + t - (shown[i]?.count ?? 0), 0);
    if (left > 0) schedule();
    else if (drain) {
      drain.resolve();
      drain = null;
    }
  }

  return {
    /** The latest partial answer (see parsePartial). */
    push(value: unknown) {
      latest = partialGenerate(value, o.platform);
      schedule();
    },
    /** The answer starts over (a retry): drop what was shown. */
    reset() {
      latest = null;
      shown = [];
      revising = false;
      clearGhosts(o.turnId);
    },
    /**
     * The model started its answer over: keep what's on the canvas and replace each screen when
     * its new version is complete. Before anything was built, this is a plain restart.
     */
    revise() {
      latest = null;
      if (shown.some((s) => s.spec)) revising = true;
      else shown = [];
    },
    get revising() {
      return revising;
    },
    /** Draw with another system from now on (the look Qalam AI just picked). */
    setSystem(id: string) {
      dsId = id;
    },
    /** The complete answer: show the rest quickly (within `maxMs`), then resolve. */
    finish(value: unknown, maxMs = 2500): Promise<void> {
      latest = partialGenerate(value, o.platform);
      return new Promise((resolve) => {
        if (stopped) return resolve();
        const done = () => {
          if (drain?.resolve === done) drain = null;
          resolve();
        };
        drain = { resolve: done, until: Date.now() + maxMs };
        setTimeout(done, maxMs + 400);
        clearTimeout(timer);
        timer = undefined;
        tick();
      });
    },
    /** What's on the canvas now, one spec per screen with anything built. */
    snapshot(): ScreenSpec[] {
      return shown.filter((s) => s.spec && s.count > 0).map((s) => s.spec!);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      drain?.resolve();
      drain = null;
    },
  };
}
