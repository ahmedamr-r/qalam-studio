/**
 * Recipes (pure): known interaction patterns, named by role, that code expands into a route's
 * behaviour — its values, item collections, bindings, swaps, scroll effects and rules — from what
 * the scan found (proto/scan.ts). The model picks recipes and writes content; it never writes the
 * logic or the math: totals are built here, typed, and checked by playing them (proto/runner.ts).
 */
import type { AddOnDef, Binding, Collection, Expr, NextPage, PlayAction, RouteAction, RouteProto, RouteRef, RouteRule, RouteStep, ScrollEffect, Slot, SwapDef, VarDef } from "@/doc/schema";
import { findMoney } from "./money";
import { newRuleId, newStepId } from "./routes";
import { addRef, tappedItems, type FrameScan, type OptionGroup } from "./scan";

/** What a recipe adds to a route (rule ids are given when it's applied). */
export interface RouteDelta {
  vars?: Record<string, VarDef>;
  appVars?: Record<string, VarDef>;
  items?: Record<string, Collection>;
  bindings?: Binding[];
  swaps?: SwapDef[];
  scroll?: ScrollEffect[];
  rules?: Omit<RouteRule, "id">[];
  /** Changes to the route's add-ons (when one shows). */
  addOns?: Record<string, Partial<AddOnDef>>;
  /** Rules that start somewhere else now (what the main action did runs on its dialog's confirm instead). */
  retarget?: { from: RouteRef; to: RouteRef }[];
  /** The step it adds: what it's called, where its marker sits, and its walkthrough. */
  step?: Omit<RouteStep, "id">;
  /** Pages it goes to that aren't designed yet. */
  next?: Record<string, NextPage>;
  /** Why the recipe couldn't apply, when it couldn't. */
  skipped?: string;
}

/** Same layer, same part. */
const sameRef = (a: RouteRef, b: RouteRef) => (a.part ?? undefined) === (b.part ?? undefined) && a.path === b.path && a.sub?.role === b.sub?.role && a.sub?.nth === b.sub?.nth;

/** A route with a recipe's additions (the app's values come back separately). */
export function applyDelta(route: RouteProto, d: RouteDelta): RouteProto {
  const out: RouteProto = {
    ...route,
    vars: { ...route.vars, ...d.vars },
    items: { ...route.items, ...d.items },
    bindings: [...(route.bindings ?? []), ...(d.bindings ?? [])],
    swaps: [...(route.swaps ?? []), ...(d.swaps ?? [])],
    scroll: [...(route.scroll ?? []), ...(d.scroll ?? [])],
    addOns: Object.fromEntries(Object.entries(route.addOns).map(([k, a]) => [k, d.addOns?.[k] ? { ...a, ...d.addOns[k] } : a])),
    rules: route.rules.map((ru) => {
      const move = "ref" in ru.when ? d.retarget?.find((m) => sameRef(m.from, (ru.when as { ref: RouteRef }).ref)) : undefined;
      return move ? { ...ru, when: { ...ru.when, ref: move.to } as RouteRule["when"] } : ru;
    }),
  };
  if (d.next) out.next = { ...route.next, ...d.next };
  for (const r of d.rules ?? []) out.rules.push({ ...r, id: newRuleId(out) } as RouteRule);
  if (d.step) {
    // Steps that leave the screen come last: a step after one would start on another page.
    const steps = [...(route.steps ?? [])];
    const step = { id: newStepId(route), ...d.step };
    const leaves = (x: { recipe: string }) => x.recipe === "nextPage";
    const at = leaves(step) ? -1 : steps.findIndex(leaves);
    steps.splice(at < 0 ? steps.length : at, 0, step);
    out.steps = steps;
  }
  for (const k of ["vars", "items"] as const) if (!Object.keys(out[k] ?? {}).length) delete out[k];
  for (const k of ["bindings", "swaps", "scroll"] as const) if (!(out[k] as unknown[] | undefined)?.length) delete out[k];
  return out;
}

const v = (name: string): Expr => ({ v: name });

