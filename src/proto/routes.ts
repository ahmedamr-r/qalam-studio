/**
 * Routes (pure): a screen and the parts that belong to it — overlays it opens (sheet, dialog,
 * toast, menu) and add-ons it shows (a bar) — with the rules that open and close them. The model
 * lives in doc.proto.routes (types in doc/proto-types.ts); parts are top-level frames beside the
 * screen, built from specs with a `surface`. Here: validating stored routes, dropping what points
 * at frames that are gone, and reading which frame belongs to which screen.
 */
import { isMotionRef, nativeDefault } from "@/design-system/motion";
import { findMoney } from "./money";
import type { AddOnDef, Binding, Collection, Dismiss, Doc, Expr, NextPage, OverlayDef, OverlayKind, PlayAction, ProtoTransitionKind, RouteAction, RouteProto, RouteRef, RouteRule, RouteStep, RouteTrigger, SceneNode, ScrollEffect, Slot, SubRef, SwapDef, Value, VarDef, VarType } from "@/doc/schema";

export const OVERLAY_KINDS = ["sheet", "dialog", "toast", "menu"] as const satisfies readonly OverlayKind[];
export const DISMISS = ["scrim", "drag", "back", "timer"] as const satisfies readonly Dismiss[];
const TRANSITIONS = ["smart", "push", "dissolve", "sheet"] as const satisfies readonly ProtoTransitionKind[];

/** Per route. */
export const MAX_OVERLAYS = 12;
export const MAX_ADDONS = 6;
export const MAX_RULES = 100;
/** Asks queued for a route, and an ask's length. */
export const MAX_ASKS = 6;
/** Pages not designed yet a route goes to, at most. */
export const MAX_NEXT = 6;
const MAX_ASK = 200;
/** A toast shows this long unless it says otherwise. */
export const TOAST_MS = 3000;

/** How each kind closes on its own unless the designer says otherwise. */
export const DEFAULT_DISMISS: Record<OverlayKind, Dismiss[]> = {
  sheet: ["scrim", "drag", "back"],
  dialog: ["back"],
  toast: ["timer"],
  menu: ["scrim", "back"],
};

export const emptyRoute = (): RouteProto => ({ overlays: {}, addOns: {}, rules: [] });

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const str = (v: unknown, max = 40) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const PART = /^[a-z][a-z0-9-]{0,31}$/;
/** A spec path; `*` stands for every item of a collection ("body.*.children.*"). */
const PATH = /^(header|sidebar|hero|body|footer)(\.(\d+|\*)(\.children\.(\d+|\*))*)?$/;
const NAME = /^[a-z][A-Za-z0-9]{0,31}$/;
const VAR = /^(app\.)?[a-z][A-Za-z0-9]{0,31}$/;
const ROLES = ["option", "increase", "decrease", "leading", "trailing", "action"] as const satisfies readonly SubRef["role"][];

export const isPartId = (v: unknown): v is string => typeof v === "string" && PART.test(v);

