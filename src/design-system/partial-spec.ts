import { isPartial, partialKey } from "@/ai/partial-json";
import { CATALOG_BY_NAME, isReservedName } from "./components";
import { attachDefs, cleanDefs } from "./custom";
import type { Inst, Overlap, ScreenSpec } from "./builders";
import type { Platform } from "./platform";

/**
 * Screens from a generate response that is still being written (see parsePartial), trimmed to
 * what can be built without anything changing later: a component appears once its props are
 * complete, and a container's children then fill in one by one. So every spec path, once shown,
 * stays, with the same component and props.
 */

export interface PartialVariant {
  /** Buildable spec: only settled components, the requested platform. */
  spec: ScreenSpec;
  /** The frame can be shown: the screen's settings are written and its regions have started. */
  buildable: boolean;
  name: string;
  rationale: string;
  rationaleDone: boolean;
  /** The screen's JSON object is closed. */
  done: boolean;
}

export interface PartialGenerate {
  approach: string;
  approachDone: boolean;
  variants: PartialVariant[];
}

type Obj = Record<string, unknown>;

const REGIONS = ["header", "sidebar", "hero", "body", "footer"] as const;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** A string value that has been written in full. */
const whole = (o: Obj, key: string): string | undefined => (typeof o[key] === "string" && !(isPartial(o) && partialKey(o) === key) ? (o[key] as string) : undefined);

/** Settled components of a list, in order; stops at the first that isn't ready. */
export function settledItems(list: unknown): Inst[] {
  if (!Array.isArray(list)) return [];
  const out: Inst[] = [];
  for (const item of list) {
    if (!isObj(item)) break;
    if (!isPartial(item)) {
      out.push(item as unknown as Inst);
      continue;
    }
    // Written as component, props, children: usable once the props are closed.
    const component = whole(item, "component");
    const props = item.props;
    if (!component || !isObj(props) || isPartial(props)) break;
    const inst: Inst = { component, props } as Inst;
    if (CATALOG_BY_NAME.get(component)?.container || "children" in item) inst.children = settledItems(item.children);
    out.push(inst);
    break;
  }
  return out;
}

function variant(v: unknown, platform: Platform): PartialVariant | null {
  if (!isObj(v)) return null;
  const partial = isPartial(v);
  const name = typeof v.name === "string" ? v.name : "";
  const rationale = typeof v.rationale === "string" ? v.rationale : "";
  const dir = whole(v, "dir") === "rtl" ? "rtl" : "ltr";
  const lang = whole(v, "lang");
  const background = whole(v, "background");
  const overlap = whole(v, "overlap");
  const spec: ScreenSpec = {
    name: name || "Screen",
    rationale: whole(v, "rationale"),
    platform,
    margin: typeof v.margin === "number" ? v.margin : null,
    dir,
    lang: lang === "ar" || lang === "en" ? lang : dir === "rtl" ? "ar" : "en",
    background: background === "surface" ? "surface" : "canvas",
    overlap: (overlap && ["none", "sm", "md", "lg"].includes(overlap) ? overlap : "none") as Overlap,
    body: [],
  };
  for (const r of REGIONS) spec[r] = settledItems(v[r]);
  return {
    spec,
    // The settings come before the regions: wait for them so the frame doesn't flip direction or colour.
    buildable: !partial || REGIONS.some((r) => r in v),
    name,
    rationale,
    rationaleDone: whole(v, "rationale") !== undefined,
    done: !partial,
  };
}

export function partialGenerate(value: unknown, platform: Platform): PartialGenerate {
  const root = isObj(value) ? value : {};
  // Components come before the screens; each screen carries the ones it places, once they're written in full.
  const defs = cleanDefs(Array.isArray(root.newComponents) ? root.newComponents.filter((d) => isObj(d) && !isPartial(d)) : [], isReservedName);
  const variants = Array.isArray(root.variants)
    ? root.variants
        .map((v) => variant(v, platform))
        .filter((v): v is PartialVariant => !!v)
        .map((v) => ({ ...v, spec: attachDefs(v.spec, defs) }))
    : [];
  return {
    approach: typeof root.approach === "string" ? root.approach : "",
    approachDone: whole(root, "approach") !== undefined,
    variants,
  };
}

/** Spec paths in reading order (header, sidebar, hero, body depth-first, footer), as the builders stamp them. */
export function specPaths(spec: ScreenSpec): string[] {
  const out: string[] = [];
  const walk = (list: Inst[] | undefined, prefix: string) =>
    (list ?? []).forEach((inst, i) => {
      out.push(`${prefix}.${i}`);
      walk(inst.children, `${prefix}.${i}.children`);
    });
  for (const r of REGIONS) walk(spec[r], r);
  return out;
}

/** The spec with only the first `count` components (in `specPaths` order) kept. */
export function firstComponents(spec: ScreenSpec, count: number): ScreenSpec {
  let left = count;
  const take = (list: Inst[] | undefined): Inst[] => {
    const out: Inst[] = [];
    for (const inst of list ?? []) {
      if (left <= 0) break;
      left--;
      out.push(inst.children ? { ...inst, children: take(inst.children) } : inst);
    }
    return out;
  };
  const out: ScreenSpec = { ...spec, body: [] };
  for (const r of REGIONS) out[r] = take(spec[r]);
  return out;
}