/** Each recipe's name, for people. */
export const RECIPE_NAMES: Record<string, string> = {
  headerOnScroll: "Header on scroll",
  stickySections: "Sticky sections",
  configureAndAdd: "Configure and add",
  collectionBar: "Collection bar",
  chooseOne: "Choose one",
  tabPanels: "Tab panels",
  confirmFirst: "Confirm first",
  toastAfter: "Toast after",
  nextPage: "Next page",
  fromList: "Lines from a list",
  blocks: "Built to your ask",
};

/** What a row of options is called in a step's label. */
const KINDS: Record<string, string> = { ChipGroup: "chips", Tabs: "tabs", SegmentedControl: "segments", BottomNav: "tabs" };

/**
 * Header on scroll: once the content scrolls under the top bar, the bar turns solid with a
 * hairline (a large title collapses into it). Code only.
 */
export function headerOnScroll(scan: FrameScan, opts: { hero?: string } = {}): RouteDelta {
  if (!scan.topBar) return { skipped: "No top bar to compact" };
  const from = opts.hero ?? "body.0";
  return {
    vars: { scrolled: { type: { t: "bool" }, init: false, label: "Scrolled under the top bar" } },
    scroll: [{ kind: "past", ref: { path: from }, v: "scrolled" }],
    bindings: [{ kind: "prop", ref: { path: scan.topBar.path }, prop: "scrolled", e: v("scrolled") }],
    step: {
      recipe: "headerOnScroll",
      label: "The top bar turns solid as content scrolls under it",
      at: { path: scan.topBar.path },
      play: [{ do: "scroll", y: 320 }, { do: "look", ref: { path: scan.topBar.path } }, { do: "scroll", y: 0 }],
    },
  };
}

/**
 * Sticky sections: a row of options that names the sections below it sticks under the top bar,
 * follows the section in view, and scrolls to the one you pick. Code only.
 */
export function stickySections(scan: FrameScan): RouteDelta {
  const row = scan.optionRows.find((r) => r.sections.filter(Boolean).length >= 2);
  if (!row) return { skipped: "No row of options names the sections below it" };
  const matched = row.sections.map((s, i) => ({ s, i })).filter((x): x is { s: string; i: number } => !!x.s);
  // Sections of one kind are listed by it (not what sits between them); a mix (a carousel, then stacks) by place.
  const kinds = new Set(matched.map((m) => scan.sections.find((x) => x.path === m.s)?.component));
  const comp = kinds.size === 1 ? [...kinds][0] : undefined;
  // The selected option follows the section in view (sections without an option keep the last one).
  let selected: Expr = matched[0].i;
  for (const m of [...matched].reverse()) selected = { op: "if", a: [{ op: "==", a: [v("section"), m.s] }, m.i, selected] };
  return {
    items: { sections: { label: "Sections", of: { path: "body.*" }, ...(comp ? { component: comp } : {}) } },
    vars: { section: { type: { t: "choice", of: "sections" }, init: matched[0].s, label: "Section in view" } },
    scroll: [{ kind: "stick", ref: { path: row.path } }, { kind: "spy", items: "sections", v: "section" }],
    bindings: [{ kind: "prop", ref: { path: row.path }, prop: row.component === "BottomNav" ? "active" : "selected", e: selected }],
    rules: matched.map((m) => ({
      when: { on: "tap", ref: { path: row.path, sub: { role: "option", nth: m.i } } },
      then: [
        { do: "set", v: "section", e: m.s },
        { do: "scrollTo", items: "sections", id: m.s },
      ],
    })),
    step: {
      recipe: "stickySections",
      label: `The ${KINDS[row.component] ?? "options"} stick, follow the section in view, and jump to theirs`,
      at: { path: row.path },
      // To the last section and back to the first.
      play: [
        { do: "tap", ref: { path: row.path, sub: { role: "option", nth: matched[matched.length - 1].i } } },
        { do: "look", ref: { path: row.path } },
        { do: "tap", ref: { path: row.path, sub: { role: "option", nth: matched[0].i } } },
      ],
    },
  };
}

/** The money an item's options add: the picked one-of's, plus every picked any-of. */
function optionsTotal(groups: { id: string; g: OptionGroup; picked: string }[]): Expr[] {
  return groups.map(({ id, g, picked }) =>
    g.pick === "one"
      ? ({ op: "get", of: id, id: v(picked), field: "delta" } as Expr)
      : ({ op: "sum", of: { items: id }, where: { op: "has", set: v(picked), a: { el: "id" } }, value: { el: "delta" } } as Expr),
  );
}

