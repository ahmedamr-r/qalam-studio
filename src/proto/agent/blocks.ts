/**
 * Building blocks for what the designer asks that no recipe covers (pure): the model composes an
 * ask from a few of these, pointing at layers by id — a tap that flips a look (a heart that fills,
 * per item where it repeats), a tap that shows or hides something, a tap that opens a part, a tap
 * that shows a toast — and code expands each into the route's values, rules, bindings and swaps,
 * with its walkthrough. Nothing here works out money: a block can't.
 */
import { CATALOG_BY_NAME, type PropSpec } from "@/design-system/components";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { Binding, Collection, Expr, PlayAction, RouteProto, RouteRef, SwapDef, VarDef } from "@/doc/schema";
import type { RouteDelta } from "../recipes";
import type { FrameScan } from "../scan";
import type { LayerEntry } from "./layers";

export type BlockKind = "toggle-look" | "reveal" | "open-part" | "toast";

export interface Block {
  kind: BlockKind;
  /** The layer tapped (an id from the layer index). */
  on: string;
  /** reveal: what shows and hides. */
  target?: string;
  /** toggle-look: the tapped component's props, changed while it's on. */
  look?: { prop: string; value: string }[];
  /** reveal: shown or hidden to begin with. */
  start?: "shown" | "hidden";
  /** toast: what it says; open-part: what the part is for. */
  text?: string;
  /** open-part: what kind of part. */
  part?: "sheet" | "dialog" | "menu";
}

/** A prop's value from the model's string, when the component takes it. */
function propValue(spec: PropSpec | undefined, raw: string): unknown | undefined {
  if (!spec) return undefined;
  const v = raw.trim();
  switch (spec.type) {
    case "boolean":
      return v === "true" ? true : v === "false" ? false : undefined;
    case "enum":
      return spec.values?.includes(v) ? v : undefined;
    case "number":
      return Number.isFinite(Number(v)) ? Number(v) : undefined;
    case "string":
      return v ? v.slice(0, spec.maxChars) : undefined;
    case "icon":
      return /^[a-z0-9-]{1,40}$/.test(v) ? v : undefined;
    default:
      return undefined;
  }
}

/** What's wrong with a block, against the layers and the catalog (empty: it can be built). */
export function blockIssues(b: Block, layers: Map<string, LayerEntry>): string[] {
  const on = layers.get(b.on);
  if (!on) return [`It taps a layer that isn't on the screen ("${b.on}").`];
  switch (b.kind) {
    case "toggle-look": {
      const spec = CATALOG_BY_NAME.get(on.component);
      const ok = (b.look ?? []).filter((x) => propValue(spec?.props[x.prop], x.value) !== undefined && String(on.props[x.prop] ?? "") !== x.value.trim());
      return ok.length ? [] : [`Nothing it can change in how ${on.what} looks.`];
    }
    case "reveal": {
      const t = b.target ? layers.get(b.target) : undefined;
      if (!t) return ["It shows or hides a layer that isn't on the screen."];
      if (t.each && !on.each) return ["What it shows is in every item, but what's tapped isn't."];
      return [];
    }
    case "open-part":
      return b.part ? [] : ["It doesn't say what opens."];
    case "toast":
      return b.text?.trim() ? [] : ["The toast says nothing."];
  }
}

/** A var name the route doesn't use yet. */
const freeVar = (route: RouteProto, base: string) => {
  let name = base;
  for (let i = 2; route.vars?.[name]; i++) name = `${base}${i}`;
  return name;
};

const v = (name: string): Expr => ({ v: name });

/**
 * One block as route changes and walkthrough moves. `part` is the part it opens, when it opens one
 * (added by the caller); `scan` is the screen's, to find the items a per-item block is about.
 */
