import type { SceneNode } from "@/doc/schema";
import type { DesignDocs } from "./docs";
import type { Tree } from "./resolve";
import { TokenSet } from "./resolve";
import { STYLE_AXES, STYLE_BY_PATH } from "./styles";
import { applyChanges, type TokenChange } from "./tune";

/**
 * The extraction's compare-and-correct step, the part code decides. The model compares the
 * screenshot with its rebuild and proposes changes to the system; each one is tried on its own,
 * the screen is rebuilt with it, and it's kept only if the rebuild measurably gets closer to what
 * the screenshot clearly shows (its structure and measured sizes), without undoing anything that
 * was measured. The rebuild's spec is held fixed, so a better score can only come from the change.
 */

/** What the screenshot clearly shows (decided in structure.ts / measured in pixels.ts). */
export interface ShotFacts {
  /** Structure the pixels decided, by token path. */
  styles: Record<string, string>;
  nav?: { insetStart: number; insetEnd: number; radius: number; pill: boolean; height: number };
  /** Primary button, measured. */
  button?: { h: number; radius: number; pill: boolean };
}

/** What a rebuild draws, read from its layers. */
export interface RebuildFacts {
  /** Catalog components in the rebuild. */
  present: Set<string>;
  styles: Record<string, string>;
  nav?: { insetStart: number; insetEnd: number; radius: number; height: number };
  button?: { h: number; radius: number };
}

export interface Check {
  id: string;
  weight: number;
  /** 0 = matches the screenshot, 1 = as far off as it gets. */
  error: number;
}

const below = (nodes: SceneNode[], root: SceneNode): SceneNode[] => {
  const kids = nodes.filter((n) => n.parentId === root.id);
  return kids.flatMap((k) => [k, ...below(nodes, k)]);
};
const absX = (byId: Map<string, SceneNode>, n: SceneNode): number => (n.parentId && byId.has(n.parentId) ? absX(byId, byId.get(n.parentId)!) + n.x : 0);
const comp = (n: SceneNode) => n.meta?.component ?? "";
const radiusOf = (n: SceneNode) => (n as { radius?: { tl: { rx: number } } }).radius?.tl.rx ?? 0;

/** Read a rebuild's structure from its layers (as the builders name them). */
export function describeRebuild(nodes: SceneNode[]): RebuildFacts {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes[0];
  const facts: RebuildFacts = { present: new Set(), styles: {} };
  for (const n of nodes) {
    const c = comp(n).split("/")[0];
    if (c) facts.present.add(c === "ServiceTile" ? "ServiceGrid" : c);
  }
  const nav = nodes.find((n) => comp(n) === "BottomNav");
  if (nav) {
    const inside = below(nodes, nav);
    const bar = inside.find((n) => n.name === "Bar" && n.parentId === nav.id);
    facts.styles["component.nav-bar.style.placement"] = bar ? "floating" : "docked";
    const tabs = inside.filter((n) => n.name.startsWith("Tab/"));
    const labels = inside.filter((n) => n.type === "text").length;
    facts.styles["component.nav-bar.style.labels"] = labels === 0 ? "none" : labels < tabs.length ? "active" : "all";
    const mark = inside.find((n) => n.name === "Indicator");
    facts.styles["component.nav-bar.style.indicator"] = !mark ? "none" : mark.type === "ellipse" ? "dot" : mark.type === "rect" ? "line" : "pill";
    const box = bar ?? nav;
    const x = absX(byId, box);
    facts.nav = { insetStart: x, insetEnd: (root?.w ?? 0) - (x + box.w), radius: radiusOf(box), height: box.h };
  }
  const top = nodes.find((n) => comp(n) === "TopBar");
  if (top) {
    const title = below(nodes, top).find((n) => n.type === "text") as (SceneNode & { text?: { typeToken?: string; align?: string } }) | undefined;
    if (title) facts.styles["component.top-bar.style.title"] = title.text?.typeToken === "type.title-lg" ? "large" : title.text?.align === "start" ? "start" : "center";
  }
  const tabsNode = nodes.find((n) => comp(n) === "Tabs");
  if (tabsNode) facts.styles["component.tabs.style.indicator"] = below(nodes, tabsNode).some((n) => n.name === "Indicator") ? "underline" : "pill";
  const rows = nodes.filter((n) => comp(n) === "ListItem" || (n.name === "ListItem" && n.parentId && comp(byId.get(n.parentId)!) === "ListItem"));
  if (rows.length) {
    const inside = rows.flatMap((r) => below(nodes, r));
    const icons = inside.filter((n) => n.type === "icon" && !(n as { icon?: string }).icon?.startsWith("chevron"));
    if (icons.length) facts.styles["component.list-item.style.leading"] = inside.some((n) => n.name === "Leading") ? "contained" : "bare";
    const lines = inside.filter((n) => n.name.startsWith("Divider"));
    facts.styles["component.list-item.style.divider"] = !lines.length ? "none" : lines.some((l) => l.x > 4) ? "inset" : "full";
    facts.styles["component.list-item.style.chevron"] = inside.some((n) => n.type === "icon" && (n as { icon?: string }).icon === "chevron-right") ? "shown" : "hidden";
  }
  const tiles = nodes.filter((n) => comp(n) === "ServiceTile");
  if (tiles.length) facts.styles["component.tile.style.layout"] = tiles.some((t) => !!(t as { fill?: unknown }).fill) ? "card" : "bare";
  const button = nodes.find((n) => comp(n) === "Button/Primary");
  if (button) facts.button = { h: button.h, radius: radiusOf(button) };
  return facts;
}