/**
 * Configure and add: an item's add action opens a part (a sheet) about that item, where its
 * options are picked — one of a required group, any of the others — and its quantity set; the
 * action's label shows the live total, it waits for what's required, and adding puts a line in a
 * list the app keeps (a basket) and closes the part.
 */
export function configureAndAdd(screen: FrameScan, sheet: FrameScan, opts: { part: string; list?: string }): RouteDelta {
  const col = screen.collections[0];
  if (!col) return { skipped: "No repeated items with an add action" };
  if (!sheet.primary) return { skipped: "The part has no main action to add with" };
  const list = opts.list ?? "basket";
  const part = opts.part;
  // Groups named by kind, numbered within it: choices, choices2…; extras, extras2…
  const seen = { one: 0, any: 0 };
  const groups = sheet.groups.map((g) => {
    const n = ++seen[g.pick];
    const suffix = n === 1 ? "" : String(n);
    return g.pick === "one" ? { id: `choices${suffix}`, g, picked: `choice${suffix}` } : { id: `extras${suffix}`, g, picked: `picked${suffix}` };
  });
  const vars: Record<string, VarDef> = {};
  const items: Record<string, Collection> = { items: { label: "Items", of: { path: col.pattern }, component: col.component } };
  const bindings: Binding[] = [];
  const rules: Omit<RouteRule, "id">[] = [];
  for (const { id, g, picked } of groups) {
    items[id] = { label: g.title || (g.pick === "one" ? "Choices" : "Extras"), of: { part, path: g.pattern }, component: "ListItem" };
    if (g.pick === "one") {
      vars[picked] = { type: { t: "choice", of: id }, init: g.picked, label: g.title || "Choice", resetOn: part };
      bindings.push({ kind: "prop", ref: { part, path: g.pattern }, prop: "checked", e: { op: "==", a: [v(picked), { it: "id" }] } });
      rules.push({ when: { on: "tap", ref: { part, path: g.pattern } }, then: [{ do: "set", v: picked, e: { it: "id" } }] });
    } else {
      vars[picked] = { type: { t: "set", of: id }, init: [], label: g.title || "Extras", resetOn: part };
      bindings.push({ kind: "prop", ref: { part, path: g.pattern }, prop: "checked", e: { op: "has", set: v(picked), a: { it: "id" } } });
      rules.push({ when: { on: "tap", ref: { part, path: g.pattern } }, then: [{ do: "toggle", v: picked, id: { it: "id" } }] });
    }
  }
  if (sheet.quantity) {
    vars.qty = { type: { t: "int", min: 1, max: 20 }, init: 1, label: "Quantity", resetOn: part };
    bindings.push({ kind: "text", ref: { part, path: sheet.quantity.path }, slots: { qty: { e: v("qty"), fmt: "int" } } });
    rules.push({ when: { on: "tap", ref: { part, path: sheet.quantity.path, sub: { role: "increase" } } }, then: [{ do: "inc", v: "qty", by: 1 }] });
    rules.push({ when: { on: "tap", ref: { part, path: sheet.quantity.path, sub: { role: "decrease" } } }, then: [{ do: "inc", v: "qty", by: -1 }] });
  }
  // What was picked, for the line: "Large · Garlic sauce, Cheese".
  const note: Expr = groups.length ? { op: "join", a: groups.map((x) => ({ op: "titles", of: x.id, ids: v(x.picked) }) as Expr), sep: " · " } : "";
  // One of the item, as configured; and as many as the quantity says.
  const unit: Expr = { op: "+", a: [{ ctx: "money" }, ...optionsTotal(groups)] };
  const total: Expr = sheet.quantity ? { op: "*", a: [unit, v("qty")] } : unit;
  if (sheet.primary.money) bindings.push({ kind: "text", ref: { part, path: sheet.primary.path }, slots: { total: { e: total, fmt: "money" } } });
  const required = groups.filter((x) => x.g.pick === "one" && x.g.required);
  const ready: Expr | undefined = required.length ? (required.length === 1 ? { op: "!=", a: [v(required[0].picked), null] } : { op: "and", a: required.map((x) => ({ op: "!=", a: [v(x.picked), null] }) as Expr) }) : undefined;
  if (ready && required.some((x) => !x.g.picked)) bindings.push({ kind: "prop", ref: { part, path: sheet.primary.path }, prop: "disabled", e: { op: "not", a: [ready] } });
  // What the part is about: its title, its description.
  if (sheet.topBar) bindings.push({ kind: "text", ref: { part, path: sheet.topBar.path }, slots: { title: { e: { ctx: "title" }, fmt: "text" } } });
  if (sheet.intro) bindings.push({ kind: "text", ref: { part, path: sheet.intro.path }, slots: { caption: { e: { ctx: "caption" }, fmt: "text" } } });
  rules.push({ when: { on: "tap", ref: addRef(col) }, then: [{ do: "open", part, item: { it: "id" } }] });
  if (sheet.topBar) rules.push({ when: { on: "tap", ref: { part, path: sheet.topBar.path, sub: { role: "leading" } } }, then: [{ do: "close", part }] });
  rules.push({
    when: { on: "tap", ref: { part, path: sheet.primary.path } },
    ...(ready ? { if: ready } : {}),
    then: [
      { do: "push", v: `app.${list}`, record: { item: { ctx: "id" }, title: { ctx: "title" }, note, qty: sheet.quantity ? v("qty") : 1, unit } },
      { do: "close", part },
    ],
  });
  // The walkthrough: the first item's +, a pick in each group (another than the one made), one more, Add.
  const first: RouteRef = addRef(col, col.items[0]);
  const play: PlayAction[] = [{ do: "tap", ref: first }];
  for (const { g } of groups) play.push({ do: "tap", ref: { part, path: g.pick === "one" ? (g.rows.find((r) => r !== g.picked) ?? g.rows[0]) : g.rows[0] } });
  if (sheet.quantity) play.push({ do: "tap", ref: { part, path: sheet.quantity.path, sub: { role: "increase" } } });
  play.push({ do: "tap", ref: { part, path: sheet.primary.path } });
  return {
    vars,
    appVars: { [list]: { type: { t: "list", fields: { item: "text", title: "text", note: "text", qty: "int", unit: "money" } }, init: [], label: list === "basket" ? "Basket" : list[0].toUpperCase() + list.slice(1) } },
    items,
    bindings,
    rules,
    step: { recipe: "configureAndAdd", label: `An item's + opens its options; picks and quantity move the price, and Add puts it in the ${list}`, at: first, play },
  };
}

