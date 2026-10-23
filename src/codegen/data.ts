import type { Binding, Doc, RouteAction, RouteProto, RouteRef, RouteRule, SceneNode, SwapDef, Value, VarDef } from "@/doc/schema";
import { pathMatches } from "@/doc/proto";
import { worldBounds } from "@/doc/geometry";
import { CATALOG_BY_NAME, type PropSpec } from "@/design-system/components";
import { instOf } from "@/design-system/instances";
import { componentNodes } from "@/design-system/place";
import { ctxFor } from "@/design-system/refresh";
import type { Inst } from "@/design-system/builders";
import { appVarName, exprToTS, type CodeEnv } from "@/proto/expr";
import { collectionElements, itemOf, itemRecords, layerAddress, lineRecord, subLayers, type ItemRecord } from "@/proto/items";
import { findMoney, moneyCode, type MoneyFormat } from "@/proto/money";
import { findLayer, refFrame } from "@/proto/routes";
import { collectionOf, componentAt, ctxCollections } from "@/proto/scope";
import type { CompiledPart, CompiledScreen, Ctx, Scope, ScreenCtx } from "./compile";
import { mergeState, treeOf, type VNode } from "./states";
import type { Style } from "./css";
import { camel, key, lit, num, pascal, unique } from "./names";

/*
 * A prototype's data, compiled (pure): what each route remembers (typed per screen), its items'
 * records (read off the design, see proto/items.ts), its rules as pure functions over the state,
 * where its scroll marks are, and how bindings show values — copy with live slots, a component's
 * looks keyed by a value (a radio's checked, a chip row's selected), what shows while something
 * holds, and swaps. The module's `step` (overlays.ts) runs the rules; the same code plays in the
 * studio and runs headless in tests (proto/runner.ts).
 */

/** What compiling a route needs, worked out once per screen. */
export interface RouteData {
  screen: string;
  /** The screen's key in the code ("alMallahMenu"), its data type and accessor. */
  key: string;
  type: string;
  fn: string;
  route: RouteProto;
  vars: Record<string, VarDef>;
  /** Collection id → its records. */
  items: Record<string, ItemRecord[]>;
  /** Part id → the collection the item it's opened with comes from. */
  ctxCol: Record<string, string>;
  money: MoneyFormat;
  /** Other formats its copy writes amounts in (a chip's "AED 50" beside a button's "AED 100.00"): format → its formatter's name. */
  moneyFns: Map<string, string>;
  /** Scroll: where `past` flips (scrollTop), the sections a `spy` watches, and how tall the pinned top is. */
  past: { v: string; y: number }[];
  spy: { v: string; items: string; marks: [string, number][] } | null;
  topH: number;
  /** Part id → the vars that start over when it opens. */
  resets: Record<string, string[]>;
}

const DEFAULT_MONEY: MoneyFormat = { prefix: "", suffix: "", decimals: 2, dec: ".", group: ",", digits: "latin" };

/** Layers under a frame, depth first. */
function walk(doc: Doc, id: string, out: SceneNode[] = []): SceneNode[] {
  for (const c of doc.nodes[id]?.children ?? []) {
    const n = doc.nodes[c];
    if (!n?.visible) continue;
    out.push(n);
    walk(doc, c, out);
  }
  return out;
}

/** The first amount of money anywhere in the route's frames: the format its prices are written in. */
function routeMoney(doc: Doc, frames: string[]): MoneyFormat {
  for (const f of frames) for (const n of walk(doc, f)) if (n.type === "text") {
    const m = findMoney(n.text.content);
    if (m) return m.format;
  }
  return DEFAULT_MONEY;
}

/** Height of a phone screen's pinned top (status bar and header): what scrolling content passes under. */
function pinnedTop(doc: Doc, screen: string): number {
  const root = doc.nodes[screen];
  if (!root) return 0;
  const rootY = worldBounds(doc, screen).y;
  let bottom = rootY;
  for (const n of walk(doc, screen)) {
    const p = n.meta.specPath;
    if (n.name === "Status bar" || (p && /^header\.\d+$/.test(p))) bottom = Math.max(bottom, worldBounds(doc, n.id).y + n.h);
  }
  return Math.round(bottom - rootY);
}

