import type { Inst } from "./builders";
import { CATALOG_BY_NAME } from "./components";
import type { ComponentDef, ComponentProp, DesignDocs } from "./docs";

/**
 * A component's props: what changes from one use to the next (a product's name, its price, a
 * label, an icon). A component with props is placed by name and filled in; one without can only be
 * copied part by part, and copies drift apart (different widths, different picture shapes). So
 * every component gets props: the ones it declares when its composition uses them, otherwise ones
 * read from its composition, named by the job each part does (title, caption, image, tag…).
 */

/** Values a Custom instance can fill (see CUSTOM_SPEC.values). */
export const MAX_PROPS = 8;

const placeholder = (name: string) => `{${name}}`;

/** A figure: digits with at most a currency code or unit around them ("EGP 299.00", "-$4.50", "1,204", "24 min"). */
const isFigure = (v: string) => /\d/.test(v) && (v.match(/\p{L}/gu) ?? []).length <= 4;

/** The role a piece of content plays, so instances read naturally ({title}, {value}, {image}…), whatever the product. */
function roleOf(inst: Inst, key: string, value: string): string {
  const style = String(inst.props?.style ?? "");
  switch (inst.component) {
    case "Text":
      if (isFigure(value)) return "value";
      return /title|headline|display|strong/.test(style) ? "title" : /caption|label|overline|footnote/.test(style) ? "caption" : "text";
    case "Image":
    case "MediaPlaceholder":
      return "image";
    case "Icon":
      return "icon";
    case "Tag":
      return "tag";
    case "Button":
      return "action";
    default:
      return key;
  }
}

/** Props read from a composition: each content string (or icon) becomes `{role}`, with the old value as its example. */
function deriveProps(composition: Inst): { props: ComponentProp[]; composition: Inst } {
  const props: ComponentProp[] = [];
  const taken = new Map<string, number>();
  const walk = (inst: Inst): Inst => {
    if (!inst || typeof inst !== "object") return inst;
    const spec = CATALOG_BY_NAME.get(inst.component);
    const next: Record<string, unknown> = { ...(inst.props ?? {}) };
    if (spec && inst.component !== "Graphic")
      for (const [key, p] of Object.entries(spec.props)) {
        const v = next[key];
        if (props.length >= MAX_PROPS || typeof v !== "string" || !v.trim() || v.includes("{")) continue;
        if (p.type !== "string" && p.type !== "icon") continue;
        const role = roleOf(inst, key, v).replace(/[^A-Za-z0-9]/g, "") || "text";
        const n = (taken.get(role) ?? 0) + 1;
        taken.set(role, n);
        const name = n === 1 ? role : `${role}${n}`;
        const limit = p.type === "string" ? p.maxChars : 40;
        props.push({
          name,
          kind: p.type === "icon" ? "icon" : "text",
          // Room for real values a little longer than the example, within what the part allows.
          maxChars: Math.min(limit, Math.max(12, Math.ceil(v.length * 1.6))),
          example: v.slice(0, 80),
        });
        next[key] = placeholder(name);
      }
    return { ...inst, ...(inst.props ? { props: next } : {}), ...(inst.children ? { children: inst.children.map(walk) } : {}) };
  };
  return { props, composition: walk(structuredClone(composition)) };
}

/**
 * The definition with usable props: its declared props that its composition shows, or, when it
 * shows none, props read from the composition. Deterministic, so a saved system and a prompt
 * built from it name the same props.
 */
export function withProps<T extends ComponentDef>(def: T): T {
  if (!def?.composition || typeof def.composition !== "object") return def;
  const json = JSON.stringify(def.composition);
  const declared = (def.props ?? []).filter((p) => p && json.includes(placeholder(p.name)));
  if (declared.length) return declared.length === def.props!.length ? def : { ...def, props: declared };
  const derived = deriveProps(def.composition);
  return derived.props.length ? { ...def, props: derived.props, composition: derived.composition } : def;
}

/** A system's docs with every pattern given props (systems saved before patterns had them). */
export function withPatternProps(docs: DesignDocs): DesignDocs {
  if (!Array.isArray(docs?.patterns) || !docs.patterns.length) return docs;
  const patterns = docs.patterns.map((p) => withProps(p));
  return patterns.every((p, i) => p === docs.patterns[i]) ? docs : { ...docs, patterns };
}