export function blockDelta(b: Block, route: RouteProto, layers: Map<string, LayerEntry>, scan: FrameScan, part?: string): { delta: RouteDelta; play: PlayAction[]; at: RouteRef } {
  const on = layers.get(b.on)!;
  const tap: PlayAction = { do: "tap", ref: on.ref };
  switch (b.kind) {
    case "toggle-look": {
      const spec = CATALOG_BY_NAME.get(on.component)!;
      const changes = Object.fromEntries((b.look ?? []).map((x) => [x.prop, propValue(spec.props[x.prop], x.value)]).filter(([, val]) => val !== undefined));
      const inst = { component: on.component, props: { ...on.props, ...changes } } as Inst;
      // In every item: which items are on (a set of them); alone: whether it's on.
      const col = scan.collections[0];
      if (on.each && col) {
        const items = Object.entries(route.items ?? {}).find(([, c]) => c.of.path === col.pattern && !c.of.part)?.[0] ?? "items";
        const name = freeVar(route, "toggled");
        const collection: Record<string, Collection> = route.items?.[items] ? {} : { [items]: { label: "Items", of: { path: col.pattern }, component: col.component } };
        const vars: Record<string, VarDef> = { [name]: { type: { t: "set", of: items }, init: [], label: "Toggled" } };
        const when: Expr = { op: "has", set: v(name), a: { it: "id" } };
        return {
          delta: { vars, items: collection, rules: [{ when: { on: "tap", ref: on.ref }, then: [{ do: "toggle", v: name, id: { it: "id" } }] }], swaps: [{ label: "Toggled on", ref: on.ref, when, inst } as SwapDef] },
          play: [tap, { do: "look", ref: on.ref }],
          at: on.ref,
        };
      }
      const name = freeVar(route, "on");
      return {
        delta: { vars: { [name]: { type: { t: "bool" }, init: false, label: "Toggled on" } }, rules: [{ when: { on: "tap", ref: on.ref }, then: [{ do: "toggle", v: name }] }], swaps: [{ label: "Toggled on", ref: on.ref, when: v(name), inst } as SwapDef] },
        play: [tap, { do: "look", ref: on.ref }],
        at: on.ref,
      };
    }
    case "reveal": {
      const t = layers.get(b.target!)!;
      const name = freeVar(route, "shown");
      const bindings: Binding[] = [{ kind: "visible", ref: t.ref, e: v(name) }];
      return {
        delta: { vars: { [name]: { type: { t: "bool" }, init: b.start === "shown", label: "Shown" } }, rules: [{ when: { on: "tap", ref: on.ref }, then: [{ do: "toggle", v: name }] }], bindings },
        play: [tap, { do: "look", ref: t.ref }],
        at: on.ref,
      };
    }
    case "open-part":
    case "toast":
      return {
        delta: part ? { rules: [{ when: { on: "tap", ref: on.ref }, then: [{ do: "open", part }] }] } : { skipped: "Nothing to open" },
        play: [tap, ...(part ? [{ do: "look", ref: { part } } as PlayAction] : [])],
        at: on.ref,
      };
  }
}

/** A toast's spec for a block, in the screen's language and direction. */
export function toastSpec(text: string, base: Pick<ScreenSpec, "platform" | "dir" | "lang">): ScreenSpec {
  return { ...base, name: "Toast", surface: "toast", body: [{ component: "Text", props: { text: text.trim().slice(0, 60), style: "body-strong" } }] };
}

/** A collection id the route doesn't use yet. */
const freeItems = (route: RouteProto, base: string) => {
  let id = base;
  for (let i = 2; route.items?.[id]; i++) id = `${base}${i}`;
  return id;
};

/**
 * What any part opened for an ask does on its own: its options pick (one, or any), and its close
 * button and its buttons close it — so a sheet Qalam AI wrote isn't a picture.
 */
export function partBasics(part: FrameScan, id: string, route: RouteProto): RouteDelta {
  const vars: Record<string, VarDef> = {};
  const items: Record<string, Collection> = {};
  const bindings: Binding[] = [];
  const rules: NonNullable<RouteDelta["rules"]> = [];
  let r = route;
  for (const g of part.groups) {
    const col = freeItems(r, "options");
    const name = freeVar(r, g.pick === "one" ? "pick" : "picks");
    items[col] = { label: g.title || "Options", of: { part: id, path: g.pattern }, component: "ListItem" };
    const ref: RouteRef = { part: id, path: g.pattern };
    if (g.pick === "one") {
      vars[name] = { type: { t: "choice", of: col }, init: g.picked, label: g.title || "Pick" };
      bindings.push({ kind: "prop", ref, prop: "checked", e: { op: "==", a: [v(name), { it: "id" }] } });
      rules.push({ when: { on: "tap", ref }, then: [{ do: "set", v: name, e: { it: "id" } }] });
    } else {
      vars[name] = { type: { t: "set", of: col }, init: [], label: g.title || "Picks" };
      bindings.push({ kind: "prop", ref, prop: "checked", e: { op: "has", set: v(name), a: { it: "id" } } });
      rules.push({ when: { on: "tap", ref }, then: [{ do: "toggle", v: name, id: { it: "id" } }] });
    }
    // Later groups' names count what this one took.
    r = { ...r, vars: { ...r.vars, ...vars }, items: { ...r.items, ...items } };
  }
  if (part.topBar) rules.push({ when: { on: "tap", ref: { part: id, path: part.topBar.path, sub: { role: "leading" } } }, then: [{ do: "close", part: id }] });
  for (const a of part.actions) rules.push({ when: { on: "tap", ref: { part: id, path: a.path } }, then: [{ do: "close", part: id }] });
  return { vars, items, bindings, rules };
}