/** Compile info for a screen with a route (null without one). */
export function routeData(c: Ctx, s: CompiledScreen): RouteData | null {
  const route = c.proto.routes?.[s.id];
  if (!route) return null;
  const doc = c.doc;
  const parts = c.parts.get(s.id) ?? [];
  const items: Record<string, ItemRecord[]> = {};
  for (const [id, col] of Object.entries(route.items ?? {})) items[id] = itemRecords(doc, s.id, col);
  // A part opened with an item reads it as `ctx`: from the collection its opener's items are in.
  const ctxCol = ctxCollections(route);
  const topH = pinnedTop(doc, s.id);
  const rootY = worldBounds(doc, s.id).y;
  const past: { v: string; y: number }[] = [];
  let spy: RouteData["spy"] = null;
  let stickH = 0;
  for (const e of route.scroll ?? []) {
    if (e.kind === "stick") {
      const id = refFrame(doc, s.id, e.ref) && e.ref.path ? findPath(doc, s.id, e.ref.path) : null;
      if (id) stickH = Math.max(stickH, doc.nodes[id].h);
    }
  }
  for (const e of route.scroll ?? []) {
    if (e.kind === "past") {
      const id = e.ref.path ? findPath(doc, s.id, e.ref.path) : null;
      if (!id) {
        c.warnings.push(`Nothing on "${s.name}" is at ${e.ref.path}; its scroll effect was left out.`);
        continue;
      }
      const b = worldBounds(doc, id);
      past.push({ v: e.v, y: Math.max(1, Math.round(b.y - rootY + b.h - topH)) });
    } else if (e.kind === "spy") {
      const col = route.items?.[e.items];
      if (!col) continue;
      const marks: [string, number][] = collectionElements(doc, s.id, col).map((el) => [el.path, Math.max(0, Math.round(worldBounds(doc, el.id).y - rootY - topH - stickH - 8))]);
      spy = { v: e.v, items: e.items, marks };
    }
  }
  const resets: Record<string, string[]> = {};
  for (const [name, def] of Object.entries(route.vars ?? {})) if (def.resetOn) (resets[def.resetOn] ??= []).push(name);
  const frames = [s.id, ...parts.map((p) => p.id)];
  return {
    screen: s.id,
    key: s.key,
    type: `${s.component}Data`,
    fn: `${s.key}Data`,
    route,
    vars: route.vars ?? {},
    items,
    ctxCol,
    money: routeMoney(doc, frames),
    moneyFns: new Map(),
    past,
    spy,
    topH,
    resets,
  };
}

function findPath(doc: Doc, frame: string, path: string): string | null {
  for (const n of walk(doc, frame)) if (n.meta.specPath === path) return n.id;
  return null;
}

// ---------------------------------------------------------------------------
// Expressions in the code

/** Where an expression reads from: the state `s`, the item `it` (a record), the open part's item. */
export function codeEnv(rd: RouteData, opts: { s?: string; it?: string; ctxPart?: string } = {}): CodeEnv {
  const s = opts.s ?? "s";
  return {
    routeVar: (name) => `${rd.fn}(${s}).${name}`,
    appVar: (name) => `${s}.app.${name}`,
    it: opts.it,
    ctx: opts.ctxPart && rd.ctxCol[opts.ctxPart] ? `ITEMS.${rd.key}.${rd.ctxCol[opts.ctxPart]}[${s}.ctx[${lit(opts.ctxPart)}] ?? ""]` : undefined,
    items: (col) => `ITEMS.${rd.key}.${col}`,
  };
}

const itemCode = (rd: RouteData, col: string, id: string) => `ITEMS.${rd.key}.${col}[${lit(id)}]`;

/** The formatter for amounts written like `f` (the route's own, unless the copy writes them another way). */
function moneyFn(rd: RouteData, f: MoneyFormat | undefined): string {
  const base = `money_${rd.key}`;
  if (!f || JSON.stringify(f) === JSON.stringify(rd.money)) return base;
  const k = JSON.stringify(f);
  if (!rd.moneyFns.has(k)) rd.moneyFns.set(k, `${base}${rd.moneyFns.size + 2}`);
  return rd.moneyFns.get(k)!;
}

/** A slot's value as text for copy (an amount written the way that copy writes one). */
function slotCode(rd: RouteData, fmt: "text" | "int" | "money", expr: string, money?: MoneyFormat): string {
  if (fmt === "money") return `${moneyFn(rd, money)}(Number(${expr}) || 0)`;
  if (fmt === "int") return `String(Number(${expr}) || 0)`;
  return `String(${expr} ?? "")`;
}

