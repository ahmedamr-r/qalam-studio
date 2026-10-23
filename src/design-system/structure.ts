import { structureKey, type StructureResult } from "@/ai/ds-structure";
import { getNode, setToken } from "./contract";
import { TokenSet, isRolePath, type Tree } from "./resolve";
import { STYLE_AXES, isStyleValue } from "./styles";
import type { MarkEvidence, StructureEvidence } from "./structure-pixels";

/**
 * Component structure from an extraction: the model's reading (enums, see ds-structure.ts), with
 * what the pixels decide on top. Only clear-cut measurements override the model: a bar inset from
 * both edges with round corners floats; one that spans the width is docked; and so on. The
 * measured sizes, corners and fills go into the structural recipe tokens.
 */

export interface Decided {
  value: string;
  /** Plain words, for the notes: "the bar is inset 24/24px with round ends". */
  why: string;
}

const r = (n: number) => Math.round(n);

/** The kind of shape marking the active tab: a shape behind the icon, a dot, or a short line. */
function navMark(m: MarkEvidence): Decided | null {
  if (m.w >= 20 && m.h >= 20 && (m.pill || m.radius >= 8)) return { value: "pill", why: `a ${r(m.w)}×${r(m.h)}px ${m.pill ? "round" : "rounded"} shape sits behind the active icon` };
  if (m.w <= 8 && m.h <= 8) return { value: "dot", why: `a ${r(m.w)}px dot marks the active tab` };
  if (m.h <= 4 && m.w >= 12) return { value: "line", why: `a ${r(m.w)}×${r(m.h)}px bar marks the active tab` };
  return null;
}

