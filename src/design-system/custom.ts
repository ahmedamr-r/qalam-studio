import type { ComponentSpec } from "./components";
import type { ComponentDef, ComponentProp, Pattern } from "./docs";
import type { Inst } from "./builders";

/**
 * Components beyond the catalog: a design system's own (its patterns) and ones Qalam AI proposes
 * while designing (kept on the screen until the designer adds them to the system). A screen
 * places one with a Custom instance that names it and fills its props; the instance stays linked,
 * so changing the component in the system rebuilds every instance that wasn't changed by hand.
 */

export const CUSTOM = "Custom";

/** The reference instance. Not in the catalog: it isn't a component of its own, and needs a definition to draw. */
export const CUSTOM_SPEC: ComponentSpec = {
  name: CUSTOM,
  category: "content",
  description:
    "An instance of one of the design system's own components (listed with the system) or of a component defined in newComponents, by its exact name. values fill the component's props; props left out show their example. It draws exactly as the component is defined, so don't rebuild it from parts.",
  props: {
    name: { type: "string", maxChars: 40, required: true, description: "The component's exact name" },
    values: {
      type: "items",
      maxItems: 8,
      description: "One per prop that differs from its example",
      fields: {
        prop: { type: "string", maxChars: 24, required: true },
        value: { type: "string", maxChars: 80, required: true },
      },
    },
  },
  example: {},
};

export interface Resolved {
  def: ComponentDef;
  /** In the design system, or only on the screen (a proposal not added yet). */
  from: "system" | "local";
}

export type ComponentLookup = (name: string) => Resolved | undefined;

/** Names match loosely ("Cash Card", "CashCard", "cash-card"). */
export const componentKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Find components by name: the system's first (adopting one links every screen to it), then the screen's own. */
export function componentLookup(system: ComponentDef[] | undefined, local: ComponentDef[] | undefined): ComponentLookup {
  const sys = new Map((system ?? []).map((d) => [componentKey(d.name), d]));
  const loc = new Map((local ?? []).map((d) => [componentKey(d.name), d]));
  return (name) => {
    const k = componentKey(name);
    const s = sys.get(k);
    if (s) return { def: s, from: "system" };
    const l = loc.get(k);
    return l ? { def: l, from: "local" } : undefined;
  };
}

/** The composition with each declared `{prop}` filled in (a whole-string placeholder takes the value as is, e.g. an icon name). */
export function fillComposition(def: ComponentDef, values: Record<string, string>): Inst {
  const names = new Set((def.props ?? []).map((p) => p.name));
  const fill = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\{([^{}\s]{1,40})\}/g, (m, name: string) => (names.has(name) && name in values ? values[name] : m));
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return fill(structuredClone(def.composition)) as Inst;
}

/** Names of the components a list of instances places (at any depth). */
export function customNames(list: (Inst | undefined)[] | undefined): string[] {
  const out = new Set<string>();
  const walk = (i: Inst | undefined) => {
    if (!i || typeof i !== "object") return;
    if (i.component === CUSTOM && typeof i.props?.name === "string") out.add(i.props.name);
    i.children?.forEach(walk);
  };
  list?.forEach(walk);
  return [...out];
}

/** The definitions (from `defs`) that these instances place, matched by name. */
export function usedDefs(list: (Inst | undefined)[] | undefined, defs: ComponentDef[] | undefined): ComponentDef[] {
  if (!defs?.length) return [];
  const want = new Set(customNames(list).map(componentKey));
  return defs.filter((d) => want.has(componentKey(d.name)));
}

/** Merge definitions into a list, newer ones replacing older ones of the same name. */
export function mergeDefs(base: ComponentDef[] | undefined, add: ComponentDef[]): ComponentDef[] {
  const out = new Map((base ?? []).map((d) => [componentKey(d.name), d]));
  for (const d of add) out.set(componentKey(d.name), d);
  return [...out.values()];
}

/**
 * Component definitions from a model's answer, kept only when they're usable: a name that isn't
 * a catalog component's, props with sensible names and limits, and a composition to draw.
 */