/** A template literal of authored copy with its matched parts (in order, apart) replaced by slots. */
function template(content: string, spans: { at: number; len: number; code: string }[]): string {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  let out = "";
  let from = 0;
  for (const sp of [...spans].sort((a, b) => a.at - b.at)) {
    out += `${esc(content.slice(from, sp.at))}\${${sp.code}}`;
    from = sp.at + sp.len;
  }
  return `\`${out}${esc(content.slice(from))}\``;
}

/** Where in a text a slot sits (the copy it stands in for, else what reads like its format), or null. */
function slotSpan(content: string, fmt: "text" | "int" | "money", at?: string): [number, number] | null {
  if (at !== undefined) {
    const i = content.indexOf(at);
    return i >= 0 ? [i, at.length] : null;
  }
  if (fmt === "money") {
    const m = findMoney(content);
    return m ? [m.index + (m.plus ? 1 : 0), m.text.length - (m.plus ? 1 : 0)] : null;
  }
  if (fmt === "int") {
    const m = /[0-9٠-٩]+/.exec(content);
    return m ? [m.index, m[0].length] : null;
  }
  return [0, content.length];
}

// ---------------------------------------------------------------------------
// A frame's bindings, swaps, sticky layers and handlers

/** Layers a ref points at in this frame's tree, each with the item it runs with. */
function targets(sc: ScreenCtx, root: VNode, rd: RouteData, r: RouteRef, each?: string): { v: VNode; it?: { col: string; id: string } }[] {
  // Where a collection lists its items, only its items (not the dividers, or the button after them).
  const comp = componentAt(rd.route, r);
  const doc = sc.c.doc;
  const out: { v: VNode; it?: { col: string; id: string } }[] = [];
  const byPath: VNode[] = [];
  const visit = (v: VNode) => {
    const p = v.base.meta.specPath;
    if (r.path && p !== undefined && (p === r.path || (r.path.includes("*") && pathMatches(r.path, p))) && (!comp || (v.base.meta.component ?? "").startsWith(comp))) byPath.push(v);
    v.children.forEach(visit);
  };
  if (r.path) visit(root);
  else byPath.push(root);
  const ids = new Map<string, VNode>();
  const index = (v: VNode) => {
    ids.set(v.base.id, v);
    v.children.forEach(index);
  };
  index(root);
  let n = 0;
  for (const v of byPath) {
    const layers = r.sub ? subLayers(doc, v.base.id, r.sub.role).map((id) => ids.get(id)).filter((x): x is VNode => !!x) : [v];
    const picked = r.sub?.nth !== undefined ? layers.slice(r.sub.nth, r.sub.nth + 1) : layers;
    for (const t of picked) {
      let it: { col: string; id: string } | undefined;
      if (each) {
        const rec = rd.items[each]?.[n];
        if (rec) it = { col: each, id: rec.id };
      } else if (v.base.meta.specPath) {
        const own = itemOf(doc, rd.screen, rd.route.items ?? {}, r.part, v.base.meta.specPath);
        if (own) it = { col: own.collection, id: own.id };
      }
      out.push({ v: t, it });
      n++;
    }
  }
  return out;
}

const samePart = (r: RouteRef, part: string | undefined) => (r.part ?? undefined) === part;

/** The values a prop can take, the authored one first; null when there are too many to draw each. */
function domain(spec: PropSpec | undefined, current: unknown, inst: Inst): Value[] | null {
  if (!spec) return null;
  if (spec.type === "boolean") return [current === true, current !== true];
  if (spec.type === "enum" && spec.values) return [String(current ?? spec.default ?? spec.values[0]), ...spec.values.filter((v) => v !== String(current ?? spec.default ?? spec.values![0]))];
  if (spec.type === "number") {
    // An index into the component's own list (chips, tabs, segments, steps).
    const list = Object.values(inst.props ?? {}).find((v): v is unknown[] => Array.isArray(v));
    const n = list?.length ?? (typeof spec.max === "number" && typeof spec.min === "number" && spec.max - spec.min <= 8 ? spec.max - spec.min + 1 : 0);
    if (!n || n > 12) return null;
    const cur = Number(current ?? 0);
    const all = Array.from({ length: n }, (_, i) => i);
    return [cur, ...all.filter((i) => i !== cur)];
  }
  return null;
}

