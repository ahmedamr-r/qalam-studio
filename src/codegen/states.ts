import type { SceneNode } from "@/doc/schema";

/**
 * A screen's layers across its states (pure). Each state rebuilds the instances it changes (see
 * variants.ts); those rebuilt subtrees are merged into the screen's tree by aligning children, so
 * one tree holds every state: a layer knows its node in each state, and the states it exists in.
 * The emitter turns what differs into expressions of the screen's state.
 */

export interface VNode {
  /** The layer in the default state (or, for one only some states have, in the first of them). */
  base: SceneNode;
  /** The layer in states that rebuilt it. */
  inState: Map<string, SceneNode>;
  /** States it exists in; null = all (or whenever its parent does). */
  present: Set<string> | null;
  children: VNode[];
}

/** The layer as it is in a state. */
export const nodeIn = (v: VNode, state: string): SceneNode => v.inState.get(state) ?? v.base;

/** The visible tree under a node. */
export function treeOf(get: (id: string) => SceneNode | undefined, id: string): VNode | null {
  const n = get(id);
  if (!n?.visible) return null;
  return { base: n, inState: new Map(), present: null, children: n.children.map((c) => treeOf(get, c)).filter((c): c is VNode => !!c) };
}

/** What an instance keeps from the screen when a state rebuilds it: how it sits in its parent (refresh.ts keeps the same). */
const PLACEMENT = ["x", "y", "sizeH", "sizeV", "absolute", "minW", "maxW", "minH", "maxH", "grow", "margin", "rotation", "flipH", "flipV", "opacity", "visible", "name"] as const;

/** A component's family: a variant is the same layer in another look ("Chip/Selected" is a Chip). */
const family = (n: SceneNode) => (n.meta.component ?? "").split("/")[0];
/** Text matches by place (a state may change what it says); everything else by kind, name and component family too. */
const matchKey = (n: SceneNode) => (n.type === "text" ? `text|${family(n)}` : `${n.type}|${n.name}|${family(n)}`);

/** Longest common subsequence alignment of two lists by key. */
export function align<A, B>(a: A[], b: B[], ka: (x: A) => string, kb: (x: B) => string): [A | null, B | null][] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka(a[i]) === kb(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [A | null, B | null][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka(a[i]) === kb(b[j])) out.push([a[i++], b[j++]]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push([a[i++], null]);
    else out.push([null, b[j++]]);
  }
  while (i < n) out.push([a[i++], null]);
  while (j < m) out.push([null, b[j++]]);
  return out;
}

function merge(v: VNode, n: SceneNode, get: (id: string) => SceneNode | undefined, state: string, all: string[]) {
  v.inState.set(state, n);
  v.present?.add(state);
  const kids = n.children.map(get).filter((c): c is SceneNode => !!c?.visible);
  const next: VNode[] = [];
  for (const [had, now] of align(v.children, kids, (x) => matchKey(x.base), matchKey)) {
    if (had && now) {
      merge(had, now, get, state, all);
      next.push(had);
    } else if (had) {
      (had.present ??= new Set(all)).delete(state);
      next.push(had);
    } else if (now) {
      const added = treeOf(get, now.id)!;
      added.present = new Set([state]);
      next.push(added);
    }
  }
  v.children = next;
}

/**
 * Merge a state's rebuilt instance (its nodes, root first, as componentNodes builds them) into the
 * instance's layer. `all` lists every state of the screen, default first.
 */
export function mergeState(target: VNode, rebuilt: SceneNode[], state: string, all: string[]) {
  const byId = new Map(rebuilt.map((n) => [n.id, n]));
  const top = { ...rebuilt[0], parentId: target.base.parentId } as SceneNode;
  const keep = top as unknown as Record<string, unknown>;
  for (const k of PLACEMENT) keep[k] = (target.base as unknown as Record<string, unknown>)[k];
  top.meta = { ...top.meta, specPath: target.base.meta.specPath };
  byId.set(top.id, top);
  merge(target, top, (id) => byId.get(id), state, all);
}
