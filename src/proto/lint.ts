/**
 * Checks on a route (pure): what would make its prototype break or lie — a sheet nothing closes, a
 * part nothing opens or shows, a rule or value that points at a layer that's gone, a value of the
 * wrong kind (a count shown as money, a pick set to a price), a total written in rather than
 * worked out, a target too small to tap. The Prototype tab lists them; what the prototyping agent
 * builds must pass them before it's kept.
 */
import type { Doc, Expr, RouteProto, RouteRef, SceneNode, Slot } from "@/doc/schema";
import { worldBounds } from "@/doc/geometry";
import { CATALOG_BY_NAME } from "@/design-system/components";
import { instOf } from "@/design-system/instances";
import { isPlatform } from "@/design-system/platform";
import { typeOf, varType, appVarName, type ExprType, type TypeEnv } from "./expr";
import { ITEM_FIELDS, collectionElements, itemOf, subLayers } from "./items";
import { findLayer, findLayers, refFrame } from "./routes";
import { componentAt, ctxCollections } from "./scope";

export interface ProtoIssue {
  severity: "error" | "warning";
  /** Which check found it. */
  check: "closes" | "opens" | "ref" | "type" | "written-total" | "target";
  message: string;
  /** What it's about: a part, a rule, or a binding, swap or scroll effect (by its index in the route). */
  at: { part?: string; rule?: string; binding?: number; swap?: number; scroll?: number };
}

/** The smallest a tap target may be, by platform (px): a finger, or a pointer (WCAG 2.5.8). */
const TARGET = { touch: 44, pointer: 24 };

/** What a frame is called in a message. */
const nameOf = (doc: Doc, id: string | null | undefined) => (id && doc.nodes[id]?.name) || "the screen";

/** A value that reads nothing: written in, not worked out. */
function constant(e: Expr): boolean {
  if (e === null || typeof e !== "object") return true;
  if ("money" in e) return true;
  if ("v" in e || "it" in e || "ctx" in e || "el" in e) return false;
  switch (e.op) {
    case "get":
    case "count":
    case "sum":
      return false;
    case "has":
      return constant(e.set) && constant(e.a);
    case "titles":
      return constant(e.ids);
    default:
      return e.a.every(constant);
  }
}

/** Does a value of type `got` fit where `want` is expected: `any` fits anything, and a pick is text (an item's id). */
const fits = (got: ExprType, want: ExprType | ExprType[]) => {
  const w = Array.isArray(want) ? want : [want];
  return got === "any" || w.includes(got) || (got === "text" && w.includes("id")) || (got === "id" && w.includes("text"));
};

/** Every check, for the route of `screen`. */
export function lintRoute(doc: Doc, screen: string): ProtoIssue[] {
  const route = doc.proto?.routes?.[screen];
  if (!route || !doc.nodes[screen]) return [];
  const out: ProtoIssue[] = [];
  const say = (severity: ProtoIssue["severity"], check: ProtoIssue["check"], message: string, at: ProtoIssue["at"]) => out.push({ severity, check, message, at });
  const partName = (part: string) => nameOf(doc, route.overlays[part]?.frame ?? route.addOns[part]?.frame);
  const where = (r: RouteRef) => (r.part ? `in "${partName(r.part)}"` : "on the screen");

  // A ref's layer (the first, for a pattern), or why there's none.
  const layer = (r: RouteRef): { id: string } | { missing: string } => {
    const frame = refFrame(doc, screen, r);
    if (!frame) return { missing: r.part ? `a part the route doesn't have ("${r.part}")` : "a screen that's gone" };
    const id = r.path ? findLayer(doc, frame, r.path, componentAt(route, r)) : frame;
    if (!id) return { missing: `${r.path} ${where(r)}, which isn't there any more` };
    if (!r.sub || subLayers(doc, id, r.sub.role).length) return { id };
    // A pattern holds when some match has the layer (a section's rows have a +, the carousel's tiles don't).
    const has = r.path?.includes("*") ? findLayers(doc, frame, r.path, componentAt(route, r)).find((x) => subLayers(doc, x, r.sub!.role).length) : undefined;
    return has ? { id: has } : { missing: `the ${r.sub.role} of "${doc.nodes[id].name}" ${where(r)}, which it doesn't have` };
  };

  checkParts(route, say, partName);
  checkRefs(doc, screen, route, say, layer);
  checkTypes(doc, screen, route, say);
  checkTargets(doc, screen, route, say, layer);
  return out;
}