/** Wire a frame (a screen, or one of its parts) to its route's data. */
export function wireRoute(sc: ScreenCtx, root: VNode, rd: RouteData, part?: CompiledPart) {
  const { c } = sc;
  const doc = c.doc;
  const partId = part?.part;
  const frameRoot = part ? part.id : rd.screen;
  const dsId = doc.nodes[frameRoot]?.meta.designSystem ?? "builtin";
  const env = (it?: { col: string; id: string }) => codeEnv(rd, { it: it ? itemCode(rd, it.col, it.id) : undefined, ctxPart: partId });
  const route = rd.route;

  // Rows drawn once for each element of a list (a basket's lines): the design's first row stands for them all.
  for (const b of route.bindings ?? []) {
    if (b.kind !== "repeat" || !samePart(b.ref, partId)) continue;
    const [h] = targets(sc, root, rd, b.ref);
    if (!h) {
      c.warnings.push(`"${sc.s.name}": no row at ${b.ref.path} to draw for each of "${b.of}".`);
      continue;
    }
    const mark = (x: VNode) => {
      sc.inRepeat.add(x);
      x.children.forEach(mark);
    };
    mark(h.v);
    // The design's other sample rows make way, and so do the dividers between rows: one goes between the rows drawn instead.
    const rows = new Set([h.v, ...(b.others ?? []).flatMap((p) => targets(sc, root, rd, { part: b.ref.part, path: p }).map((o) => o.v))]);
    for (const r of rows) if (r !== h.v) sc.dropped.add(r);
    const parent = findParent(root, h.v);
    let divider: VNode | undefined;
    if (parent) {
      const kids = parent.children;
      kids.forEach((k, i) => {
        if (!/^Divider/.test(k.base.meta.component ?? "") || !rows.has(kids[i - 1]) || !rows.has(kids[i + 1])) return;
        divider ??= k;
        sc.dropped.add(k);
      });
    }
    sc.repeats.set(h.v, { list: exprToTS({ v: b.of }, env()), ...(divider ? { divider } : {}) });
    sc.usesS = true;
  }

  // Rules: every layer that triggers one runs it (with its item; in a row drawn per element, with that element).
  for (const ru of route.rules) {
    if (!("ref" in ru.when) || !samePart(ru.when.ref, partId)) continue;
    const hits = targets(sc, root, rd, ru.when.ref, ru.each);
    if (!hits.length) c.warnings.push(`Nothing on "${sc.s.name}" matches rule ${ru.id}'s ${ru.when.ref.path ?? "frame"}; it was left out.`);
    for (const h of hits) {
      const each = sc.inRepeat.has(h.v);
      const code = `act({ do: "run", rule: ${lit(ru.id)}${each ? ", it: String(i)" : h.it ? `, it: ${lit(h.it.id)}` : ""} }, e)`;
      const hot = sc.hot.get(h.v) ?? { tap: [], press: [], enter: [], leave: [] };
      if (ru.when.on === "tap") hot.tap.push(code);
      else if (ru.when.on === "press") hot.press.push(code);
      else hot.enter.push(code);
      sc.hot.set(h.v, hot);
      sc.usesAct = true;
      const tapKey = `${rd.key}|${partId ?? ""}|${doc.nodes[h.v.base.id] ? layerAddress(doc, h.v.base.id) : (h.v.base.meta.specPath ?? "")}|${h.v.base.name}`;
      // Played without a screen, a row drawn per element is the first one's.
      (c.taps[tapKey] ??= []).push({ rule: ru.id, it: each ? "0" : h.it?.id });
    }
  }

  // Bindings.
  for (const b of route.bindings ?? []) {
    if (b.kind === "repeat" || !samePart(b.ref, partId)) continue;
    for (const h of targets(sc, root, rd, b.ref)) bind(sc, h.v, b, env(h.it), rd, frameRoot, dsId);
  }

  // Swaps: while `when` holds, the component shows as another.
  for (const sw of route.swaps ?? []) {
    if (!samePart(sw.ref, partId)) continue;
    for (const h of targets(sc, root, rd, sw.ref)) swap(sc, h.v, sw, env(h.it), rd, frameRoot, dsId);
  }

  // Sticky layers (screens only): they stay under the pinned top while their section scrolls.
  if (!part) {
    for (const e of route.scroll ?? []) {
      if (e.kind !== "stick" || !e.ref.path) continue;
      for (const h of targets(sc, root, rd, e.ref)) {
        const fill = doc.nodes[rd.screen]?.fill;
        // Edge to edge while it sticks, like a tab bar, so what scrolls under it doesn't show at its sides: it reaches over its parent's padding and pads itself back.
        const n = h.v.base;
        const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
        const pad = parent?.type === "frame" && parent.layout ? parent.layout.padding : null;
        const own = n.type === "frame" && n.layout ? n.layout.padding : null;
        const bleed: Style = pad && (pad.start || pad.end) ? { marginInlineStart: -pad.start, marginInlineEnd: -pad.end, paddingInlineStart: pad.start + (own?.start ?? 0), paddingInlineEnd: pad.end + (own?.end ?? 0) } : {};
        sc.sticky.set(h.v, { position: "sticky", top: rd.topH, zIndex: 2, ...(fill ? { backgroundColor: fill.token ? `var(--${fill.token.replace(/\./g, "-")})` : fill.color } : {}), ...bleed });
      }
    }
  }
}