export function cleanDefs(raw: unknown, reserved: (name: string) => boolean): ComponentDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ComponentDef[] = [];
  for (const d of raw.slice(0, 8)) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
    const comp = o.composition as Inst | undefined;
    if (!name || reserved(name) || !comp || typeof comp !== "object" || typeof comp.component !== "string") continue;
    if (out.some((x) => componentKey(x.name) === componentKey(name))) continue;
    out.push({ name, purpose: typeof o.purpose === "string" ? o.purpose.slice(0, 300) : "", props: cleanProps(o.props), composition: comp });
  }
  return out;
}

/** Props from a model's answer: sensible names, kinds and limits. */
export function cleanProps(raw: unknown): ComponentProp[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as Record<string, unknown>).name === "string" && /^[A-Za-z][\w-]{0,23}$/.test(String((p as Record<string, unknown>).name)))
    .slice(0, 8)
    .map((p) => ({
      name: String(p.name),
      kind: p.kind === "icon" ? ("icon" as const) : ("text" as const),
      maxChars: Math.max(1, Math.min(80, Math.round(Number(p.maxChars)) || 24)),
      example: typeof p.example === "string" ? p.example.slice(0, 80) : "",
    }));
}

/** A spec with the definitions its Custom instances need from `defs` added to its own. */
export function attachDefs<T extends { header?: Inst[]; sidebar?: Inst[]; hero?: Inst[]; body?: Inst[]; footer?: Inst[]; components?: ComponentDef[] }>(spec: T, defs: ComponentDef[]): T {
  if (!defs.length) return spec;
  const used = usedDefs([...(spec.header ?? []), ...(spec.sidebar ?? []), ...(spec.hero ?? []), ...(spec.body ?? []), ...(spec.footer ?? [])], defs);
  return used.length ? { ...spec, components: mergeDefs(spec.components, used) } : spec;
}

/** Parts of a composition, one line each, for a component's anatomy. */
function anatomy(inst: Inst, depth = 0, out: string[] = []): string[] {
  if (!inst || typeof inst !== "object" || out.length >= 10) return out;
  const p = inst.props ?? {};
  if (inst.component === "Graphic") {
    const shapes = Array.isArray(p.shapes) ? (p.shapes as Record<string, unknown>[]) : [];
    const kinds = [...new Set(shapes.map((s) => String(s?.kind ?? "rect")))];
    out.push(`${"  ".repeat(depth)}Graphic "${String(p.label ?? "")}": ${shapes.length} shapes (${kinds.join(", ")}) in the system's colour roles`);
  } else {
    const copy = Object.values(p).find((v) => typeof v === "string" && v.length > 1) as string | undefined;
    out.push(`${"  ".repeat(depth)}${inst.component}${copy ? `: "${copy.slice(0, 40)}"` : ""}`);
  }
  for (const c of inst.children ?? []) anatomy(c, depth + 1, out);
  return out;
}

/** Tokens a composition's artwork paints with (a Graphic's colour roles and radii). */
function tokensUsed(inst: Inst, out = new Set<string>()): Set<string> {
  if (!inst || typeof inst !== "object") return out;
  if (inst.component === "Graphic")
    for (const s of Array.isArray(inst.props?.shapes) ? (inst.props!.shapes as Record<string, unknown>[]) : []) {
      for (const k of ["fill", "stroke"]) if (typeof s?.[k] === "string" && s[k] !== "none") out.add(String(s[k]));
      if (typeof s?.radius === "string" && s.radius !== "none") out.add(`radius.${s.radius}`);
      if (s?.kind === "text" && typeof s.style === "string") out.add(`type.${s.style}`);
    }
  for (const c of inst.children ?? []) tokensUsed(c, out);
  return out;
}

/** A made component as one of a system's own, with a starting guide the designer can edit in the library. */
export function patternFrom(def: ComponentDef): Pattern {
  const props = def.props ?? [];
  return {
    ...structuredClone(def),
    origin: "ai",
    guide: {
      component: def.name,
      observed: false,
      purpose: def.purpose,
      whenToUse: [def.purpose].filter(Boolean),
      whenNotToUse: [],
      anatomy: anatomy(def.composition),
      variants: [],
      content: props.length ? `Props: ${props.map((p) => `${p.name} (${p.kind === "icon" ? "icon" : `up to ${p.maxChars} characters`}, e.g. "${p.example}")`).join("; ")}.` : "",
      placement: "",
      states: "",
      dos: [],
      donts: [],
      tokens: [...tokensUsed(def.composition)],
    },
  };
}