const AXIS_WEIGHT: Record<string, number> = {
  "component.nav-bar.style.placement": 1,
  "component.top-bar.style.title": 1,
  "component.tabs.style.indicator": 1,
  "component.nav-bar.style.labels": 0.8,
  "component.list-item.style.leading": 0.7,
  "component.tile.style.layout": 0.7,
  "component.nav-bar.style.indicator": 0.6,
  "component.list-item.style.divider": 0.5,
  "component.list-item.style.chevron": 0.4,
};

/**
 * How far a rebuild is from the screenshot: a weighted error (0 = everything checked matches).
 * A check counts only when the screenshot shows the thing clearly and the rebuild has the
 * component, so a change that touches nothing on screen can't move the score.
 */
export function structureScore(shot: ShotFacts, rebuild: RebuildFacts): { score: number; checks: Check[] } {
  const checks: Check[] = [];
  for (const [path, want] of Object.entries(shot.styles)) {
    const a = STYLE_BY_PATH.get(path);
    if (!a || !rebuild.present.has(a.component) || rebuild.styles[path] === undefined) continue;
    checks.push({ id: path, weight: AXIS_WEIGHT[path] ?? 0.5, error: rebuild.styles[path] === want ? 0 : 1 });
  }
  if (shot.nav && rebuild.nav) {
    const floating = shot.styles["component.nav-bar.style.placement"] === "floating";
    if (floating && rebuild.styles["component.nav-bar.style.placement"] === "floating") {
      const inset = (Math.abs(shot.nav.insetStart - rebuild.nav.insetStart) + Math.abs(shot.nav.insetEnd - rebuild.nav.insetEnd)) / 2;
      checks.push({ id: "nav inset", weight: 0.5, error: Math.min(1, inset / 16) });
      const want = shot.nav.pill ? Math.min(shot.nav.height, rebuild.nav.height) / 2 : shot.nav.radius;
      checks.push({ id: "nav corners", weight: 0.3, error: Math.min(1, Math.abs(Math.min(rebuild.nav.radius, rebuild.nav.height / 2) - want) / 12) });
      checks.push({ id: "nav height", weight: 0.3, error: Math.min(1, Math.abs(shot.nav.height - rebuild.nav.height) / 12) });
    }
  }
  if (shot.button && rebuild.button) {
    checks.push({ id: "button height", weight: 0.3, error: Math.min(1, Math.abs(shot.button.h - rebuild.button.h) / 12) });
    const want = shot.button.pill ? shot.button.h / 2 : shot.button.radius;
    checks.push({ id: "button corners", weight: 0.3, error: Math.min(1, Math.abs(Math.min(rebuild.button.radius, rebuild.button.h / 2) - want) / 12) });
  }
  const total = checks.reduce((s, c) => s + c.weight, 0);
  return { score: total ? checks.reduce((s, c) => s + c.weight * c.error, 0) / total : 0, checks };
}