/**
 * Collection bar: a bar shows once the list has something in it, its label counting the lines
 * and their total; each item's add action shows how many of it are in the list.
 */
export function collectionBar(screen: FrameScan, bar: FrameScan, opts: { part: string; list?: string }): RouteDelta {
  const col = screen.collections[0];
  const list = `app.${opts.list ?? "basket"}`;
  const count: Expr = { op: "sum", of: { v: list }, value: { el: "qty" } };
  const total: Expr = { op: "sum", of: { v: list }, value: { op: "*", a: [{ el: "qty" }, { el: "unit" }] } };
  const bindings: Binding[] = [];
  if (bar.primary) bindings.push({ kind: "text", ref: { part: opts.part, path: bar.primary.path }, slots: bar.primary.money ? { total: { e: total, fmt: "money" } } : { count: { e: count, fmt: "int" } } });
  // Each item shows how many are in on its + (an item tapped itself has none to show it on).
  const swaps: SwapDef[] = col && !tappedItems(col)
    ? [
        {
          label: "In the basket",
          ref: addRef(col),
          when: { op: ">", a: [{ op: "sum", of: { v: list }, where: { op: "==", a: [{ el: "item" }, { it: "id" }] }, value: { el: "qty" } }, 0] },
          inst: { component: "Tag", props: { label: "{n}", tone: "brand" } },
          slots: { n: { e: { op: "sum", of: { v: list }, where: { op: "==", a: [{ el: "item" }, { it: "id" }] }, value: { el: "qty" } }, fmt: "int" } },
        },
      ]
    : [];
  const name = opts.list ?? "basket";
  return {
    addOns: { [opts.part]: { when: { op: ">", a: [{ op: "count", of: { v: list } }, 0] } } },
    bindings,
    swaps,
    step: {
      recipe: "collectionBar",
      label: `Once something's in the ${name}, a bar shows its total, and each item how many are in`,
      at: { part: opts.part },
      play: [{ do: "look", ref: { part: opts.part } }, ...(col ? [{ do: "look", ref: addRef(col, col.items[0]) } as PlayAction] : [])],
    },
  };
}