type Say = (severity: ProtoIssue["severity"], check: ProtoIssue["check"], message: string, at: ProtoIssue["at"]) => void;

/** Every overlay closes and something opens it; every add-on shows at some point. */
function checkParts(route: RouteProto, say: Say, partName: (p: string) => string) {
  const opened = new Set(route.rules.flatMap((ru) => ru.then.flatMap((a) => (a.do === "open" ? [a.part] : []))));
  for (const [part, o] of Object.entries(route.overlays)) {
    const closesItself = route.rules.some((ru) => "ref" in ru.when && ru.when.ref.part === part && ru.then.some((a) => a.do === "back" || (a.do === "close" && (a.part === undefined || a.part === part))));
    if (!o.dismiss.length && !closesItself) say("error", "closes", `Nothing closes "${partName(part)}": let Back or the scrim close it, or give it a close button.`, { part });
    if (!opened.has(part)) say("warning", "opens", `Nothing opens "${partName(part)}".`, { part });
  }
  for (const [part, a] of Object.entries(route.addOns)) {
    if (a.when === undefined && !opened.has(part)) say("warning", "opens", `"${partName(part)}" never shows: nothing opens it, and it doesn't show while something holds.`, { part });
  }
}

/** Rules, values and scroll effects point at layers that are there. */
function checkRefs(doc: Doc, screen: string, route: RouteProto, say: Say, layer: (r: RouteRef) => { id: string } | { missing: string }) {
  for (const ru of route.rules) {
    if ("ref" in ru.when) {
      const l = layer(ru.when.ref);
      if ("missing" in l) say("error", "ref", `A ${ru.when.on} points at ${l.missing}.`, { rule: ru.id });
    }
    for (const a of ru.then) {
      if ((a.do === "open" || a.do === "close") && a.part && !route.overlays[a.part] && !route.addOns[a.part]) say("error", "ref", `A rule opens or closes a part the route doesn't have ("${a.part}").`, { rule: ru.id });
      if (a.do === "go" && !doc.nodes[a.screen]) say("error", "ref", "A rule goes to a screen that's gone.", { rule: ru.id });
      if (a.do === "scrollTo" && !route.items?.[a.items]) say("error", "ref", `A rule scrolls to an item of "${a.items}", which the route doesn't list.`, { rule: ru.id });
    }
    if (ru.each && !route.items?.[ru.each]) say("error", "ref", `A rule runs for each of "${ru.each}", which the route doesn't list.`, { rule: ru.id });
  }
  (route.bindings ?? []).forEach((b, i) => {
    const l = layer(b.ref);
    if ("missing" in l) say("error", "ref", `A value shows at ${l.missing}.`, { binding: i });
  });
  (route.swaps ?? []).forEach((sw, i) => {
    const l = layer(sw.ref);
    if ("missing" in l) say("error", "ref", `"${sw.label}" points at ${l.missing}.`, { swap: i });
  });
  (route.scroll ?? []).forEach((e, i) => {
    if (e.kind === "spy") {
      if (!route.items?.[e.items]) say("error", "ref", `Scrolling follows "${e.items}", which the route doesn't list.`, { scroll: i });
      return;
    }
    const l = layer(e.ref);
    if ("missing" in l) say("error", "ref", `A scroll effect points at ${l.missing}.`, { scroll: i });
  });
  for (const col of Object.values(route.items ?? {})) {
    if (!collectionElements(doc, screen, col).length) say("warning", "ref", `"${col.label}" has no items on the screen (nothing at ${col.of.path ?? "its path"}).`, {});
  }
}