/** A value worked out once at the top of the component (`hint` names it): its name, to use wherever it's read. */
function local(sc: ScreenCtx, hint: string, code: string, type?: string): string {
  const had = sc.locals.get(code);
  if (had) return had.name;
  const name = unique(camel(hint, 4) ?? "value", sc.localNames);
  sc.locals.set(code, { name, type });
  return name;
}

/** The layer `v` is in, in a frame's tree. */
function findParent(root: VNode, v: VNode): VNode | null {
  for (const k of root.children) {
    if (k === v) return root;
    const hit = findParent(k, v);
    if (hit) return hit;
  }
  return null;
}

function bind(sc: ScreenCtx, v: VNode, b: Binding, env: CodeEnv, rd: RouteData, frameRoot: string, dsId: string) {
  const { c } = sc;
  sc.usesS = true;
  if (b.kind === "repeat") return;
  if (b.kind === "visible") {
    sc.visible.set(v, exprToTS(b.e, env));
    return;
  }
  if (b.kind === "text") {
    // Each slot replaces the part of a text layer it reads like (an amount, a count, all of it).
    const texts: VNode[] = [];
    const collect = (x: VNode) => {
      if (x.base.type === "text") texts.push(x);
      x.children.forEach(collect);
    };
    collect(v);
    // A text can hold several slots (a name and an amount), apart.
    const placed = new Map<VNode, { at: number; len: number; code: string }[]>();
    for (const [, slot] of Object.entries(b.slots)) {
      let done = false;
      for (const t of texts) {
        if (t.base.type !== "text" || sc.texts.has(t)) continue;
        const span = slotSpan(t.base.text.content, slot.fmt, slot.at);
        const spans = placed.get(t) ?? [];
        if (!span || spans.some((x) => span[0] < x.at + x.len && x.at < span[0] + span[1])) continue;
        // An amount is written the way this copy writes it.
        const format = slot.fmt === "money" && slot.at === undefined ? findMoney(t.base.text.content)?.format : undefined;
        placed.set(t, [...spans, { at: span[0], len: span[1], code: slotCode(rd, slot.fmt, exprToTS(slot.e, env), format) }]);
        done = true;
        break;
      }
      if (!done) c.warnings.push(`"${sc.s.name}": no copy at ${b.ref.path ?? "the frame"} ${slot.at !== undefined ? `says "${slot.at}"` : `reads like a ${slot.fmt}`} to show a value in.`);
    }
    for (const [t, spans] of placed) if (t.base.type === "text") sc.texts.set(t, template(t.base.text.content, spans));
    return;
  }
  // A prop: the component's looks for each value it can take, keyed by that value.
  const id = v.base.id;
  const inst = instOf(c.doc, id) as Inst | undefined;
  const spec = inst ? CATALOG_BY_NAME.get(inst.component)?.props[b.prop] : undefined;
  const values = inst ? domain(spec, (inst.props ?? {})[b.prop], inst) : null;
  if (!inst || !values) {
    c.warnings.push(`"${sc.s.name}": ${b.prop} at ${b.ref.path ?? "the frame"} can't follow a value (not a component prop with a few values).`);
    return;
  }
  const keys = values.map((x) => JSON.stringify(x));
  const n = c.doc.nodes[id];
  const parent = n.parentId ? c.doc.nodes[n.parentId] : undefined;
  const width = parent?.type === "frame" && parent.layout?.direction === "vertical" && n.sizeH === "fill" ? parent.w - parent.layout.padding.start - parent.layout.padding.end : n.w;
  values.forEach((value, i) => {
    if (i === 0) return;
    const built = componentNodes({ ...inst, props: { ...inst.props, [b.prop]: value } }, ctxFor(c.doc, frameRoot, dsId, n.meta.specPath), Math.max(1, width), n.meta.specPath);
    mergeState(v, built, keys[i], keys);
  });
  // Worked out once, and compared with each look's value whatever the expression's narrower type.
  const sel = local(sc, `${n.name} ${b.prop}`, exprToTS(b.e, env), "unknown");
  // A value's looks change in place on the platform's motion for changes.
  const scope: Scope = { sel, code: (k) => k, t: "MOTION.change", screen: false };
  sc.scopes.set(v, { scope, keys });
}