export interface Proposal {
  path: string;
  value: string;
  reason: string;
}

export interface Tried {
  path: string;
  from: string;
  to: string;
  reason: string;
  /** Score before and after (0 = matches the screenshot). */
  before?: number;
  after?: number;
  /** Why it wasn't kept. */
  why?: string;
}

export interface ReconcileResult {
  tree: Tree;
  scoreBefore: number;
  scoreAfter: number;
  applied: Tried[];
  rejected: Tried[];
  /** Couldn't be checked (nothing on screen shows it): offered, not applied. */
  suggestions: Tried[];
}

const MIN_GAIN = 0.02;
const MAX_WORSE = 0.1;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Try each proposal on its own (at most 16), keep those that bring the rebuild closer. */
export function reconcile(input: { tree: Tree; docs: DesignDocs; proposals: Proposal[]; shot: ShotFacts; build: (tree: Tree) => SceneNode[] }): ReconcileResult {
  let tree = input.tree;
  let current = structureScore(input.shot, describeRebuild(input.build(tree)));
  const scoreBefore = current.score;
  const out: ReconcileResult = { tree, scoreBefore: round(scoreBefore), scoreAfter: round(scoreBefore), applied: [], rejected: [], suggestions: [] };
  const seen = new Set<string>();
  for (const p of input.proposals) {
    if (seen.has(p.path) || seen.size >= 16) continue;
    seen.add(p.path);
    const ts = new TokenSet(tree);
    const from = ts.get(p.path)?.authored;
    const fromText = typeof from === "string" || typeof from === "number" ? String(from) : JSON.stringify(from ?? "");
    if (fromText === p.value) continue;
    const tried: Tried = { path: p.path, from: fromText, to: p.value, reason: p.reason };
    const change: TokenChange = { kind: "token", path: p.path, value: p.value, reason: p.reason };
    const r = applyChanges(tree, input.docs, [change]);
    if (r.problems[0]) {
      out.rejected.push({ ...tried, why: r.problems[0] });
      continue;
    }
    const next = structureScore(input.shot, describeRebuild(input.build(r.tree)));
    const moved = next.checks.filter((c) => {
      const was = current.checks.find((x) => x.id === c.id);
      return !was || was.error !== c.error;
    });
    // Checkable when a check covers the axis itself, or when the change moves any check.
    if (!moved.length && !next.checks.some((c) => c.id === p.path)) {
      out.suggestions.push({ ...tried, why: "Nothing in the screenshot or its rebuild shows it, so it couldn't be checked." });
      continue;
    }
    const worse = next.checks.find((c) => {
      const was = current.checks.find((x) => x.id === c.id);
      return was && c.weight * (c.error - was.error) > MAX_WORSE;
    });
    const scored = { ...tried, before: round(current.score), after: round(next.score) };
    if (current.score - next.score >= MIN_GAIN && !worse) {
      tree = r.tree;
      current = next;
      out.applied.push(scored);
    } else out.rejected.push({ ...scored, why: worse ? `It would move the rebuild away from the screenshot's ${worse.id.replace(/^component\.|\.style\./g, " ").trim()}.` : "The rebuild didn't get closer to the screenshot." });
  }
  out.tree = tree;
  out.scoreAfter = round(current.score);
  return out;
}

/** Proposals from the model's structure: every axis it reads differently from the draft. */
export function structureProposals(structure: Record<string, Record<string, unknown>> | undefined, tree: Tree, diagnosis = ""): Proposal[] {
  if (!structure) return [];
  const ts = new TokenSet(tree);
  const out: Proposal[] = [];
  for (const a of STYLE_AXES) {
    const g = structure[a.group.slice(10)];
    const v = g?.[a.axis];
    if (!g || g.visible === false || typeof v !== "string" || !a.values.includes(v) || ts.get(a.path)?.value === v) continue;
    out.push({ path: a.path, value: v, reason: String(g.evidence ?? "").slice(0, 200) || diagnosis.slice(0, 200) });
  }
  return out;
}