/** `vals[i]` while `name` is i (the last one otherwise): a value per option of a row. */
function perOption(name: string, vals: Expr[]): Expr {
  let e = vals[vals.length - 1];
  for (let i = vals.length - 2; i >= 0; i--) e = { op: "if", a: [{ op: "==", a: [v(name), i] }, vals[i], e] };
  return e;
}


/** Does the route's last step end by tapping `at`? */
function tappedLast(route: RouteProto, at: RouteRef): boolean {
  const last = route.steps?.[route.steps.length - 1]?.play.at(-1);
  return last?.do === "tap" && sameRef(last.ref, at);
}

/** When the action at `at` can run: the condition its rules already wait for, else while it isn't drawn disabled. */
function gateAt(route: RouteProto, at: RouteRef): Expr | undefined {
  const rule = route.rules.find((ru) => "ref" in ru.when && sameRef(ru.when.ref, at) && ru.if !== undefined);
  if (rule) return rule.if;
  const off = (route.bindings ?? []).find((b) => b.kind === "prop" && b.prop === "disabled" && sameRef(b.ref, at));
  return off && off.kind === "prop" ? { op: "not", a: [off.e] } : undefined;
}

/**
 * Choose one: a pick-one set of options on the screen itself — radio rows (a ride type, a plan,
 * an account), or a row of chips or segments that doesn't name sections (an amount, Now or
 * Later). Picking one marks it, and the main action's label follows it where it shows the pick:
 * its name ("Book Comfort") and its amount ("· AED 24.00"). With nothing picked as designed, the
 * action waits for a pick. Code only.
 */
export function chooseOne(screen: FrameScan, opts: { at?: string; name?: string } = {}): RouteDelta {
  const name = opts.name ?? "choice";
  const group = screen.groups.find((g) => g.pick === "one" && (!opts.at || g.pattern === opts.at));
  const row = group ? undefined : screen.optionRows.find((r) => r.sections.every((x) => !x) && (!opts.at || r.path === opts.at));
  if (!group && !row) return { skipped: "No pick-one options on the screen" };
  const p = screen.primary;
  const shown = p ? findMoney(p.label) : null;
  const slots: Record<string, Slot> = {};
  const bindings: Binding[] = [];
  const rules: Omit<RouteRule, "id">[] = [];
  const play: PlayAction[] = [];
  let at: RouteRef;
  let vars: Record<string, VarDef>;
  let items: Record<string, Collection> | undefined;
  if (group) {
    const col = `${name}s`;
    items = { [col]: { label: group.title || "Options", of: { path: group.pattern }, component: "ListItem" } };
    vars = { [name]: { type: { t: "choice", of: col }, init: group.picked, label: group.title || "Choice" } };
    bindings.push({ kind: "prop", ref: { path: group.pattern }, prop: "checked", e: { op: "==", a: [v(name), { it: "id" }] } });
    rules.push({ when: { on: "tap", ref: { path: group.pattern } }, then: [{ do: "set", v: name, e: { it: "id" } }] });
    const i = group.picked ? group.rows.indexOf(group.picked) : -1;
    if (i >= 0 && p) {
      const field = (f: string): Expr => ({ op: "get", of: col, id: v(name), field: f });
      if (group.titles[i] && p.label.includes(group.titles[i])) slots.name = { e: field("title"), fmt: "text", at: group.titles[i] };
      const price = group.prices[i];
      // An amount on its own is the pick's; one written with + is what it adds to the rest.
      if (shown && price) slots.amount = { e: price.diff ? { op: "+", a: [{ money: shown.amount - price.amount }, field("delta")] } : field("money"), fmt: "money" };
    }
    if (i < 0 && p) bindings.push({ kind: "prop", ref: { path: p.path }, prop: "disabled", e: { op: "==", a: [v(name), null] } });
    // The option after the one picked as designed (the first, when none is).
    play.push({ do: "tap", ref: { path: group.rows[(i + 1) % group.rows.length] } });
    at = { path: group.rows[0] };
  } else {
    const r = row!;
    const sel = r.selected >= 0 ? r.selected : 0;
    vars = { [name]: { type: { t: "int", min: 0, max: r.labels.length - 1 }, init: sel, label: "Choice" } };
    bindings.push({ kind: "prop", ref: { path: r.path }, prop: "selected", e: v(name) });
    r.labels.forEach((_, i) => rules.push({ when: { on: "tap", ref: { path: r.path, sub: { role: "option", nth: i } } }, then: [{ do: "set", v: name, e: i }] }));
    play.push({ do: "tap", ref: { path: r.path, sub: { role: "option", nth: (sel + 1) % r.labels.length } } });
    at = { path: r.path };
    if (p) {
      const amounts = r.labels.map((l) => findMoney(l));
      // Options that are amounts (AED 50, AED 100): the label shows the picked one.
      if (shown && amounts.every((m) => m)) slots.amount = { e: perOption(name, amounts.map((m) => ({ money: m!.amount }))), fmt: "money" };
      else if (r.labels[sel] && p.label.includes(r.labels[sel])) slots.name = { e: perOption(name, r.labels), fmt: "text", at: r.labels[sel] };
    }
  }
  const echoes = !!p && Object.keys(slots).length > 0;
  if (echoes) bindings.push({ kind: "text", ref: { path: p!.path }, slots });
  if (echoes) play.push({ do: "look", ref: { path: p!.path } });
  return {
    vars,
    ...(items ? { items } : {}),
    bindings,
    rules,
    step: { recipe: "chooseOne", label: echoes ? `Picking an option makes "${p!.label}" say which` : "One option can be picked at a time", at: at!, play },
  };
}