function swap(sc: ScreenCtx, v: VNode, sw: SwapDef, env: CodeEnv, rd: RouteData, frameRoot: string, dsId: string) {
  const { c } = sc;
  const n = c.doc.nodes[v.base.id];
  const built = componentNodes(sw.inst as Inst, ctxFor(c.doc, frameRoot, dsId, n.meta.specPath), Math.max(1, n.w));
  // In the slot the original filled: its placement stays.
  // Where it is in the design stays too: the player finds the count where the + was.
  const top = { ...built[0], parentId: n.parentId, meta: { ...built[0].meta, specPath: n.meta.specPath } } as SceneNode;
  for (const k of ["x", "y", "sizeH", "sizeV", "absolute", "grow", "margin"] as const) (top as unknown as Record<string, unknown>)[k] = (n as unknown as Record<string, unknown>)[k];
  const map = new Map(built.map((x) => [x.id, x]));
  map.set(top.id, top);
  const alt = treeOf((id) => map.get(id), top.id);
  if (!alt) return;
  // "{name}" in its copy shows a slot's value.
  const fill = (x: VNode) => {
    if (x.base.type === "text" && sw.slots) {
      let code = "`" + x.base.text.content.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
      let any = false;
      for (const [name, slot] of Object.entries(sw.slots)) {
        if (!code.includes(`{${name}}`)) continue;
        code = code.split(`{${name}}`).join(`\${${slotCode(rd, slot.fmt, exprToTS(slot.e, env))}}`);
        any = true;
      }
      if (any) sc.texts.set(x, code);
    }
    x.children.forEach(fill);
  };
  fill(alt);
  sc.usesS = true;
  sc.swaps.set(v, { cond: exprToTS(sw.when, env), alt });
}

// ---------------------------------------------------------------------------
// The module's data code

const tsType = (d: VarDef): string => {
  switch (d.type.t) {
    case "bool":
      return "boolean";
    case "int":
    case "money":
      return "number";
    case "text":
      return "string";
    case "choice":
      return "string | null";
    case "set":
      return "string[]";
    case "list":
      return `{ ${Object.entries(d.type.fields).map(([k, f]) => `${k}: ${f === "text" ? "string" : "number"}`).join("; ")} }[]`;
  }
};

/** A rule as a pure function of the state: its actions in order, each reading what the one before left. */
function ruleCode(c: Ctx, rd: RouteData, ru: RouteRule): string[] {
  const col = ru.each ?? ("ref" in ru.when ? collectionOf(rd.route, ru.when.ref) : undefined);
  const ctxPart = "ref" in ru.when ? ru.when.ref.part : undefined;
  const env = codeEnv(rd, { it: col ? `ITEMS.${rd.key}.${col}[it ?? ""]` : undefined, ctxPart });
  const lines: string[] = [`  ${lit(ru.id)}: (s, it, anchor) => {`];
  if (ru.if !== undefined) lines.push(`    if (!(${exprToTS(ru.if, env)})) return s;`);
  for (const a of ru.then) lines.push(`    s = ${actionCode(c, rd, a, env)};`);
  lines.push("    return s;", "  },");
  return lines;
}

function setVar(rd: RouteData, v: string, value: string): string {
  const app = appVarName(v);
  return app ? `{ ...s, app: { ...s.app, ${key(app)}: ${value} } }` : `{ ...s, data: { ...s.data, ${key(v)}: ${value} } }`;
}