function ref(v: unknown): RouteRef | null {
  const o = obj(v);
  if (!o) return null;
  const out: RouteRef = {};
  if (o.part !== undefined && o.part !== null && o.part !== "") {
    if (!isPartId(o.part)) return null;
    out.part = o.part;
  }
  if (o.path !== undefined && o.path !== null && o.path !== "") {
    if (typeof o.path !== "string" || !PATH.test(o.path)) return null;
    out.path = o.path;
  }
  const sub = obj(o.sub);
  if (sub) {
    if (!oneOf(ROLES, sub.role)) return null;
    out.sub = { role: sub.role };
    if (typeof sub.nth === "number" && Number.isInteger(sub.nth) && sub.nth >= 0 && sub.nth < 50) out.sub.nth = sub.nth;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data

const BINOPS = ["+", "-", "*", "min", "max", "and", "or", "==", "!=", "<", "<=", ">", ">="] as const;

/** An expression as stored: its shape checked all the way down (at most 200 nodes, 12 deep). */
export function normalizeExpr(x: unknown, budget = { n: 200 }, depth = 0): Expr | undefined {
  if (--budget.n < 0 || depth > 12) return undefined;
  if (x === null || typeof x === "boolean") return x;
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (typeof x === "string") return x.slice(0, 200);
  const o = obj(x);
  if (!o) return undefined;
  const sub = (y: unknown) => normalizeExpr(y, budget, depth + 1);
  if (typeof o.v === "string") return VAR.test(o.v) ? { v: o.v } : undefined;
  if (typeof o.it === "string") return NAME.test(o.it) ? { it: o.it } : undefined;
  if (typeof o.ctx === "string") return NAME.test(o.ctx) ? { ctx: o.ctx } : undefined;
  if (typeof o.el === "string") return NAME.test(o.el) ? { el: o.el } : undefined;
  if (typeof o.money === "number") return Number.isSafeInteger(o.money) ? { money: o.money } : undefined;
  const args = Array.isArray(o.a) ? o.a.map(sub) : [];
  if (args.some((a) => a === undefined)) return undefined;
  const a = args as Expr[];
  if (oneOf(BINOPS, o.op)) return a.length >= 2 && a.length <= 8 ? { op: o.op, a } : undefined;
  if (o.op === "not") return a.length === 1 ? { op: "not", a: [a[0]] } : undefined;
  if (o.op === "if") return a.length === 3 ? { op: "if", a: [a[0], a[1], a[2]] } : undefined;
  if (o.op === "has") {
    const set = sub(o.set);
    const item = sub(o.a);
    return set !== undefined && item !== undefined ? { op: "has", set, a: item } : undefined;
  }
  if (o.op === "get") {
    const id = sub(o.id);
    return isPartLike(o.of) && id !== undefined && typeof o.field === "string" && NAME.test(o.field) ? { op: "get", of: o.of, id, field: o.field } : undefined;
  }
  if (o.op === "titles") {
    const ids = sub(o.ids);
    return isPartLike(o.of) && ids !== undefined ? { op: "titles", of: o.of, ids } : undefined;
  }
  if (o.op === "join") return a.length >= 1 && a.length <= 8 ? { op: "join", a, sep: typeof o.sep === "string" ? o.sep.slice(0, 8) : " · " } : undefined;
  if (o.op === "count" || o.op === "sum") {
    const of = obj(o.of);
    const from = of && typeof of.v === "string" && VAR.test(of.v) ? { v: of.v } : of && isPartLike(of.items) ? { items: of.items } : null;
    if (!from) return undefined;
    const out: Expr = { op: o.op, of: from };
    if (o.where !== undefined) {
      const w = sub(o.where);
      if (w === undefined) return undefined;
      out.where = w;
    }
    if (o.value !== undefined) {
      const v = sub(o.value);
      if (v === undefined) return undefined;
      out.value = v;
    }
    return out;
  }
  return undefined;
}

const isPartLike = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-zA-Z0-9-]{0,31}$/.test(v);

function varType(x: unknown): VarType | null {
  const o = obj(x);
  switch (o?.t) {
    case "bool":
    case "money":
      return { t: o.t };
    case "int": {
      const min = typeof o.min === "number" ? Math.round(o.min) : 0;
      const max = typeof o.max === "number" ? Math.round(o.max) : 99;
      return { t: "int", min: Math.min(min, max), max: Math.max(min, max) };
    }
    case "text":
      return { t: "text", max: typeof o.max === "number" ? Math.max(1, Math.min(500, Math.round(o.max))) : 120 };
    case "choice":
    case "set":
      return isPartLike(o.of) ? { t: o.t, of: o.of } : null;
    case "list": {
      const f = obj(o.fields);
      if (!f) return null;
      const fields = Object.fromEntries(Object.entries(f).filter(([k, v]) => NAME.test(k) && (v === "text" || v === "int" || v === "money")).slice(0, 12)) as Record<string, "text" | "int" | "money">;
      return Object.keys(fields).length ? { t: "list", fields } : null;
    }
    default:
      return null;
  }
}

/** A value that fits its type (else the type's empty value). */
function valueFor(t: VarType, v: unknown): Value {
  switch (t.t) {
    case "bool":
      return v === true;
    case "int":
      return typeof v === "number" && Number.isFinite(v) ? Math.min(t.max, Math.max(t.min, Math.round(v))) : t.min;
    case "money":
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
    case "text":
      return typeof v === "string" ? v.slice(0, t.max) : "";
    case "choice":
      return typeof v === "string" ? v.slice(0, 80) : null;
    case "set":
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
    case "list":
      return Array.isArray(v) ? (v.filter((r) => obj(r)) as never[]).slice(0, 100) : [];
  }
}

/** Vars as stored, by name. */
export function normalizeVars(x: unknown): Record<string, VarDef> | undefined {
  const out: Record<string, VarDef> = {};
  for (const [name, raw] of Object.entries(obj(x) ?? {}).slice(0, 40)) {
    const o = obj(raw);
    const type = varType(o?.type);
    if (!o || !type || !NAME.test(name)) continue;
    const def: VarDef = { type, init: valueFor(type, o.init), label: str(o.label, 60) ?? name };
    if (isPartId(o.resetOn)) def.resetOn = o.resetOn;
    out[name] = def;
  }
  return Object.keys(out).length ? out : undefined;
}

function slot(x: unknown): Slot | null {
  const o = obj(x);
  const e = normalizeExpr(o?.e);
  if (!o || e === undefined || (o.fmt !== "text" && o.fmt !== "int" && o.fmt !== "money")) return null;
  return typeof o.at === "string" && o.at.trim() && o.at.length <= 80 ? { e, fmt: o.fmt, at: o.at } : { e, fmt: o.fmt };
}

function slots(x: unknown): Record<string, Slot> | null {
  const out: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(obj(x) ?? {}).slice(0, 6)) {
    const s = slot(v);
    if (s && NAME.test(k)) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

function binding(x: unknown): Binding | null {
  const o = obj(x);
  const r = ref(o?.ref);
  if (!o || !r) return null;
  if (o.kind === "text") {
    const s = slots(o.slots);
    return s ? { kind: "text", ref: r, slots: s } : null;
  }
  if (o.kind === "repeat") {
    if (typeof o.of !== "string" || !VAR.test(o.of) || !r.path) return null;
    const others = (Array.isArray(o.others) ? o.others : []).filter((p): p is string => typeof p === "string" && PATH.test(p) && !p.includes("*")).slice(0, 20);
    return { kind: "repeat", ref: r, of: o.of, ...(others.length ? { others } : {}) };
  }
  const e = normalizeExpr(o.e);
  if (e === undefined) return null;
  if (o.kind === "prop") return typeof o.prop === "string" && NAME.test(o.prop) ? { kind: "prop", ref: r, prop: o.prop, e } : null;
  if (o.kind === "visible") return { kind: "visible", ref: r, e };
  return null;
}

function swap(x: unknown): SwapDef | null {
  const o = obj(x);
  const r = ref(o?.ref);
  const when = normalizeExpr(o?.when);
  const inst = obj(o?.inst);
  if (!o || !r || when === undefined || !inst || typeof inst.component !== "string") return null;
  const out: SwapDef = { label: str(o.label, 60) ?? "Swap", ref: r, when, inst: { component: inst.component, ...(obj(inst.props) ? { props: inst.props as Record<string, unknown> } : {}) } };
  const s = slots(o.slots);
  if (s) out.slots = s;
  return out;
}

function scrollEffect(x: unknown): ScrollEffect | null {
  const o = obj(x);
  if (!o) return null;
  if (o.kind === "spy") return isPartLike(o.items) && typeof o.v === "string" && NAME.test(o.v) ? { kind: "spy", items: o.items, v: o.v } : null;
  const r = ref(o.ref);
  if (!r) return null;
  if (o.kind === "stick") return { kind: "stick", ref: r };
  if (o.kind === "past") return typeof o.v === "string" && NAME.test(o.v) ? { kind: "past", ref: r, v: o.v } : null;
  return null;
}

function collection(x: unknown): Collection | null {
  const o = obj(x);
  const r = ref(o?.of);
  if (!o || !r?.path) return null;
  const out: Collection = { label: str(o.label, 60) ?? "Items", of: r };
  if (typeof o.component === "string" && /^[A-Z][\w/]{0,40}$/.test(o.component)) out.component = o.component;
  return out;
}

function trigger(v: unknown): RouteTrigger | null {
  const o = obj(v);
  if (!o) return null;
  if (o.on === "enter") return { on: "enter" };
  if (o.on === "delay") return { on: "delay", ms: typeof o.ms === "number" && Number.isFinite(o.ms) ? Math.round(Math.min(60_000, Math.max(0, o.ms))) : 800 };
  if (o.on === "tap" || o.on === "press" || o.on === "hover") {
    const r = ref(o.ref);
    return r ? { on: o.on, ref: r } : null;
  }
  return null;
}

function action(v: unknown): RouteAction | null {
  const o = obj(v);
  if (!o) return null;
  switch (o.do) {
    case "open": {
      if (!isPartId(o.part)) return null;
      const item = o.item === undefined ? undefined : normalizeExpr(o.item);
      return item === undefined ? { do: "open", part: o.part } : { do: "open", part: o.part, item };
    }
    case "set": {
      const e = normalizeExpr(o.e);
      return typeof o.v === "string" && VAR.test(o.v) && e !== undefined ? { do: "set", v: o.v, e } : null;
    }
    case "inc":
      return typeof o.v === "string" && VAR.test(o.v) && typeof o.by === "number" && Number.isFinite(o.by) ? { do: "inc", v: o.v, by: Math.round(o.by) } : null;
    case "toggle": {
      if (typeof o.v !== "string" || !VAR.test(o.v)) return null;
      const id = o.id === undefined ? undefined : normalizeExpr(o.id);
      return id === undefined ? { do: "toggle", v: o.v } : { do: "toggle", v: o.v, id };
    }
    case "push": {
      const rec = obj(o.record);
      if (typeof o.v !== "string" || !VAR.test(o.v) || !rec) return null;
      const record: Record<string, Expr> = {};
      for (const [k, x] of Object.entries(rec).slice(0, 12)) {
        const e = normalizeExpr(x);
        if (e !== undefined && NAME.test(k)) record[k] = e;
      }
      return Object.keys(record).length ? { do: "push", v: o.v, record } : null;
    }
    case "change": {
      if (typeof o.v !== "string" || !VAR.test(o.v) || typeof o.field !== "string" || !NAME.test(o.field) || typeof o.by !== "number" || !Number.isFinite(o.by)) return null;
      return { do: "change", v: o.v, field: o.field, by: Math.round(o.by), ...(typeof o.min === "number" && Number.isFinite(o.min) ? { min: Math.round(o.min) } : {}) };
    }
    case "remove": {
      const where = normalizeExpr(o.where);
      return typeof o.v === "string" && VAR.test(o.v) && where !== undefined ? { do: "remove", v: o.v, where } : null;
    }
    case "scrollTo": {
      const id = normalizeExpr(o.id);
      return isPartLike(o.items) && id !== undefined ? { do: "scrollTo", items: o.items, id } : null;
    }
    case "close":
      return o.part === undefined || o.part === null ? { do: "close" } : isPartId(o.part) ? { do: "close", part: o.part } : null;
    case "back":
      return { do: "back" };
    case "go":
    case "next": {
      const to = o.do === "go" ? str(o.screen) : isPartId(o.page) ? o.page : null;
      const t = obj(o.transition);
      if (!to || !t || !oneOf(TRANSITIONS, t.kind) || !isMotionRef(t.motion)) return null;
      // What rules took by default before native motion moves natively now (nativeDefault).
      const transition = { kind: t.kind, motion: nativeDefault(t.kind, t.motion) };
      return o.do === "go" ? { do: "go", screen: to, transition } : { do: "next", page: to, transition };
    }
    default:
      return null;
  }
}

function overlay(v: unknown): OverlayDef | null {
  const o = obj(v);
  const frame = str(o?.frame);
  if (!o || !frame || !oneOf(OVERLAY_KINDS, o.kind)) return null;
  const dismiss = Array.isArray(o.dismiss) ? [...new Set(o.dismiss.filter((d): d is Dismiss => oneOf(DISMISS, d)))] : DEFAULT_DISMISS[o.kind];
  const out: OverlayDef = { frame, kind: o.kind, dismiss };
  if (o.kind === "sheet" && (o.detent === "content" || o.detent === "full")) out.detent = o.detent;
  if (o.kind === "menu") {
    const a = ref(o.anchor);
    if (a) out.anchor = a;
  }
  if (o.kind === "toast") out.ms = typeof o.ms === "number" && Number.isFinite(o.ms) ? Math.round(Math.min(10_000, Math.max(1000, o.ms))) : TOAST_MS;
  return out;
}

function addOn(v: unknown): AddOnDef | null {
  const o = obj(v);
  const frame = str(o?.frame);
  if (!o || !frame) return null;
  const out: AddOnDef = { frame, region: o.region === "top" ? "top" : "bottom" };
  const when = o.when === undefined ? undefined : normalizeExpr(o.when);
  if (when !== undefined) out.when = when;
  return out;
}

function rule(v: unknown): RouteRule | null {
  const o = obj(v);
  const id = str(o?.id, 24);
  const when = trigger(o?.when);
  if (!o || !id || !when) return null;
  const then = (Array.isArray(o.then) ? o.then : []).map(action).filter((a): a is RouteAction => !!a).slice(0, 8);
  if (!then.length) return null;
  const out: RouteRule = { id, when, then };
  const cond = o.if === undefined ? undefined : normalizeExpr(o.if);
  if (cond !== undefined) out.if = cond;
  if (isPartLike(o.each)) out.each = o.each;
  return out;
}

/** One route as stored or opened; null when nothing in it holds up. */
export function normalizeRoute(x: unknown): RouteProto | null {
  const o = obj(x);
  if (!o) return null;
  const r = emptyRoute();
  for (const [id, v] of Object.entries(obj(o.overlays) ?? {}).slice(0, MAX_OVERLAYS)) {
    const def = overlay(v);
    if (isPartId(id) && def) r.overlays[id] = def;
  }
  for (const [id, v] of Object.entries(obj(o.addOns) ?? {}).slice(0, MAX_ADDONS)) {
    const def = addOn(v);
    if (isPartId(id) && def && !r.overlays[id]) r.addOns[id] = def;
  }
  const ids = new Set<string>();
  for (const v of (Array.isArray(o.rules) ? o.rules : []).slice(0, MAX_RULES)) {
    const ru = rule(v);
    if (ru && !ids.has(ru.id)) {
      ids.add(ru.id);
      r.rules.push(ru);
    }
  }
  const vars = normalizeVars(o.vars);
  if (vars) r.vars = vars;
  const items: Record<string, Collection> = {};
  for (const [id, v] of Object.entries(obj(o.items) ?? {}).slice(0, 12)) {
    const c = collection(v);
    if (c && isPartLike(id)) items[id] = c;
  }
  if (Object.keys(items).length) r.items = items;
  const bindings = (Array.isArray(o.bindings) ? o.bindings : []).map(binding).filter((b): b is Binding => !!b).slice(0, 100);
  if (bindings.length) r.bindings = bindings;
  const swaps = (Array.isArray(o.swaps) ? o.swaps : []).map(swap).filter((b): b is SwapDef => !!b).slice(0, 20);
  if (swaps.length) r.swaps = swaps;
  const scroll = (Array.isArray(o.scroll) ? o.scroll : []).map(scrollEffect).filter((b): b is ScrollEffect => !!b).slice(0, 20);
  if (scroll.length) r.scroll = scroll;
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(routeStep).filter((x): x is RouteStep => !!x).slice(0, 24);
  if (steps.length) r.steps = steps;
  const asks = normalizeAsks(o.asks);
  if (asks.length) r.asks = asks;
  const next: Record<string, NextPage> = {};
  for (const [id, v] of Object.entries(obj(o.next) ?? {}).slice(0, MAX_NEXT)) {
    const page = obj(v);
    const name = str(page?.name, 40);
    if (isPartId(id) && name) next[id] = { name, brief: str(page?.brief, 300) ?? "" };
  }
  if (Object.keys(next).length) r.next = next;
  return isUnusedRoute(r) ? null : withValidParts(r);
}

/** A route that does nothing (whatever is queued for it). */
export const isEmptyRoute = (r: RouteProto) =>
  !Object.keys(r.overlays).length && !Object.keys(r.addOns).length && !r.rules.length && !r.bindings?.length && !r.scroll?.length && !r.swaps?.length && !Object.keys(r.vars ?? {}).length;

/** A route with nothing in it at all: it does nothing and nothing is queued for it. */
export const isUnusedRoute = (r: RouteProto) => isEmptyRoute(r) && !r.asks?.length;

/** Asks as stored: a few distinct lines of the designer's words. */
export function normalizeAsks(x: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(x) ? x : []) {
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_ASK) : "";
    if (t && !out.some((a) => a.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, MAX_ASKS);
}

function playAction(x: unknown): PlayAction | null {
  const o = obj(x);
  if (!o) return null;
  if (o.do === "scroll") return typeof o.y === "number" && Number.isFinite(o.y) ? { do: "scroll", y: Math.max(0, Math.round(o.y)) } : null;
  const r = ref(o.ref);
  return r && (o.do === "tap" || o.do === "look") ? { do: o.do, ref: r } : null;
}

function routeStep(x: unknown): RouteStep | null {
  const o = obj(x);
  if (!o || typeof o.id !== "string" || !NAME.test(o.id) || typeof o.label !== "string" || !o.label.trim()) return null;
  const play = (Array.isArray(o.play) ? o.play : []).map(playAction).filter((a): a is PlayAction => !!a).slice(0, 16);
  const at = ref(o.at);
  return { id: o.id, recipe: typeof o.recipe === "string" ? o.recipe.slice(0, 40) : "rules", label: o.label.trim().slice(0, 140), ...(at ? { at } : {}), play };
}

/** A step id not taken in the route ("s1", "s2"…). */
export function newStepId(route: RouteProto | undefined): string {
  const taken = new Set((route?.steps ?? []).map((x) => x.id));
  let i = (route?.steps?.length ?? 0) + 1;
  while (taken.has(`s${i}`)) i++;
  return `s${i}`;
}

/** Rules may only point at the route's own parts. */
function withValidParts(r: RouteProto): RouteProto {
  const has = (p: string | undefined) => p === undefined || !!r.overlays[p] || !!r.addOns[p];
  const actionOk = (a: RouteAction) => (a.do === "open" ? has(a.part) : a.do === "close" ? has(a.part) : a.do === "next" ? !!r.next?.[a.page] : true);
  const triggerOk = (t: RouteTrigger) => !("ref" in t) || has(t.ref.part);
  const anchorOk = (o: OverlayDef) => !o.anchor || has(o.anchor.part);
  let changed = false;
  const rules: RouteRule[] = [];
  for (const ru of r.rules) {
    if (!triggerOk(ru.when)) {
      changed = true;
      continue;
    }
    const then = ru.then.filter(actionOk);
    if (then.length !== ru.then.length) changed = true;
    if (then.length) rules.push(then.length === ru.then.length ? ru : { ...ru, then });
  }
  const overlays = Object.fromEntries(
    Object.entries(r.overlays).map(([id, o]) => {
      if (anchorOk(o)) return [id, o];
      changed = true;
      const rest = { ...o };
      delete rest.anchor;
      return [id, rest];
    }),
  );
  // What reads or shows things in a part goes with the part.
  const keep = <T extends { ref: RouteRef }>(list: T[] | undefined) => {
    if (!list) return list;
    const ok = list.filter((x) => has(x.ref.part));
    if (ok.length !== list.length) changed = true;
    return ok.length ? ok : undefined;
  };
  const bindings = keep(r.bindings);
  const swaps = keep(r.swaps);
  const scroll = r.scroll ? r.scroll.filter((x) => x.kind === "spy" || has(x.ref.part)) : undefined;
  if (scroll && r.scroll && scroll.length !== r.scroll.length) changed = true;
  const items = r.items ? Object.fromEntries(Object.entries(r.items).filter(([, c]) => has(c.of.part))) : undefined;
  if (items && r.items && Object.keys(items).length !== Object.keys(r.items).length) changed = true;
  const steps = r.steps?.map((st) => {
    const play = st.play.filter((a) => a.do === "scroll" || has(a.ref.part));
    const at = st.at && has(st.at.part) ? st.at : undefined;
    if (play.length === st.play.length && at === st.at) return st;
    changed = true;
    return { ...st, play, ...(at ? { at } : {}) };
  });
  // A page not designed yet is there for what leads to it.
  const led = new Set(rules.flatMap((ru) => ru.then.flatMap((a) => (a.do === "next" ? [a.page] : []))));
  const next = r.next && Object.keys(r.next).some((k) => !led.has(k)) ? Object.fromEntries(Object.entries(r.next).filter(([k]) => led.has(k))) : r.next;
  if (next !== r.next) changed = true;
  if (!changed) return r;
  const out: RouteProto = { ...r, overlays, rules, ...(steps ? { steps } : {}) };
  if (next && Object.keys(next).length) out.next = next;
  else delete out.next;
  for (const [k, v] of [["bindings", bindings], ["swaps", swaps], ["scroll", scroll?.length ? scroll : undefined], ["items", items && Object.keys(items).length ? items : undefined]] as const) {
    if (v) (out as unknown as Record<string, unknown>)[k] = v;
    else delete (out as unknown as Record<string, unknown>)[k];
  }
  return out;
}

/** Every route, validated; undefined when there are none. */
export function normalizeRoutes(x: unknown): Record<string, RouteProto> | undefined {
  const o = obj(x);
  if (!o) return undefined;
  const out: Record<string, RouteProto> = {};
  for (const [screen, raw] of Object.entries(o)) {
    const r = normalizeRoute(raw);
    if (r && str(screen)) out[screen] = r;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The routes without what points at frames that are gone: a deleted screen's route, parts whose
 * frame was deleted, rules that open those parts or go to deleted screens. `routes` itself when
 * nothing does.
 */
export function pruneRoutes(routes: Record<string, RouteProto>, roots: readonly string[]): Record<string, RouteProto> | undefined {
  const has = new Set(roots);
  let changed = false;
  const out: Record<string, RouteProto> = {};
  for (const [screen, r] of Object.entries(routes)) {
    if (!has.has(screen)) {
      changed = true;
      continue;
    }
    const overlays = Object.fromEntries(Object.entries(r.overlays).filter(([, o]) => has.has(o.frame)));
    const addOns = Object.fromEntries(Object.entries(r.addOns).filter(([, a]) => has.has(a.frame)));
    const lost = Object.keys(overlays).length !== Object.keys(r.overlays).length || Object.keys(addOns).length !== Object.keys(r.addOns).length;
    const goOk = (a: RouteAction) => a.do !== "go" || has.has(a.screen);
    const goesAway = r.rules.some((ru) => !ru.then.every(goOk));
    if (!lost && !goesAway) {
      out[screen] = r;
      continue;
    }
    changed = true;
    const rules = r.rules.map((ru) => (ru.then.every(goOk) ? ru : { ...ru, then: ru.then.filter(goOk) })).filter((ru) => ru.then.length);
    // The rest stays: what reads or shows the lost parts goes with them, not the screen's scroll, values or steps.
    const next = withValidParts({ ...r, overlays, addOns, rules });
    if (!isUnusedRoute(next)) out[screen] = next;
  }
  if (!changed) return routes;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Reading the document

export interface PartInfo {
  /** The screen it belongs to. */
  owner: string;
  part: string;
  kind: OverlayKind | "bar";
}

const indexes = new WeakMap<Record<string, RouteProto>, Map<string, PartInfo>>();

/** Frame id → the route part it draws, for every route (memoized per routes object). */
export function partIndex(doc: Doc): Map<string, PartInfo> {
  const routes = doc.proto?.routes;
  if (!routes) return EMPTY;
  let m = indexes.get(routes);
  if (!m) {
    m = new Map();
    for (const [owner, r] of Object.entries(routes)) {
      for (const [part, o] of Object.entries(r.overlays)) m.set(o.frame, { owner, part, kind: o.kind });
      for (const [part, a] of Object.entries(r.addOns)) m.set(a.frame, { owner, part, kind: "bar" });
    }
    indexes.set(routes, m);
  }
  return m;
}
const EMPTY = new Map<string, PartInfo>();

/** A frame a screen opens or shows (an overlay or an add-on), not a screen of its own. */
export const isPart = (doc: Doc, id: string) => partIndex(doc).has(id);
export const partOf = (doc: Doc, id: string): PartInfo | undefined => partIndex(doc).get(id);

export const routeOf = (doc: Doc, screen: string): RouteProto | undefined => doc.proto?.routes?.[screen];

/** A route's part frames: overlays first, then add-ons, in the order they were added. */
export function partFrames(doc: Doc, screen: string): { part: string; frame: string; kind: OverlayKind | "bar" }[] {
  const r = routeOf(doc, screen);
  if (!r) return [];
  return [
    ...Object.entries(r.overlays).map(([part, o]) => ({ part, frame: o.frame, kind: o.kind as OverlayKind | "bar" })),
    ...Object.entries(r.addOns).map(([part, a]) => ({ part, frame: a.frame, kind: "bar" as const })),
  ].filter((p) => !!doc.nodes[p.frame]);
}

/** The frame a ref points into: the screen, or one of its parts. */
export function refFrame(doc: Doc, screen: string, r: RouteRef): string | null {
  if (!r.part) return doc.nodes[screen] ? screen : null;
  const route = routeOf(doc, screen);
  const frame = route?.overlays[r.part]?.frame ?? route?.addOns[r.part]?.frame;
  return frame && doc.nodes[frame] ? frame : null;
}

/** The layer a ref points at: its frame, or the component at its spec path in that frame. */
export function resolveRef(doc: Doc, screen: string, r: RouteRef): string | null {
  const frame = refFrame(doc, screen, r);
  if (!frame || !r.path) return frame;
  return findLayer(doc, frame, r.path);
}

/** Every layer in `frame` at `path` (of `component`, when given), in layer order: each match of a pattern. */
export function findLayers(doc: Doc, frame: string, path: string, component?: string): string[] {
  const want = path.split(".");
  const at = (p: string | undefined) => p !== undefined && (p === path || (path.includes("*") && p.split(".").length === want.length && p.split(".").every((seg, i) => want[i] === "*" || want[i] === seg)));
  const out: string[] = [];
  const visit = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      if (at(doc.nodes[c]?.meta.specPath) && (!component || (doc.nodes[c].meta.component ?? "").startsWith(component))) out.push(c);
      visit(c);
    }
  };
  visit(frame);
  return out;
}

/** The first layer in `frame` at `path` (of `component`, when given), in layer order: a pattern's first match, the first dish's +. */
export function findLayer(doc: Doc, frame: string, path: string, component?: string): string | null {
  // doc/proto.ts's pathMatches (that module imports this one): `*` stands for one step.
  const want = path.split(".");
  const at = (p: string | undefined) => p !== undefined && (p === path || (path.includes("*") && p.split(".").length === want.length && p.split(".").every((seg, i) => want[i] === "*" || want[i] === seg)));
  const find = (id: string): string | null => {
    for (const c of doc.nodes[id]?.children ?? []) {
      if (at(doc.nodes[c]?.meta.specPath) && (!component || (doc.nodes[c].meta.component ?? "").startsWith(component))) return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  return find(frame);
}

/** A page id for a page named `name`, unique among the route's pages ("basket", "basket-2"). */
export function newPageId(route: RouteProto | undefined, name: string): string {
  const base = slug(name) || "page";
  if (!route?.next?.[base]) return base;
  for (let i = 2; ; i++) if (!route.next[`${base}-${i}`]) return `${base}-${i}`;
}

/** An action's words without the amount it shows: "View basket · AED 38.00" → "View basket". */
export function actionWords(label: string): string {
  const m = findMoney(label);
  const words = (m ? label.replace(m.text, " ") : label)
    .split(/\s+[·•|]\s+/)
    .map((x) => x.replace(/^[\s·•|:,–-]+|[\s·•|:,–-]+$/g, ""))
    .filter(Boolean)
    .join(" · ");
  return words || label.trim();
}

/** A page's name from the words of what leads there: "View basket · AED 38.00" → "Basket". */
export function pageName(label: string): string {
  const words = actionWords(label)
    .split(" · ")[0]
    .replace(/^(view|open|go to|see|show|continue to|proceed to)\s+/i, "")
    .trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "p$1")
    .slice(0, 24);

/** A part id for a new part named `name`, unique in the route ("options", "options-2"). */
export function newPartId(route: RouteProto | undefined, name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^(\d)/, "p$1")
      .slice(0, 24) || "part";
  const taken = (id: string) => !!route?.overlays[id] || !!route?.addOns[id];
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** A rule id unique in the route ("r1", "r2"…). */
export function newRuleId(route: RouteProto | undefined): string {
  const used = new Set(route?.rules.map((r) => r.id));
  for (let i = 1; ; i++) if (!used.has(`r${i}`)) return `r${i}`;
}

/** Screens with a route (their parts aren't screens). */
export const isRouteScreen = (doc: Doc, n: SceneNode | undefined) => !!n && n.type === "frame" && !n.parentId && !isPart(doc, n.id);