/** Values are of the kind where they're used: money shown as money, a yes/no where one's expected, a total worked out. */
function checkTypes(doc: Doc, screen: string, route: RouteProto, say: Say) {
  const fields = Object.fromEntries(Object.keys(route.items ?? {}).map((id) => [id, ITEM_FIELDS as Record<string, ExprType>]));
  const ctx = ctxCollections(route);
  // `it`: the item the ref's (first) layer is in, as the compiled code finds it.
  const itAt = (r: RouteRef): string | undefined => {
    const frame = r.path ? refFrame(doc, screen, r) : null;
    const id = frame && r.path ? findLayer(doc, frame, r.path, componentAt(route, r)) : null;
    const p = id ? doc.nodes[id].meta.specPath : undefined;
    return p !== undefined ? itemOf(doc, screen, route.items ?? {}, r.part, p)?.collection : undefined;
  };
  const envFor = (r: RouteRef | undefined, each?: string): TypeEnv => ({
    routeVars: route.vars ?? {},
    appVars: doc.proto?.vars ?? {},
    fields,
    it: each ?? (r ? itAt(r) : undefined),
    ctx: r?.part ? ctx[r.part] : undefined,
  });
  // Inside a row drawn once per element of a list: what that element has.
  const repeats = (route.bindings ?? []).flatMap((b) => (b.kind === "repeat" ? [b] : []));
  const listOf = (v: string) => {
    const app = appVarName(v);
    const def = app ? doc.proto?.vars?.[app] : route.vars?.[v];
    return def?.type.t === "list" ? (def.type.fields as Record<string, ExprType>) : undefined;
  };
  const elAt = (r: RouteRef | undefined): Record<string, ExprType> | undefined => {
    const rep = r?.path ? repeats.find((b) => (b.ref.part ?? "") === (r.part ?? "") && !!b.ref.path && (r.path === b.ref.path || r.path!.startsWith(`${b.ref.path}.`))) : undefined;
    return rep ? listOf(rep.of) : undefined;
  };
  let el: Record<string, ExprType> | undefined;
  const check = (e: Expr, env: TypeEnv, at: ProtoIssue["at"], want?: ExprType | ExprType[], what?: string): ExprType => {
    const { type, problems } = typeOf(e, env, el);
    for (const p of problems) say("error", "type", p, at);
    if (want && !problems.length && !fits(type, want)) say("error", "type", `${what ?? "A value"} is ${KIND[type]}, not ${[want].flat().map((w) => KIND[w]).join(" or ")}.`, at);
    return type;
  };
  const slots = (ss: Record<string, Slot> | undefined, env: TypeEnv, at: ProtoIssue["at"]) => {
    for (const [name, slot] of Object.entries(ss ?? {})) {
      check(slot.e, env, at, slot.fmt === "money" ? "money" : slot.fmt === "int" ? "int" : undefined, `"{${name}}"`);
      // Totals are worked out from what's picked, never written in.
      if (slot.fmt === "money" && constant(slot.e)) say("error", "written-total", `"{${name}}" shows an amount that's written in, not worked out.`, at);
    }
  };
  (route.bindings ?? []).forEach((b, i) => {
    const env = envFor(b.ref);
    const at = { binding: i };
    el = elAt(b.ref);
    if (b.kind === "repeat") {
      if (!listOf(b.of)) say("error", "type", `A row is drawn for each of "${b.of}", which isn't a list.`, at);
    } else if (b.kind === "text") slots(b.slots, env, at);
    else if (b.kind === "visible") check(b.e, env, at, "bool", "What it shows while");
    else {
      const frame = refFrame(doc, screen, b.ref);
      const comp = frame && b.ref.path ? findLayer(doc, frame, b.ref.path) : null;
      const inst = comp ? instOf(doc, comp) : undefined;
      const spec = inst ? CATALOG_BY_NAME.get(inst.component)?.props[b.prop] : undefined;
      const want: ExprType[] | undefined = spec?.type === "boolean" ? ["bool"] : spec?.type === "number" ? ["int"] : spec?.type === "enum" || spec?.type === "string" ? ["text", "id"] : undefined;
      check(b.e, env, at, want, `Its ${b.prop}`);
    }
  });
  (route.swaps ?? []).forEach((sw, i) => {
    const env = envFor(sw.ref);
    el = elAt(sw.ref);
    check(sw.when, env, { swap: i }, "bool", `When "${sw.label}" shows`);
    slots(sw.slots, env, { swap: i });
  });
  for (const ru of route.rules) {
    const env = envFor("ref" in ru.when ? ru.when.ref : undefined, ru.each);
    const at = { rule: ru.id };
    el = elAt("ref" in ru.when ? ru.when.ref : undefined);
    if (ru.if !== undefined) check(ru.if, env, at, "bool", "When it runs");
    for (const a of ru.then) {
      const def = "v" in a ? (appVarName(a.v) ? doc.proto?.vars?.[appVarName(a.v)!] : route.vars?.[a.v]) : undefined;
      if ("v" in a && !def) {
        say("error", "type", `A rule changes "${a.v}", which the route doesn't remember.`, at);
        continue;
      }
      switch (a.do) {
        case "set":
          check(a.e, env, at, varType(def!.type), `What it sets "${a.v}" to`);
          // A pick written in names one of its items.
          if (def!.type.t === "choice" && typeof a.e === "string") {
            const col = route.items?.[def!.type.of];
            if (col && !collectionElements(doc, screen, col).some((el) => el.path === a.e)) say("error", "ref", `A rule picks "${a.e}" for "${a.v}", but "${col.label}" has no such item.`, at);
          }
          break;
        case "inc":
          if (def!.type.t !== "int" && def!.type.t !== "money") say("error", "type", `"${a.v}" isn't a number to count up or down.`, at);
          break;
        case "toggle":
          if (def!.type.t !== "bool" && def!.type.t !== "set") say("error", "type", `"${a.v}" isn't a yes/no or a set of picks to toggle.`, at);
          if (a.id !== undefined) check(a.id, env, at);
          break;
        case "push":
          if (def!.type.t !== "list") {
            say("error", "type", `"${a.v}" isn't a list to add to.`, at);
            break;
          }
          for (const [f, e] of Object.entries(a.record)) {
            const want = def!.type.fields[f] as ExprType | undefined;
            if (!want) say("error", "type", `Lines of "${a.v}" have no "${f}".`, at);
            else check(e, env, at, want, `Its "${f}"`);
          }
          break;
        case "remove":
          if (def!.type.t !== "list" && def!.type.t !== "set") say("error", "type", `"${a.v}" isn't a list to take from.`, at);
          break;
        case "change":
          if (def!.type.t !== "list") say("error", "type", `"${a.v}" isn't a list whose lines change.`, at);
          else if (def!.type.fields[a.field] !== "int") say("error", "type", `Lines of "${a.v}" have no count called "${a.field}".`, at);
          // It changes the line the tapped layer is drawn for: only inside a row drawn for each line.
          else if (!("ref" in ru.when) || !elAt(ru.when.ref)) say("error", "ref", `A rule changes a line of "${a.v}" from a layer that isn't in a row drawn for each line.`, at);
          break;
        case "open":
          if (a.item !== undefined) check(a.item, env, at);
          break;
        case "scrollTo":
          check(a.id, env, at);
          break;
      }
    }
  }
}