function actionCode(c: Ctx, rd: RouteData, a: RouteAction, env: CodeEnv): string {
  const read = (v: string) => exprToTS({ v }, env);
  const defOf = (v: string) => {
    const app = appVarName(v);
    return app ? c.proto.vars?.[app] : rd.vars[v];
  };
  switch (a.do) {
    case "open":
      return `openPart(s, ${lit(a.part)}, anchor${a.item !== undefined ? `, String(${exprToTS(a.item, env)} ?? "")` : ""})`;
    case "close":
      return `step(s, { do: "close"${a.part ? `, part: ${lit(a.part)}` : ""} })`;
    case "back":
      return `step(s, { do: "back" })`;
    case "go":
    case "next": {
      const to = a.do === "go" ? c.byId.get(a.screen)?.key : c.pending.find((p) => p.owner.id === rd.screen && p.page === a.page)?.key;
      if (!to) return "s";
      const m = a.transition.motion;
      // Native: as the platform moves pages (the variants know how); a token: that timing.
      if (m === "native") return `move(s, ${lit(to)}, { kind: ${lit(a.transition.kind)} })`;
      c.motions.add(m);
      return `move(s, ${lit(to)}, { kind: ${lit(a.transition.kind)}, transition: motionTokens[${lit(m)}] })`;
    }
    case "set":
      return setVar(rd, a.v, exprToTS(a.e, env));
    case "inc": {
      const d = defOf(a.v);
      const lo = d?.type.t === "int" ? d.type.min : -Infinity;
      const hi = d?.type.t === "int" ? d.type.max : Infinity;
      const next = `(${read(a.v)} ?? 0) + ${num(a.by)}`;
      return setVar(rd, a.v, Number.isFinite(lo) ? `Math.min(${num(hi)}, Math.max(${num(lo)}, ${next}))` : next);
    }
    case "toggle":
      return a.id !== undefined
        ? setVar(rd, a.v, `((cur: string[], id: string) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))(${read(a.v)} ?? [], String(${exprToTS(a.id, env)}))`)
        : setVar(rd, a.v, `!${read(a.v)}`);
    case "push":
      return setVar(rd, a.v, `[...(${read(a.v)} ?? []), { ${Object.entries(a.record).map(([k, e]) => `${key(k)}: ${exprToTS(e, env)}`).join(", ")} }]`);
    case "remove":
      return setVar(rd, a.v, `(${read(a.v)} ?? []).filter((el) => !(${exprToTS(a.where, env, "el")}))`);
    case "change": {
      // The line the tapped layer is drawn for (`it`: its place in the list); below its least, it leaves the list.
      const next = `n.${a.field} + ${num(a.by)}`;
      return setVar(rd, a.v, `(${read(a.v)} ?? []).flatMap((n, j) => (j !== Number(it) ? [n] : ${a.min !== undefined ? `${next} < ${num(a.min)} ? [] : ` : ""}[{ ...n, ${key(a.field)}: ${next} }]))`);
    }
    case "scrollTo": {
      const id = exprToTS(a.id, env);
      return `{ ...s, scrollTo: { y: MARKS.${rd.key}?.[String(${id})] ?? 0, n: (s.scrollTo?.n ?? 0) + 1 }, held: Infinity }`;
    }
  }
}

