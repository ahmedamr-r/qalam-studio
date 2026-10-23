import { useEffect, useState } from "react";
import type { ContrastFailure } from "@/design-system/contrast";
import { expandKnobs, interviewDocs, systemFonts } from "@/design-system/interview/expand";
import { knobHash, type Knobs, type ReadBack } from "@/design-system/interview/knobs";
import { scenarios, type Scenario } from "@/design-system/interview/scenarios";
import type { DesignSystem } from "@/design-system/registry";
import type { SceneNode } from "@/doc/schema";
import { screenRender } from "../componentPreviews";

/**
 * Previews for the interview: a system expanded from knobs (cached by their hash) and screens drawn
 * with it (cached by hash, screen and size). Drawing is serial and prioritised: what the designer
 * committed first, then what they hover, then idle prefetch; a newer hover drops older ones.
 */

export interface Rendered {
  url: string;
  w: number;
  h: number;
  nodes: SceneNode[];
}

interface Draft {
  ds: DesignSystem;
  failures: ContrastFailure[];
  notes: string[];
}

function lru<V>(max: number, evict?: (v: V) => void) {
  const m = new Map<string, V>();
  return {
    get(k: string) {
      const v = m.get(k);
      if (v !== undefined) {
        m.delete(k);
        m.set(k, v);
      }
      return v;
    },
    set(k: string, v: V) {
      m.delete(k);
      m.set(k, v);
      while (m.size > max) {
        const [old, ov] = m.entries().next().value!;
        m.delete(old);
        evict?.(ov);
      }
    },
  };
}

const drafts = lru<Draft>(32);

/** The system a set of knobs makes, ready to draw with (not saved anywhere). */
export function draftSystem(k: Knobs, read: ReadBack): Draft {
  const key = knobHash(k) + read.platform;
  const hit = drafts.get(key);
  if (hit) return hit;
  const { tree, notes, failures } = expandKnobs(k, { platform: read.platform });
  const ds: DesignSystem = {
    id: `draft-${knobHash(k)}`,
    name: read.slots.brand,
    source: "interview",
    tree,
    docs: interviewDocs(read, k, read.slots.brand),
    fonts: systemFonts(k),
    createdAt: 0,
    updatedAt: 0,
  };
  const d = { ds, failures, notes };
  drafts.set(key, d);
  return d;
}

const scenarioCache = new Map<string, Scenario[]>();
/** The preview screens for a read (same read, same list). */
export function scenariosFor(read: ReadBack): Scenario[] {
  const key = JSON.stringify([read.domain, read.platform, read.scripts, read.slots]);
  let s = scenarioCache.get(key);
  if (!s) {
    s = scenarios(read);
    scenarioCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Drawing

export type Priority = "commit" | "hover" | "prefetch";
const RANK: Record<Priority, number> = { commit: 0, hover: 1, prefetch: 2 };

const renders = lru<Rendered>(48, (r) => URL.revokeObjectURL(r.url));
const pending = new Map<string, Promise<Rendered | null>>();

interface Job {
  key: string;
  priority: Priority;
  run: () => Promise<Rendered | null>;
  resolve: (r: Rendered | null) => void;
}
let jobs: Job[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (jobs.length) {
    jobs.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
    const job = jobs.shift()!;
    let out: Rendered | null = null;
    try {
      out = await job.run();
    } catch {
      out = null;
    }
    pending.delete(job.key);
    if (out) renders.set(job.key, out);
    job.resolve(out);
    // Let input through between renders.
    await new Promise((r) => setTimeout(r, 0));
  }
  running = false;
}

const hashStr = (str: string) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
// The screens' content depends on the read's slots, so they're part of the key.
const keyOf = (k: Knobs, read: ReadBack, s: Scenario, maxSide: number) => `${knobHash(k)}|${read.platform}|${s.id}|${hashStr(JSON.stringify(s.spec))}|${maxSide}`;

/** A cached render, if there is one (no drawing). */
export const cachedRender = (k: Knobs, read: ReadBack, s: Scenario, maxSide: number) => renders.get(keyOf(k, read, s, maxSide)) ?? null;

/** Draw a screen with the knobs' system (cached; queued by priority). */
export function renderScenario(k: Knobs, read: ReadBack, s: Scenario, maxSide: number, priority: Priority = "commit"): Promise<Rendered | null> {
  const key = keyOf(k, read, s, maxSide);
  const hit = renders.get(key);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight) {
    // Asked again with more urgency: move it up.
    const j = jobs.find((x) => x.key === key);
    if (j && RANK[priority] < RANK[j.priority]) j.priority = priority;
    return inFlight;
  }
  if (priority === "hover") {
    // Only the latest hover matters.
    for (const j of jobs.filter((x) => x.priority === "hover")) {
      pending.delete(j.key);
      j.resolve(null);
    }
    jobs = jobs.filter((x) => x.priority !== "hover");
  }
  const p = new Promise<Rendered | null>((resolve) => {
    jobs.push({ key, priority, resolve, run: () => screenRender(s.spec, draftSystem(k, read).ds, maxSide) });
  });
  pending.set(key, p);
  void pump();
  return p;
}

/** The render for knobs on a screen, kept while a newer one draws. */
export function useRender(k: Knobs | null, read: ReadBack | undefined, s: Scenario | undefined, maxSide: number, priority: Priority = "commit"): Rendered | null {
  const [out, setOut] = useState<Rendered | null>(() => (k && read && s ? cachedRender(k, read, s, maxSide) : null));
  useEffect(() => {
    if (!k || !read || !s) return;
    let live = true;
    const hit = cachedRender(k, read, s, maxSide);
    if (hit) setOut(hit);
    else
      void renderScenario(k, read, s, maxSide, priority).then((r) => {
        if (live && r) setOut(r);
      });
    return () => {
      live = false;
    };
  }, [k, read, s, maxSide, priority]);
  return out;
}