/**
 * Tab panels: a row of tabs or segments that names the sections below it shows the picked one's
 * section and hides the others' ("All", when it's one of them, shows every section). Sections no
 * tab names stay. Code only.
 */
export function tabPanels(screen: FrameScan, opts: { at?: string } = {}): RouteDelta {
  const row = screen.optionRows.find((r) => r.sections.filter(Boolean).length >= 2 && (!opts.at || r.path === opts.at));
  if (!row) return { skipped: "No tabs name the sections below them" };
  const all = row.labels.findIndex((l) => /^(all|everything|الكل)$/i.test(l.trim()));
  const sel = row.selected >= 0 ? row.selected : 0;
  const tab = (i: number): Expr => ({ op: "==", a: [v("tab"), i] });
  return {
    vars: { tab: { type: { t: "int", min: 0, max: row.labels.length - 1 }, init: sel, label: "Tab" } },
    bindings: [
      { kind: "prop", ref: { path: row.path }, prop: "selected", e: v("tab") },
      ...row.sections.flatMap((path, i): Binding[] => (path ? [{ kind: "visible", ref: { path }, e: all >= 0 ? { op: "or", a: [tab(i), tab(all)] } : tab(i) }] : [])),
    ],
    rules: row.labels.map((_, i) => ({ when: { on: "tap", ref: { path: row.path, sub: { role: "option", nth: i } } }, then: [{ do: "set", v: "tab", e: i } as RouteAction] })),
    step: {
      recipe: "tabPanels",
      label: `The ${KINDS[row.component] ?? "options"} switch the section that shows`,
      at: { path: row.path },
      // To the last tab that names a section, and back.
      play: (() => {
        const last = row.sections.map((x, i) => (x ? i : -1)).filter((i) => i >= 0 && i !== sel).pop() ?? sel;
        const shown = row.sections[last];
        return [
          { do: "tap", ref: { path: row.path, sub: { role: "option", nth: last } } },
          ...(shown ? [{ do: "look", ref: { path: shown } } as PlayAction] : []),
          { do: "tap", ref: { path: row.path, sub: { role: "option", nth: sel } } },
        ];
      })(),
    },
  };
}

/**
 * Confirm first: the main action asks before it acts, in a dialog (or a sheet) about it — its
 * confirm button closes it (what follows, a toast or the next screen, is added after), the button
 * beside it just closes it. Where the dialog repeats what the action says (the amount, the pick),
 * it shows the same live value. The dialog's copy is the model's or the designer's; the wiring is
 * code's.
 */
