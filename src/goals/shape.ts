import type { OstMetric } from "@/discovery/types";
import { GOAL_LEVERS, GOAL_STATUSES, type Goal, type GoalPatch } from "./types";

/*
 * Goals as they may arrive over the network (pure): only what a goal can hold, clipped, or nothing.
 * What a window sends is never written as it is.
 */

const ID = /^[A-Za-z0-9_~-]{1,64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const GOAL_LIMITS = { title: 200, feeds: 300, cites: 40 } as const;

/** A goal's number, or null when it isn't one. */
export function metricShape(raw: unknown): OstMetric | null {
  if (!isObject(raw)) return null;
  const m: OstMetric = {
    name: text(raw.name, 120),
    direction: raw.direction === "decrease" ? "decrease" : "increase",
    baseline: numOrNull(raw.baseline),
    current: numOrNull(raw.current),
    target: numOrNull(raw.target),
  };
  const unit = text(raw.unit, 40);
  if (unit) m.unit = unit;
  const timeframe = text(raw.timeframe, 60);
  if (timeframe) m.timeframe = timeframe;
  if (isObject(raw.source)) {
    const s = raw.source;
    const connector = text(s.connector, 40);
    const ref = text(s.ref, 200);
    if (connector && ref) m.source = { connector, ref, ...(text(s.url, 2000) ? { url: text(s.url, 2000) } : {}), ...(text(s.label, 200) ? { label: text(s.label, 200) } : {}), ...(text(s.series, 200) ? { series: text(s.series, 200) } : {}) };
  }
  const readAt = numOrNull(raw.readAt);
  if (readAt) m.readAt = readAt;
  return m;
}

const onShape = (v: unknown): Goal["on"] | null => (isObject(v) && id(v.board) && id(v.card) ? { board: v.board as string, card: v.card as string } : null);

export interface NewGoal {
  id?: string;
  title: string;
  parent?: string | null;
  product?: string | null;
  metric?: OstMetric;
  status?: Goal["status"];
  lever?: Goal["lever"];
  feeds?: string;
  on?: Goal["on"];
  cites?: string[];
  by?: Goal["by"];
  /** Make it the North Star (or, with "if-none", only when there isn't one yet). */
  north?: boolean | "if-none";
}

/** A goal to add, or null. */
export function newGoalShape(raw: unknown): NewGoal | null {
  if (!isObject(raw)) return null;
  const title = text(raw.title, GOAL_LIMITS.title);
  if (!title) return null;
  const g: NewGoal = { title };
  if (id(raw.id)) g.id = raw.id as string;
  if (raw.parent === null || id(raw.parent)) g.parent = (raw.parent as string | null) ?? null;
  if (raw.product === null || id(raw.product)) g.product = (raw.product as string | null) ?? null;
  const metric = metricShape(raw.metric);
  if (metric) g.metric = metric;
  if ((GOAL_STATUSES as readonly unknown[]).includes(raw.status)) g.status = raw.status as Goal["status"];
  if ((GOAL_LEVERS as readonly unknown[]).includes(raw.lever)) g.lever = raw.lever as Goal["lever"];
  const feeds = text(raw.feeds, GOAL_LIMITS.feeds);
  if (feeds) g.feeds = feeds;
  const on = onShape(raw.on);
  if (on) g.on = on;
  if (Array.isArray(raw.cites)) g.cites = [...new Set(raw.cites.filter((c): c is string => typeof c === "string" && c.length <= 200))].slice(0, GOAL_LIMITS.cites);
  if (raw.by === "qalam") g.by = "qalam";
  if (raw.north === true || raw.north === "if-none") g.north = raw.north;
  return g;
}

/** A change to a goal, or null when it changes nothing it can. */
export function goalPatchShape(raw: unknown): GoalPatch | null {
  if (!isObject(raw)) return null;
  const p: GoalPatch = {};
  if ("title" in raw) {
    const title = text(raw.title, GOAL_LIMITS.title);
    if (title) p.title = title;
  }
  if ("parent" in raw && (raw.parent === null || id(raw.parent))) p.parent = (raw.parent as string | null) ?? null;
  if ("product" in raw && (raw.product === null || id(raw.product))) p.product = (raw.product as string | null) ?? null;
  if ("metric" in raw) {
    const m = raw.metric === null ? null : metricShape(raw.metric);
    if (m || raw.metric === null) p.metric = m;
  }
  if ((GOAL_STATUSES as readonly unknown[]).includes(raw.status)) p.status = raw.status as Goal["status"];
  if ("lever" in raw && (raw.lever === null || (GOAL_LEVERS as readonly unknown[]).includes(raw.lever))) p.lever = raw.lever as GoalPatch["lever"];
  if ("feeds" in raw) p.feeds = text(raw.feeds, GOAL_LIMITS.feeds) || null;
  if ("on" in raw) {
    const on = raw.on === null ? null : onShape(raw.on);
    if (on || raw.on === null) p.on = on;
  }
  if (Array.isArray(raw.cites)) p.cites = [...new Set(raw.cites.filter((c): c is string => typeof c === "string" && c.length <= 200))].slice(0, GOAL_LIMITS.cites);
  if (raw.by === "qalam" || raw.by === "person") p.by = raw.by;
  return Object.keys(p).length ? p : null;
}