/** The value most readings agree on, when at least two do and they're two thirds of the clear ones. */
function agreed<T extends string>(values: (T | undefined)[]): { value: T; n: number; of: number } | null {
  const clear = values.filter((v): v is T => !!v);
  const counts = new Map<T, number>();
  for (const v of clear) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [value, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return value && n >= 2 && n >= (clear.length * 2) / 3 ? { value, n, of: values.length } : null;
}

/** What the pixels decide, by structure token path. */
export function inferStyles(e: StructureEvidence): Record<string, Decided> {
  const out: Record<string, Decided> = {};
  const nav = e.nav;
  if (nav) {
    const a = nav.insetStart,
      b = nav.insetEnd;
    if (a >= 6 && b >= 6 && Math.abs(a - b) <= Math.max(6, 0.1 * Math.max(a, b)) && (nav.pill || nav.radius >= 12))
      out["component.nav-bar.style.placement"] = { value: "floating", why: `the bar is inset ${r(a)}/${r(b)}px from the edges with ${nav.pill ? "round ends" : `${r(nav.radius)}px corners`}` };
    else if (a <= 2 && b <= 2) out["component.nav-bar.style.placement"] = { value: "docked", why: "the bar spans the full width" };
    if (nav.labels)
      out["component.nav-bar.style.labels"] = {
        value: nav.labels,
        why: nav.labels === "none" ? "every tab is an icon only" : nav.labels === "all" ? "every tab has a label under its icon" : "only one tab has a label",
      };
  }
  const mark = e.navActive && navMark(e.navActive);
  if (mark) out["component.nav-bar.style.indicator"] = mark;
  const t = e.title;
  if (t) {
    const off = Math.abs(t.x + t.w / 2 - t.logicalWidth / 2);
    if (t.inkH >= 22 && t.x <= 40) out["component.top-bar.style.title"] = { value: "large", why: `the title is ${r(t.inkH)}px tall on the start edge` };
    else if (t.inkH < 22 && off <= 6) out["component.top-bar.style.title"] = { value: "center", why: "the title is centred" };
    else if (t.inkH < 22 && off >= 0.15 * t.logicalWidth) out["component.top-bar.style.title"] = { value: "start", why: `the title starts ${r(t.x)}px from the edge` };
  }
  const tab = e.tabsActive;
  if (tab) {
    if (tab.h <= 4 && tab.w >= 12) out["component.tabs.style.indicator"] = { value: "underline", why: `a ${r(tab.h)}px line marks the selected tab` };
    else if (tab.h >= 20 && (tab.pill || tab.radius >= 8)) out["component.tabs.style.indicator"] = { value: "pill", why: "a filled pill marks the selected tab" };
  }
  const list = e.list;
  if (list) {
    const lead = agreed(list.leading);
    if (lead) out["component.list-item.style.leading"] = { value: lead.value, why: `${lead.n} of ${lead.of} rows have ${lead.value === "bare" ? "a plain icon" : "the icon in a filled shape"}` };
    const div = agreed(list.divider);
    if (div) out["component.list-item.style.divider"] = { value: div.value, why: `${div.n} of ${div.of} rows have ${div.value === "none" ? "no line under them" : div.value === "full" ? "a line edge to edge" : "a line starting at the text"}` };
    const chev = agreed(list.chevron);
    if (chev) out["component.list-item.style.chevron"] = { value: chev.value, why: `${chev.n} of ${chev.of} rows ${chev.value === "shown" ? "end in a chevron" : "have nothing at the end"}` };
  }
  const tile = e.tile && agreed(e.tile);
  if (tile) out["component.tile.style.layout"] = { value: tile.value, why: `${tile.n} of ${tile.of} tiles ${tile.value === "bare" ? "have no card" : "are filled cards"}` };
  return out;
}

/** A radius as a reference to the radius scale when one is within 1.5px (round ends: the pill role). */
function radiusValue(ts: TokenSet, m: { radius: number; pill: boolean }): string {
  if (m.pill) return "{radius.pill}";
  const role = ["radius.none", "radius.xs", "radius.sm", "radius.md", "radius.lg", "radius.xl"]
    .map((p) => [p, ts.dimension(p)] as const)
    .filter((x): x is readonly [string, number] => x[1] !== undefined)
    .sort((a, b) => Math.abs(a[1] - m.radius) - Math.abs(b[1] - m.radius))[0];
  return role && Math.abs(role[1] - m.radius) <= 1.5 ? `{${role[0]}}` : `${r(m.radius)}px`;
}

/** A measured colour as a reference to a background role that matches it, else the hex. */
function fillValue(ts: TokenSet, hex: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const want = rgb(hex);
  const role = ts.tokens.find((t) => t.type === "color" && isRolePath(t.path) && t.path.startsWith("bg.") && typeof t.value === "string" && /^#[0-9a-f]{6}/i.test(t.value) && rgb(t.value).every((v, i) => Math.abs(v - want[i]) <= 3));
  return role ? `{${role.path}}` : hex;
}

/** The structural recipe tokens the pixels measured (sizes, corners, fills), given what's drawn. */
export function measuredTokens(e: StructureEvidence, ts: TokenSet, styles: (path: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  const nav = e.nav;
  if (nav && styles("component.nav-bar.style.placement") === "floating") {
    out["component.nav-bar.inset"] = `${r(Math.max(4, Math.min(nav.insetStart, nav.insetEnd)))}px`;
    out["component.nav-bar.radius"] = radiusValue(ts, nav);
    if (nav.height >= 40 && nav.height <= 96) out["component.nav-bar.height"] = `${r(nav.height)}px`;
  }
  if (nav && /^#[0-9A-F]{6}$/i.test(nav.fill)) out["component.nav-bar.fill"] = fillValue(ts, nav.fill);
  const act = e.navActive;
  if (act && styles("component.nav-bar.style.indicator") === "pill") {
    if (act.h >= 16 && act.h <= 64) out["component.nav-bar.indicator-size"] = `${r(act.h)}px`;
    if (act.w >= 16 && act.w <= 160) out["component.nav-bar.indicator-width"] = `${r(act.w)}px`;
    if (/^#[0-9A-F]{6}$/i.test(act.fill)) out["component.nav-bar.indicator-fill"] = fillValue(ts, act.fill);
  }
  const tab = e.tabsActive;
  if (tab && styles("component.tabs.style.indicator") === "pill") {
    out["component.tabs.pill-radius"] = radiusValue(ts, tab);
    if (/^#[0-9A-F]{6}$/i.test(tab.fill)) out["component.tabs.pill-fill"] = fillValue(ts, tab.fill);
  }
  // Row height: the rows the model boxed agree within a few px.
  const hs = (e.list?.heights ?? []).filter((h) => h >= 32 && h <= 120).sort((a, b) => a - b);
  if (hs.length >= 2 && hs[hs.length - 1] - hs[0] <= 8) out["component.list-item.min-height"] = `${r(hs[Math.floor(hs.length / 2)])}px`;
  const lead = e.list?.leadingBox;
  if (lead && styles("component.list-item.style.leading") === "contained") {
    out["component.list-item.leading-size"] = `${r(Math.max(lead.w, lead.h))}px`;
    out["component.list-item.leading-radius"] = radiusValue(ts, lead);
    if (/^#[0-9A-F]{6}$/i.test(lead.fill)) out["component.list-item.leading-fill"] = fillValue(ts, lead.fill);
  }
  return out;
}

export interface StructureInput {
  /** The model's reading (absent in older recordings). */
  model?: StructureResult;
  evidence?: StructureEvidence;
  /** Recipe groups the designer chose to extract (null: all): the rest keep the default structure. */
  chosen?: Set<string> | null;
}

/**
 * Write the structure into a system's tree: the model's value for each axis of a visible
 * component, then what the pixels decide on top, then the measured structural tokens. Notes say
 * what the pixels read and every place they overruled the model.
 */
export function applyStructure(tree: Tree, input: StructureInput, notes: string[]) {
  const decided = input.evidence ? inferStyles(input.evidence) : {};
  const read: string[] = [];
  const overruled: string[] = [];
  for (const a of STYLE_AXES) {
    if (input.chosen && !input.chosen.has(a.group)) continue;
    const g = input.model?.[structureKey(a.group)];
    const said = g && g.visible !== false && isStyleValue(a.path, g[a.axis]) ? (g[a.axis] as string) : undefined;
    const d = decided[a.path];
    const value = d?.value ?? said;
    if (!value) continue;
    setToken(tree, a.path, { ...(getNode(tree, a.path) ?? {}), $type: "string", $value: value });
    if (d && said && said !== d.value) overruled.push(`${a.component} ${a.label.toLowerCase()}: the model said ${said}, but ${d.why}, so ${d.value}`);
    else if (d) read.push(`${a.component} ${a.label.toLowerCase()} ${d.value} (${d.why})`);
  }
  if (input.evidence) {
    const ts = new TokenSet(tree);
    const styles = (path: string) => (ts.get(path)?.value as string) ?? "";
    const tokens = measuredTokens(input.evidence, ts, styles);
    const said: string[] = [];
    for (const [path, value] of Object.entries(tokens)) {
      const group = path.split(".").slice(0, 2).join(".");
      if (input.chosen && !input.chosen.has(group)) continue;
      const before = ts.get(path)?.authored;
      if (before === value) continue;
      const type = ts.get(path)?.type ?? "dimension";
      setToken(tree, path, value.startsWith("{") ? { $value: value } : { $type: value.startsWith("#") ? "color" : type, $value: value });
      said.push(`${path.slice(10)} ${value}`);
    }
    if (said.length) read.push(`measured ${said.join(", ")}`);
  }
  if (read.length) notes.push(`Structure read from the pixels: ${read.join("; ")}.`);
  for (const o of overruled) notes.push(`Corrected by the pixels: ${o}.`);
}