/** Module-level code for the routes' data: types, items, starting values, money, rules, scroll. */
export function dataModule(c: Ctx, screens: CompiledScreen[], rds: Map<string, RouteData>): string[] {
  const out: string[] = [];
  const appVars = c.proto.vars ?? {};
  out.push("", "/** What the app remembers across screens. */", "export interface AppData {");
  for (const [name, d] of Object.entries(appVars)) out.push(`  /** ${d.label.replace(/\*\//g, "")} */`, `  ${key(name)}: ${tsType(d)};`);
  out.push("}", "", `const APP_INIT = (): AppData => (${JSON.stringify(Object.fromEntries(Object.entries(appVars).map(([k, d]) => [k, d.init])))} as AppData);`);
  // A screen that draws a list starts, when the prototype starts on it, with the lines its design shows.
  out.push("const APP_SEED: Partial<Record<ScreenId, () => Partial<AppData>>> = {");
  for (const rd of rds.values()) {
    const seed: Record<string, Record<string, unknown>[]> = {};
    for (const b of rd.route.bindings ?? []) {
      const name = b.kind === "repeat" && !b.ref.part ? appVarName(b.of) : null;
      const def = name ? appVars[name] : undefined;
      if (!name || def?.type.t !== "list" || b.kind !== "repeat") continue;
      const fields = def.type.fields;
      seed[name] = [b.ref.path!, ...(b.others ?? [])].flatMap((p) => {
        const id = findLayer(c.doc, rd.screen, p);
        const line = id ? lineRecord(c.doc, id) : null;
        if (!line) return [];
        const all: Record<string, unknown> = { item: line.title, title: line.title, note: line.note, qty: line.qty, unit: line.unit };
        return [Object.fromEntries(Object.keys(fields).map((f) => [f, all[f] ?? (fields[f] === "text" ? "" : 0)]))];
      });
    }
    if (Object.keys(seed).length) out.push(`  ${key(rd.key)}: () => (${JSON.stringify(seed)}),`);
  }
  out.push("};");
  for (const rd of rds.values()) {
    out.push("", `/** What ${screens.find((s) => s.id === rd.screen)?.name.replace(/\*\//g, "") ?? rd.key} remembers while you're on it. */`, `export interface ${rd.type} {`);
    for (const [name, d] of Object.entries(rd.vars)) out.push(`  /** ${d.label.replace(/\*\//g, "")} */`, `  ${key(name)}: ${tsType(d)};`);
    out.push("}", `const ${rd.fn} = (s: State) => s.data as unknown as ${rd.type};`);
    out.push(`const money_${rd.key} = ${moneyCode(rd.money)};`);
    for (const [f, name] of rd.moneyFns) out.push(`const ${name} = ${moneyCode(JSON.parse(f) as MoneyFormat)};`);
  }
  out.push("", "/** Each screen's starting values (a visit starts with them). */", "const INIT: Record<ScreenId, () => Record<string, unknown>> = {");
  for (const s of screens) {
    const rd = rds.get(s.id);
    out.push(`  ${key(s.key)}: () => (${JSON.stringify(Object.fromEntries(Object.entries(rd?.vars ?? {}).map(([k, d]) => [k, d.init])))}),`);
  }
  for (const p of c.pending) out.push(`  ${key(p.key)}: () => ({}),`);
  out.push("};", "", "/** Values that start over when a part opens (a sheet's choices). */", "const RESETS: Partial<Record<ScreenId, Record<string, string[]>>> = {");
  for (const rd of rds.values()) if (Object.keys(rd.resets).length) out.push(`  ${key(rd.key)}: ${JSON.stringify(rd.resets)},`);
  out.push("};", "", "/** Items as the design shows them (read off it by Qalam: titles, prices in minor units, what an option adds). */", "const ITEMS = {");
  for (const rd of rds.values()) {
    out.push(`  ${key(rd.key)}: {`);
    for (const [col, recs] of Object.entries(rd.items)) {
      out.push(`    ${key(col)}: {`);
      for (const r of recs) out.push(`      ${lit(r.id)}: ${JSON.stringify(r)},`);
      out.push("    } as Record<string, Item>,");
    }
    out.push("  },");
  }
  out.push("};", "", "export interface Item {", "  id: string;", "  index: number;", "  title: string;", "  caption: string;", "  money: number;", "  delta: number;", "  image: string;", "}");
  out.push("", "/** Where scrolling flips a value, and the sections it follows (scrollTop of each). */", "const SCROLL: Partial<Record<ScreenId, { past: [string, number][]; spy?: { v: string; marks: [string, number][] } }>> = {");
  for (const rd of rds.values()) {
    if (!rd.past.length && !rd.spy) continue;
    out.push(`  ${key(rd.key)}: { past: ${JSON.stringify(rd.past.map((p) => [p.v, p.y]))}${rd.spy ? `, spy: { v: ${lit(rd.spy.v)}, marks: ${JSON.stringify(rd.spy.marks)} }` : ""} },`);
  }
  out.push("};", "const MARKS: Partial<Record<ScreenId, Record<string, number>>> = {");
  for (const rd of rds.values()) if (rd.spy) out.push(`  ${key(rd.key)}: ${JSON.stringify(Object.fromEntries(rd.spy.marks))},`);
  out.push("};");
  out.push("", "/** Each screen's rules: what a tap (or a timer) does to the state. */", "const RULES: Partial<Record<ScreenId, Record<string, (s: State, it: string | undefined, anchor?: Box) => State>>> = {");
  for (const rd of rds.values()) {
    out.push(`  ${key(rd.key)}: {`);
    for (const ru of rd.route.rules) for (const l of ruleCode(c, rd, ru)) out.push(`  ${l}`);
    out.push("  },");
  }
  out.push("};", "", "/** What each tappable layer runs (for tools and tests that play the prototype without a screen). */", `export const TAPS: Record<string, { rule: string; it?: string }[]> = ${JSON.stringify(c.taps)};`);
  return out;
}