const KIND: Record<ExprType, string> = { bool: "a yes/no", int: "a count", money: "an amount of money", text: "text", id: "a pick", ids: "a set of picks", list: "a list", null: "nothing", any: "anything" };

/** What's tapped is big enough to tap. */
function checkTargets(doc: Doc, screen: string, route: RouteProto, say: Say, layer: (r: RouteRef) => { id: string } | { missing: string }) {
  const platform = doc.nodes[screen]?.meta.spec?.platform;
  const min = isPlatform(platform) && platform !== "mobile" ? TARGET.pointer : TARGET.touch;
  const seen = new Set<string>();
  for (const ru of route.rules) {
    if (!("ref" in ru.when) || (ru.when.on !== "tap" && ru.when.on !== "press")) continue;
    const l = layer(ru.when.ref);
    if ("missing" in l) continue;
    const ids = ru.when.ref.sub ? subLayers(doc, l.id, ru.when.ref.sub.role) : [l.id];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n: SceneNode = doc.nodes[id];
      const b = worldBounds(doc, id);
      const slop = n.meta.hitArea ?? 0;
      const w = Math.max(b.w, slop);
      const h = Math.max(b.h, slop);
      if (w + 0.5 < min || h + 0.5 < min) say("warning", "target", `"${n.name}" is ${Math.round(b.w)}×${Math.round(b.h)}: too small to ${ru.when.on} (${min}×${min} at least).`, { rule: ru.id });
    }
  }
}