export function confirmFirst(route: RouteProto, screen: FrameScan, dialog: FrameScan, opts: { part: string; action?: string }): RouteDelta {
  // The main action, or the one asked for (a destructive one beside it).
  const act = opts.action ? screen.actions.find((a) => a.path === opts.action) : screen.primary;
  if (!act) return { skipped: opts.action ? `No action at ${opts.action}` : "No main action to confirm" };
  if (!dialog.primary) return { skipped: "The dialog has no button to confirm with" };
  const part = opts.part;
  const main: RouteRef = { path: act.path };
  const confirm: RouteRef = { part, path: dialog.primary.path };
  const gate = gateAt(route, main);
  // What the action did, it does once confirmed.
  const did = route.rules.some((ru) => "ref" in ru.when && sameRef(ru.when.ref, main));
  const rules: Omit<RouteRule, "id">[] = [
    { when: { on: "tap", ref: main }, ...(gate ? { if: gate } : {}), then: [{ do: "open", part }] },
    { when: { on: "tap", ref: confirm }, then: [{ do: "close", part }] },
  ];
  if (dialog.secondary) rules.push({ when: { on: "tap", ref: { part, path: dialog.secondary.path } }, then: [{ do: "close", part }] });
  // The live values the action's label shows, wherever the dialog repeats them.
  const said = (route.bindings ?? []).find((b) => b.kind === "text" && sameRef(b.ref, main));
  const bindings: Binding[] = [];
  if (said?.kind === "text") {
    const label = act.label;
    for (const a of dialog.texts) {
      const slots: Record<string, Slot> = {};
      for (const [k, slot] of Object.entries(said.slots)) {
        if (slot.fmt === "money" && findMoney(a.text)?.amount === findMoney(label)?.amount) slots[k] = { e: slot.e, fmt: "money" };
        else if (slot.at !== undefined && a.text.includes(slot.at)) slots[k] = slot;
      }
      if (Object.keys(slots).length) bindings.push({ kind: "text", ref: { part, path: a.path }, slots });
    }
  }
  return {
    rules,
    bindings,
    ...(did ? { retarget: [{ from: main, to: confirm }] } : {}),
    step: {
      recipe: "confirmFirst",
      label: `"${act.label}" asks first, in a dialog`,
      at: main,
      play: [{ do: "tap", ref: main }, { do: "look", ref: { part } }, { do: "tap", ref: confirm }],
    },
  };
}

/**
 * Toast after: once an action has done its thing (a transfer confirmed, a ride booked, changes
 * saved), a toast says so and goes on its own. It shows when the action runs — after what the
 * action's rules do, and only when they would run. The toast's copy is the model's or the
 * designer's.
 */
export function toastAfter(route: RouteProto, at: RouteRef, opts: { part: string }): RouteDelta {
  const gate = gateAt(route, at);
  return {
    rules: [{ when: { on: "tap", ref: at }, ...(gate ? { if: gate } : {}), then: [{ do: "open", part: opts.part }] }],
    step: {
      recipe: "toastAfter",
      label: "A toast says it's done",
      at: { part: opts.part },
      // Right after the step that taps it (a confirm), it only has to be seen; else it's tapped here.
      play: [...(tappedLast(route, at) ? [] : [{ do: "tap", ref: at } as PlayAction]), { do: "look", ref: { part: opts.part } }],
    },
  };
}

/**
 * The next page: the screen's way on (the basket bar's View basket, the main action) goes to a
 * page that isn't designed yet — a placeholder in the prototype, a dashed card on the canvas —
 * until Generate draws it from what leads there. Code only: the page's name is the model's, or
 * the action's own words.
 */
export function nextPage(at: RouteRef, page: { id: string; name: string; brief: string }, opts: { action?: string } = {}): RouteDelta {
  return {
    next: { [page.id]: { name: page.name, brief: page.brief } },
    rules: [{ when: { on: "tap", ref: at }, then: [{ do: "next", page: page.id, transition: { kind: "push", motion: "native" } }] }],
    step: { recipe: "nextPage", label: `${opts.action ? `"${opts.action}"` : "The main action"} goes on to ${page.name}, not designed yet`, at, play: [{ do: "tap", ref: at }] },
  };
}

