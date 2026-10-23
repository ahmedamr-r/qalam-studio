import type { Doc, SceneNode } from "@/doc/schema";
import type { Inst, ScreenSpec } from "./builders";

/**
 * Component instances on the canvas. A node built from a catalog component is an instance of it:
 * it records where it sits in its screen's spec (`specPath`) or, when placed on its own, the
 * instance itself (`inst`). A fingerprint taken when it was built tells whether the designer has
 * changed it since (an override); untouched instances can be rebuilt whenever the component's
 * source — its design system — changes.
 */

/** The instance at a spec path such as "body.2.children.0". */
export function specAt(spec: ScreenSpec | undefined, path: string | undefined): Inst | undefined {
  if (!spec || !path) return undefined;
  const [region, ...rest] = path.split(".");
  let list = (spec as unknown as Record<string, Inst[] | undefined>)[region];
  let cur: Inst | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "children") {
      list = cur?.children;
      continue;
    }
    cur = list?.[Number(rest[i])];
    if (!cur) return undefined;
  }
  return cur;
}

const rootOf = (doc: Doc, id: string) => {
  let n = doc.nodes[id];
  while (n?.parentId) n = doc.nodes[n.parentId];
  return n;
};

/** The catalog instance a node was built from, if it is one. */
export function instOf(doc: Doc, id: string): Inst | undefined {
  const n = doc.nodes[id];
  if (!n) return undefined;
  if (n.meta.inst) return n.meta.inst;
  return n.meta.specPath !== undefined ? specAt(rootOf(doc, id)?.meta.spec, n.meta.specPath) : undefined;
}

const paintKey = (p: { token?: string; color?: string } | null | undefined) => (p ? (p.token ?? p.color ?? "") : "");

/**
 * What a designer can change in an instance, leaving out everything its source controls: values
 * bound to tokens count by their token, and geometry not at all (auto layout and recipes set it).
 */
export function instanceFingerprint(doc: Doc, id: string): string {
  const parts: string[] = [];
  const walk = (nid: string) => {
    const n = doc.nodes[nid];
    if (!n) return;
    parts.push(
      [
        n.type,
        n.meta.component ?? "",
        n.type === "text" ? n.text.content : "",
        n.type === "text" ? (n.text.typeToken ?? `${n.text.fontSize}/${n.text.fontWeight}/${n.text.fontFamily}`) : "",
        n.type === "icon" ? n.icon : n.type === "path" ? n.d : n.type === "image" ? n.src : "",
        paintKey(n.fill),
        n.stroke ? (n.stroke.token ?? n.stroke.color) : "",
        n.radius ? (n.radius.token ?? `${n.radius.tl.rx},${n.radius.tr.rx},${n.radius.br.rx},${n.radius.bl.rx}`) : "",
        n.shadowToken ?? (n.effects?.length ? String(n.effects.length) : ""),
        n.visible ? "" : "hidden",
        n.opacity,
        n.children.length,
      ].join("|"),
    );
    n.children.forEach(walk);
  };
  walk(id);
  let h = 5381;
  for (const c of parts.join("\n")) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

const isInstance = (n: SceneNode) => n.meta.specPath !== undefined || !!n.meta.inst;

/** Record each instance's fingerprint right after it was built. */
export function stampInstances(nodes: SceneNode[]) {
  const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [] };
  for (const n of nodes) if (isInstance(n)) n.meta.instFingerprint = instanceFingerprint(doc, n.id);
}

/** Built from a component and changed by hand since. Instances from before fingerprints existed count as changed. */
export function isOverridden(doc: Doc, id: string): boolean {
  const n = doc.nodes[id];
  return !n?.meta.instFingerprint || instanceFingerprint(doc, id) !== n.meta.instFingerprint;
}

/** The catalog component a node's `meta.component` names ("Button/Primary" → "Button"). */
export const baseComponent = (component: string | undefined) => component?.split("/")[0];

/** Outermost instances of a catalog component in the document. */
export function instancesOf(doc: Doc, name: string, roots = doc.roots): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (isInstance(n) && instOf(doc, id)?.component === name) {
      out.push(id);
      return;
    }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}
