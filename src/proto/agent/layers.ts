/**
 * The layers a designer's ask can point at (pure): each component on the screen by id ("l1"),
 * what it is and what it says — and, inside repeated items, one entry for the same place in every
 * item ("the heart in each item"), so an ask about a dish's heart means every dish's. The model
 * names layers only by these ids; code turns them back into where they are.
 */
import type { Inst } from "@/design-system/builders";
import { CATALOG_BY_NAME } from "@/design-system/components";
import { CUSTOM, componentLookup, fillComposition } from "@/design-system/custom";
import { instOf } from "@/design-system/instances";
import { dsIdForNode, systemFor } from "@/design-system/registry";
import type { Doc, RouteRef, SceneNode } from "@/doc/schema";
import { subLayers } from "../items";
import { scanFrame } from "../scan";

export interface LayerEntry {
  id: string;
  ref: RouteRef;
  /** How it reads for the model ("IconButton 'Add Chicken shawarma' (icon plus), in each item"). */
  what: string;
  component: string;
  /** The same place in every repeated item. */
  each: boolean;
  /** Its props as designed (what a changed look starts from). */
  props: Record<string, unknown>;
}

/** Layout only: nothing a person would point at. */
const SKIP = new Set(["Stack", "Divider"]);
const MAX = 80;

const copyOf = (props: Record<string, unknown>) =>
  ["title", "label", "text", "value", "placeholder"]
    .map((k) => props[k])
    .find((v): v is string => typeof v === "string" && !!v.trim())
    ?.slice(0, 50);

/** What a component of the design's own is made of: its definition filled with this instance's values, every catalog instance in it in reading order. */
function madeOf(doc: Doc, screen: string, id: string): { name: string; parts: Inst[] } | null {
  const props = (instOf(doc, id)?.props ?? {}) as { name?: unknown; values?: unknown };
  if (typeof props.name !== "string") return null;
  const def = componentLookup(systemFor(dsIdForNode(doc, screen)).docs.patterns, doc.nodes[screen]?.meta.spec?.components)(props.name)?.def;
  if (!def) return { name: props.name, parts: [] };
  // Props left out show their example.
  const values: Record<string, string> = Object.fromEntries((def.props ?? []).map((p) => [p.name, String(p.example ?? "")]));
  for (const v of Array.isArray(props.values) ? props.values : []) if (v && typeof v.prop === "string") values[v.prop] = String(v.value ?? "");
  const parts: Inst[] = [];
  const visit = (i: Inst) => {
    parts.push(i);
    i.children?.forEach(visit);
  };
  visit(fillComposition(def, values));
  return { name: def.name, parts };
}

/** Every layer worth pointing at, in reading order. */
export function layerIndex(doc: Doc, screen: string): LayerEntry[] {
  const scan = scanFrame(doc, screen);
  const col = scan.collections[0];
  const items = new Set(col?.items ?? []);
  const inItem = (p: string) => [...items].find((it) => p === it || p.startsWith(`${it}.`));
  const out: LayerEntry[] = [];
  const seenEach = new Set<string>();
  /** An entry, once for the same place in every item. */
  const push = (e: Omit<LayerEntry, "id" | "each">, p: string) => {
    const item = inItem(p);
    if (!item || !col) return void out.push({ ...e, id: "", each: false });
    const ref = { ...e.ref, path: `${col.pattern}${p.slice(item.length)}` };
    const k = JSON.stringify(ref);
    if (seenEach.has(k)) return;
    seenEach.add(k);
    out.push({ ...e, id: "", ref, what: `${e.what}, in each item`, each: true });
  };
  /**
   * A component of the design's own (a dish row made for this screen): its layers have no spec
   * paths, so it's pointed at whole, and its buttons by their place among its actions.
   */
  const addCustom = (id: string, p: string) => {
    const made = madeOf(doc, screen, id);
    const name = made?.name ?? (doc.nodes[id].meta.component ?? "").split("/")[1] ?? "Component";
    const firstText = subtree(id).find((x) => x.type === "text");
    push({ ref: { path: p }, what: `${name}${firstText?.type === "text" ? ` "${firstText.text.content.slice(0, 50)}"` : ""}`, component: CUSTOM, props: {} }, p);
    const seen = new Map<string, number>();
    subLayers(doc, id, "action").forEach((a, nth) => {
      const layer = doc.nodes[a];
      const family = (layer.meta.component ?? "").split("/")[0];
      if (!CATALOG_BY_NAME.get(family)) return;
      // Its props as the definition sets them: the k-th of its kind in the definition.
      const k = seen.get(family) ?? 0;
      seen.set(family, k + 1);
      const props = (made?.parts.filter((x) => x.component === family)[k]?.props ?? {}) as Record<string, unknown>;
      const copy = copyOf(props) ?? layer.name;
      const icon = typeof props.icon === "string" ? ` (icon ${props.icon})` : "";
      push({ ref: { path: p, sub: { role: "action", nth } }, what: `${family} "${copy}"${icon} in ${name}`, component: family, props }, p);
    });
  };
  const subtree = (id: string): SceneNode[] => (doc.nodes[id]?.children ?? []).flatMap((c) => (doc.nodes[c]?.visible ? [doc.nodes[c], ...subtree(c)] : []));
  const walk = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const n = doc.nodes[c];
      if (!n?.visible) continue;
      const p = n.meta.specPath;
      if (p !== undefined && out.length < MAX) {
        const inst = instOf(doc, c);
        const component = inst?.component ?? (n.meta.component ?? "").split("/")[0];
        if (component === CUSTOM) {
          addCustom(c, p);
          continue;
        }
        if (component && !SKIP.has(component) && CATALOG_BY_NAME.get(component)) {
          const props = (inst?.props ?? {}) as Record<string, unknown>;
          const copy = copyOf(props);
          const icon = typeof props.icon === "string" ? ` (icon ${props.icon})` : "";
          // In an item: the same place in every item, once, as a pattern.
          push({ ref: { path: p }, what: `${component}${copy ? ` "${copy}"` : ""}${icon}`, component, props }, p);
        }
      }
      walk(c);
    }
  };
  walk(screen);
  return out.map((l, i) => ({ ...l, id: `l${i + 1}` }));
}

/** The index as the model reads it. */
export const describeLayers = (ls: LayerEntry[]) => ls.map((l) => `${l.id}: ${l.what}`).join("\n");