/**
 * Lines from a list: a screen's lines (a basket's) are the list's — the design's first row drawn
 * once for each line, its title, note, amount and how many read off the line, its stepper changing
 * that line (below one, it leaves the list) — and the amounts after them follow by role: the first
 * is what the lines come to, the last the total, with what's between (a fee, a discount) as written.
 * The list starts as the design shows it when the prototype starts here (compile.ts). Code only.
 */
export function fromList(screen: FrameScan, opts: { list: string; label?: string }): RouteDelta {
  const lines = screen.lines;
  if (!lines) return { skipped: "No rows that read as lines (a title and an amount)" };
  const list = opts.list;
  const row = lines.rows[0];
  const el = (f: string): Expr => ({ el: f });
  const amount: Expr = { op: "*", a: [el("qty"), el("unit")] };
  const lineSlots: Record<string, Slot> = { title: { e: el("title"), fmt: "text", at: lines.title }, amount: { e: amount, fmt: "money" } };
  if (lines.note) lineSlots.note = { e: el("note"), fmt: "text", at: lines.note };
  const bindings: Binding[] = [{ kind: "repeat", ref: { path: row }, of: list, ...(lines.rows.length > 1 ? { others: lines.rows.slice(1) } : {}) }, { kind: "text", ref: { path: row }, slots: lineSlots }];
  const rules: Omit<RouteRule, "id">[] = [];
  if (lines.qty) {
    bindings.push({ kind: "text", ref: { path: lines.qty }, slots: { qty: { e: el("qty"), fmt: "int" } } });
    rules.push({ when: { on: "tap", ref: { path: lines.qty, sub: { role: "increase" } } }, then: [{ do: "change", v: list, field: "qty", by: 1 }] });
    rules.push({ when: { on: "tap", ref: { path: lines.qty, sub: { role: "decrease" } } }, then: [{ do: "change", v: list, field: "qty", by: -1, min: 1 }] });
  }
  // The amounts after the lines, by role: the summary's rows when it has them (prices of things
  // suggested between the lines and the summary aren't fees), else the copy after the lines that
  // isn't an item's.
  const last = lines.rows[lines.rows.length - 1];
  const items = screen.collections.flatMap((c) => c.items);
  const within = (p: string, roots: string[]) => roots.some((r) => p === r || p.startsWith(`${r}.`));
  const later = screen.amounts.filter((a) => !within(a.path, lines.rows) && !within(a.path, items) && a.path.localeCompare(last, undefined, { numeric: true }) > 0);
  const summary = later.filter((a) => a.component === "SummaryRow");
  const after = summary.length ? summary : later;
  const sum: Expr = { op: "sum", of: { v: list }, value: { op: "*", a: [{ el: "qty" }, { el: "unit" }] } };
  const between = after.slice(1, -1).map((a) => findMoney(a.text)).filter((m): m is NonNullable<typeof m> => !!m);
  const total: Expr = between.length ? { op: "+", a: [sum, ...between.map((m) => ({ money: m.amount }) as Expr)] } : sum;
  if (after.length >= 2) {
    bindings.push({ kind: "text", ref: { path: after[0].path }, slots: { subtotal: { e: sum, fmt: "money" } } });
    bindings.push({ kind: "text", ref: { path: after[after.length - 1].path }, slots: { total: { e: total, fmt: "money" } } });
  } else if (after.length === 1) bindings.push({ kind: "text", ref: { path: after[0].path }, slots: { total: { e: sum, fmt: "money" } } });
  if (screen.primary?.money && !after.some((a) => a.path === screen.primary!.path)) bindings.push({ kind: "text", ref: { path: screen.primary.path }, slots: { total: { e: total, fmt: "money" } } });
  const name = opts.label ?? list.replace(/^app\./, "");
  return {
    bindings,
    rules,
    step: {
      recipe: "fromList",
      label: `The lines are the ${name}'s, as it was filled${lines.qty ? "; each line's stepper changes how many" : ""}`,
      at: { path: row },
      play: [{ do: "look", ref: { path: row } }, ...(lines.qty ? [{ do: "tap", ref: { path: lines.qty, sub: { role: "increase" } } } as PlayAction] : [])],
    },
  };
}
