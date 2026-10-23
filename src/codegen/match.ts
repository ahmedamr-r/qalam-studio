import type { Doc, Prototype } from "@/doc/schema";

/**
 * Smart-animate matching (pure). Every component instance in a screen gets a key; instances with
 * the same key on two screens are the same element, so a smart transition morphs one into the
 * other (Motion's layoutId). A key is the prototype's explicit one for the instance's spec path,
 * else its component and its place among that component's instances in reading order: the
 * ProgressTracker is "ProgressTracker-0" whether it sits at body.1 or inside a card at
 * body.1.children.0.
 */

/** "ProgressTracker/Bar" → "ProgressTracker"; made components keep their own name ("Custom/OrderCard" → "OrderCard"). */
export function componentKey(component: string | undefined): string {
  const [head, rest] = (component ?? "Layer").split("/");
  return (head === "Custom" || head === "Unknown") && rest ? rest : head;
}

/** Match keys of a screen's instances, by node id. */
export function instanceKeys(doc: Doc, rootId: string, explicit?: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const count = new Map<string, number>();
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n?.visible) return;
    if (id !== rootId && (n.meta.specPath !== undefined || n.meta.inst)) {
      const own = n.meta.specPath !== undefined ? explicit?.[n.meta.specPath] : undefined;
      if (own) out.set(id, own);
      else {
        const c = componentKey(n.meta.component);
        const i = count.get(c) ?? 0;
        count.set(c, i + 1);
        out.set(id, `${c}-${i}`);
      }
    }
    n.children.forEach(walk);
  };
  walk(rootId);
  return out;
}

/**
 * Keys for the layers inside a matched instance, so they morph too (Figma matches layers by name):
 * the instance's key, then each layer's place in it. Frames and shapes go by name; text and icons
 * by kind and order, since their names follow what they say and show ("Call" morphs into "Contact
 * support"). Instances nested inside keep their own keys.
 */
export function partKeys(doc: Doc, id: string, key: string, instances: Map<string, string>, out = new Map<string, string>()): Map<string, string> {
  const seen = new Map<string, number>();
  for (const c of doc.nodes[id]?.children ?? []) {
    const n = doc.nodes[c];
    if (!n?.visible || instances.has(c)) continue;
    const base = n.type === "text" || n.type === "icon" ? n.type : n.name.replace(/[^\w -]+/g, "").trim() || n.type;
    const i = seen.get(base) ?? 0;
    seen.set(base, i + 1);
    const k = `${key}/${base}${i ? `~${i}` : ""}`;
    out.set(c, k);
    partKeys(doc, c, k, instances, out);
  }
  return out;
}

/**
 * Screens a smart transition can run between: both ends of a smart link, and for a smart "back",
 * the screen with every screen that links to it.
 */
export function smartPartners(proto: Prototype, screens: string[]): Map<string, Set<string>> {
  const partners = new Map(screens.map((id) => [id, new Set<string>()]));
  const into = new Map<string, Set<string>>();
  for (const l of proto.links) if (typeof l.to === "object" && "screen" in l.to) (into.get(l.to.screen) ?? into.set(l.to.screen, new Set()).get(l.to.screen)!).add(l.from.screen);
  const pair = (a: string, b: string) => {
    if (a === b || !partners.has(a) || !partners.has(b)) return;
    partners.get(a)!.add(b);
    partners.get(b)!.add(a);
  };
  for (const l of proto.links) {
    if (l.transition.kind !== "smart") continue;
    if (l.to === "back") for (const prev of into.get(l.from.screen) ?? []) pair(l.from.screen, prev);
    else if ("screen" in l.to) pair(l.from.screen, l.to.screen);
  }
  return partners;
}

/** Per screen, the keys it shares with a smart partner: those layers get a layoutId. */
export function sharedKeys(keys: Map<string, Map<string, string>>, partners: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, own] of keys) {
    const theirs = new Set([...(partners.get(id) ?? [])].flatMap((p) => [...(keys.get(p)?.values() ?? [])]));
    out.set(id, new Set([...own.values()].filter((k) => theirs.has(k))));
  }
  return out;
}
