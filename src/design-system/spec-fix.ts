import type { SceneNode } from "@/doc/schema";
import { measureText } from "@/doc/measure";
import { layoutToNodes } from "@/engine/layout";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import type { ComponentDef } from "./docs";
import { componentKey, fillComposition } from "./custom";
import { BUILTIN, type TokenSet } from "./resolve";
import { hasAmount, isPrimaryButton, repeatedPrimaries, strings, type RepeatedPrimary } from "./spec-lint";

/**
 * Repairs code makes itself, before anything goes back to the model: where a check knows exactly
 * what the fix is, it's made the same way every time instead of being asked for. Each change
 * names the spec path it touched, like the model's own repairs.
 */

export interface SpecChange {
  path: string;
  summary: string;
}

/** Where an instance sits: the list holding it, its index there and its parent (null at the top). */
interface Spot {
  list: Inst[];
  index: number;
  parent: Inst | null;
}

/** Follow index steps ("2", "children", "0", …) from a top list. */
function locate(top: Inst[] | undefined, steps: string[]): Spot | null {
  const rest = [...steps];
  let list = top;
  let parent: Inst | null = null;
  let index = Number(rest.shift());
  while (rest.length) {
    if (rest.shift() !== "children") return null;
    parent = list?.[index] ?? null;
    list = parent?.children;
    index = Number(rest.shift());
  }
  return list?.[index] ? { list, index, parent } : null;
}

/** A spec path ("body.1.children.0") as a spot in the spec. */
const atPath = (spec: ScreenSpec, path: string) => {
  const [region, ...steps] = path.split(".");
  return locate(spec[region as "header" | "sidebar" | "hero" | "body" | "footer"], steps);
};
/** A part of a composition ("" for its root, "children.2") as a spot in it. */
const atPart = (root: Inst, part: string) => locate([root], ["0", ...(part ? part.split(".") : [])]);

const isRow = (i: Inst | null | undefined) => i?.component === "Stack" && i.props?.direction === "horizontal";
const priced = (i: Inst): boolean => strings(i).some(hasAmount) || (i.children ?? []).some(priced);
const holdsButton = (i: Inst): boolean => i.component === "Button" || i.component === "IconButton" || (i.children ?? []).some(holdsButton);
/** A price on its own: a Text that states it, or a small column of text around it (a price and "Today's price"). */
const priceBlock = (i: Inst) =>
  (i.component === "Text" && priced(i)) || (i.component === "Stack" && !isRow(i) && (i.children?.length ?? 0) <= 3 && (i.children ?? []).every((c) => !c.children?.length) && priced(i));
/** An item's last row that states its price and has room for one more part. */
const priceRow = (i: Inst) => isRow(i) && priced(i) && !holdsButton(i) && (i.children?.length ?? 0) < 3;

/** The Button made quiet: small, and text-only unless it has a line of its own. */
function quiet(b: Inst, variant: "tertiary" | "secondary"): Inst {
  const { fullWidth, ...props } = b.props ?? {};
  return { ...b, props: { ...props, variant, size: "sm", ...(variant === "secondary" && fullWidth ? { fullWidth } : {}) } };
}

/** Where a quieted action goes: beside the item's price when there's one to sit by, or on a line of its own. */
type Place = "beside" | "own-line";

/**
 * Make the primary Button at a spot quiet, and say how. `seen` is the same spot with its strings
 * as shown (a component's composition filled with an instance's values), where a "{price}"
 * placeholder reads as the price it is.
 */
function demote(at: Spot, seen: Spot, place: Place): string | null {
  const { list, index, parent } = at;
  const b = list[index];
  if (!isPrimaryButton(b)) return null;
  const prev = place === "beside" && index > 0 && index === list.length - 1 ? list[index - 1] : undefined;
  const prevSeen = seen.list[index - 1];
  if (isRow(parent)) {
    list[index] = quiet(b, "tertiary");
    return "is tertiary and small";
  }
  if (prev && priceRow(prevSeen)) {
    list.splice(index, 1);
    prev.children = [...(prev.children ?? []), quiet(b, "tertiary")];
    prev.props = { ...prev.props, align: prev.props?.align ?? "center", justify: !prev.props?.justify || prev.props.justify === "start" ? "between" : prev.props.justify };
    return "is tertiary and small, beside the price on the item's last row";
  }
  if (prev && priceBlock(prevSeen)) {
    list.splice(index - 1, 2, { component: "Stack", props: { direction: "horizontal", align: "center", justify: "between" }, children: [prev, quiet(b, "tertiary")] });
    return "is tertiary and small, in a row with the price";
  }
  list[index] = quiet(b, "secondary");
  return "is secondary and small";
}

/** Spec paths in reverse document order, so changing one never moves the next one to handle. */
const reverseOrder = (a: string, b: string) => {
  const x = a.split("."),
    y = b.split(".");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const m = Number(x[i]),
      n = Number(y[i]);
    return Number.isFinite(m) && Number.isFinite(n) ? n - m : y[i] < x[i] ? -1 : 1;
  }
  return y.length - x.length;
};

/** An instance's values for its component, the examples filling what it leaves out (as the builder does). */
function valuesOf(def: ComponentDef, inst: Inst | undefined): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries((def.props ?? []).map((p) => [p.name, p.example]));
  for (const v of (inst?.props?.values as { prop?: unknown; value?: unknown }[] | undefined) ?? []) if (typeof v?.prop === "string") out[v.prop] = String(v.value ?? "");
  return out;
}

const WHY = "it's on every item, and the screen has one primary action.";

/** Quiet one collection's Buttons in `spec` (mutated), placed as asked; the changes made. */
function quietCollection(spec: ScreenSpec, r: RepeatedPrimary, place: Place): SpecChange[] {
  if (r.component) {
    const def = spec.components?.find((d) => componentKey(d.name) === componentKey(r.component!.name));
    if (!def) return [];
    const first = atPath(spec, r.items[0].item);
    const at = atPart(def.composition, r.component.part);
    const seen = atPart(fillComposition(def, valuesOf(def, first?.list[first.index])), r.component.part);
    if (!at || !seen) return [];
    const label = String(seen.list[seen.index]?.props?.label ?? "");
    const how = demote(at, seen, place);
    if (!how) return [];
    // At the root the component is the Button itself, now a quieter one.
    if (!r.component.part) def.composition = at.list[0];
    return [{ path: r.items[0].item, summary: `"${label}" in ${def.name} ${how}: ${WHY}` }];
  }
  const changes: SpecChange[] = [];
  for (const path of r.items.map((i) => i.button).sort(reverseOrder)) {
    const at = atPath(spec, path);
    if (!at) continue;
    const label = String(at.list[at.index]?.props?.label ?? "");
    const how = demote(at, at, place);
    if (how) changes.push({ path, summary: `"${label}" ${how}: ${WHY}` });
  }
  return changes;
}

/**
 * How much of its one-line width each text inside the items gets, by its content, as the screen
 * lays out (1 when it has all it needs). Measured against the text measurer, so it reads the
 * same wherever the layout runs.
 */
function roomIn(spec: ScreenSpec, items: string[], opts: FixOptions): Map<string, number> {
  const ts = opts.ts ?? BUILTIN;
  const nodes = layoutToNodes(buildScreen(spec, ts, opts.library), { dir: spec.dir ?? "ltr", lang: spec.lang ?? "en", ts }, { x: 0, y: 0 });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  const visit = (n: SceneNode | undefined) => {
    if (!n) return;
    if (n.type === "text") {
      const room = Math.min(1, n.w / Math.max(1, measureText(n.text, null).w));
      out.set(n.text.content, Math.min(out.get(n.text.content) ?? 1, room));
    }
    for (const id of n.children ?? []) visit(byId.get(id));
  };
  for (const n of nodes) if (n.meta?.specPath !== undefined && items.includes(n.meta.specPath)) visit(n);
  return out;
}

/** Moving the action beside the price left every text in the items as much room as before: a price squeezed into wrapping is worse than an action on a line of its own. */
function keepsRoom(before: ScreenSpec, after: ScreenSpec, items: string[], opts: FixOptions): boolean {
  try {
    const was = roomIn(before, items, opts);
    const now = roomIn(after, items, opts);
    return [...now].every(([content, r]) => r >= (was.get(content) ?? 1) - 0.02);
  } catch {
    // Not measurable here (no layout engine yet): the safe place is a line of its own.
    return false;
  }
}

export interface FixOptions {
  /** The design system's own components (left as the designer made them). */
  library?: ComponentDef[];
  /** Its tokens, for measuring how a change lays out (the built-in system's by default). */
  ts?: TokenSet;
}

/**
 * A primary Button on every item of a collection (see repeatedPrimaries) turns tertiary and
 * small beside the item's price: into the price's row when the item ends with one, or into a new
 * row with the price when the price stands just above it. In a row already, it stays there. With
 * no price to sit beside, or when sitting beside it would squeeze a text (measured on the laid
 * out screen), it's secondary and small on its own line. When the items are instances of a
 * component made for the screen, its composition changes, once, for all of them. Needs the
 * layout engine loaded (ensureYoga).
 */
export function demoteRepeatedPrimaries(spec: ScreenSpec, opts: FixOptions = {}): { spec: ScreenSpec; changes: SpecChange[] } {
  const found = repeatedPrimaries(spec, opts.library);
  if (!found.length) return { spec, changes: [] };
  let next = structuredClone(spec);
  const changes: SpecChange[] = [];
  // Last first, so a change never moves the Buttons still to handle.
  const order = [...found].sort((a, b) => reverseOrder(a.items[0].button, b.items[0].button));
  for (const r of order) {
    const beside = structuredClone(next);
    const made = quietCollection(beside, r, "beside");
    if (!made.length) continue;
    if (keepsRoom(next, beside, r.items.map((i) => i.item), opts)) {
      next = beside;
      changes.push(...made);
    } else {
      changes.push(...quietCollection(next, r, "own-line"));
    }
  }
  return { spec: next, changes };
}

/** Every repair code can make on its own; the spec comes back as it was when none applies. */
export function fixSpec(spec: ScreenSpec, opts: FixOptions = {}): { spec: ScreenSpec; changes: SpecChange[] } {
  return demoteRepeatedPrimaries(spec, opts);
}
