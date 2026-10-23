/**
 * The Components page at work (Screens projects): built from the project's design system when it
 * shows and again whenever that system changes (tokens, styles, its own components, an AI tune),
 * and read-only while it shows. Three layers keep it read-only: a canvas delegate owns the
 * pointer (a click picks a component or one of its variants, a double-click opens it in the
 * component library), a command guard leaves only viewing, zooming and page commands, and a doc
 * pass undoes anything else that reaches its drawings and sends new layers to the page it was
 * opened from.
 */
import { registerDocPass, studio, useStudio } from "@/doc/store";
import { COMPONENTS_PAGE, onComponentsPage } from "@/doc/pages";
import { componentsGuard, componentsPass } from "./readonly";
import type { Doc, SceneNode, ShowcaseMeta } from "@/doc/schema";
import { hitPath } from "@/engine/hit-test";
import { setCanvasDelegate, type CanvasDelegate } from "@/engine/canvas-delegate";
import type { Pt } from "@/doc/geometry";
import { setCommandGuard } from "@/commands/registry";
import { activeSystem, tokenSetFor, useSystems } from "@/design-system/registry";
import { buildShowcase, showcaseSig, type Showcase } from "@/design-system/showcase";
import { ensureSystemFonts } from "@/design-system/place";
import { ensureYoga } from "@/engine/layout";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { openWorkspace } from "../workspace/store";
import { goToPage, onPageChange, pageCamera } from "../pages";

// ---------------------------------------------------------------------------
// What a node on the page shows

/** The card or variant cell a node is in (the node itself when it is one), else null. */
export function showcaseTarget(doc: Doc, id: string | null | undefined): SceneNode | null {
  let n = id ? doc.nodes[id] : undefined;
  let card: SceneNode | null = null;
  while (n) {
    const k = n.meta.showcase?.kind;
    if (k === "cell") return n;
    if (k === "card" && !card) card = n;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return card;
}

/** The component the selection shows, with the variant cell when one is selected. */
export function selectedShowcase(doc: Doc, selection: string[]): { card: SceneNode; cell: SceneNode | null; meta: ShowcaseMeta } | null {
  const t = showcaseTarget(doc, selection[0]);
  if (!t?.meta.showcase) return null;
  const cell = t.meta.showcase.kind === "cell" ? t : null;
  let card: SceneNode | undefined = t;
  while (card && card.meta.showcase?.kind !== "card") card = card.parentId ? doc.nodes[card.parentId] : undefined;
  return card ? { card, cell, meta: t.meta.showcase } : null;
}

/** The card drawing a component on the page showing. */
export const cardOf = (doc: Doc, component: string): SceneNode | undefined =>
  Object.values(doc.nodes).find((n) => n.meta.showcase?.kind === "card" && n.meta.showcase.component === component);

// ---------------------------------------------------------------------------
// Building it

let cache: Showcase | null = null;
let building: Promise<void> | null = null;
let again = false;

/** The build the page shows, from its sections. */
const shownSig = (doc: Doc) => doc.nodes[doc.roots[0]]?.meta.showcase?.sig;

/** Put a build on the page (no history: it is drawn from the system, not designed). */
function show(sc: Showcase) {
  const s = studio();
  if (!onComponentsPage(s.doc)) return;
  const nodes: Doc["nodes"] = {};
  const old = new Set<string>();
  const add = (id: string) => {
    if (old.has(id) || !s.doc.nodes[id]) return;
    old.add(id);
    s.doc.nodes[id].children.forEach(add);
  };
  s.doc.roots.forEach(add);
  for (const [id, n] of Object.entries(s.doc.nodes)) if (!old.has(id)) nodes[id] = n;
  for (const n of sc.nodes) nodes[n.id] = n;
  const first = !s.doc.roots.length;
  // Fixed ids: what was selected stays selected when it's still drawn.
  useStudio.setState({ doc: { ...s.doc, nodes, roots: sc.roots }, selection: s.selection.filter((id) => nodes[id]), hoverId: null });
  if (first && !pageCamera(COMPONENTS_PAGE)) onCanvasReady((c) => c.zoomToFit());
}

/** Build the page for the active system unless it already shows that build. */
export function refreshComponentsPage(): Promise<void> {
  if (building) {
    again = true;
    return building;
  }
  building = (async () => {
    do {
      again = false;
      const ds = activeSystem();
      const sig = showcaseSig(ds);
      if (!onComponentsPage(studio().doc) || (shownSig(studio().doc) === sig && studio().doc.roots.length)) continue;
      if (cache?.sig !== sig) {
        await Promise.all([ensureYoga(), ensureSystemFonts(ds.id)]);
        if (!onComponentsPage(studio().doc)) continue;
        cache = buildShowcase({ id: ds.id, name: ds.name, updatedAt: ds.updatedAt, patterns: ds.docs.patterns }, tokenSetFor(ds.id));
      }
      if (showcaseSig(activeSystem()) === cache.sig) show(cache);
      else again = true;
    } while (again);
  })().finally(() => {
    building = null;
  });
  return building;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Token edits come in bursts (a drag on a slider): rebuild once they settle. */
const scheduleRefresh = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void refreshComponentsPage(), 120);
};

// ---------------------------------------------------------------------------
// Read-only

/** The card or cell under a canvas point. */
export function pick(world: Pt): string | null {
  const s = studio();
  const path = hitPath(s.doc, world, undefined, { tol: 2 / s.camera.zoom });
  return path ? (showcaseTarget(s.doc, path[path.length - 1])?.id ?? null) : null;
}

/** The pointer on the page: picking and hovering, never moving anything. */
export const componentsDelegate: CanvasDelegate = {
  pointerDown(p) {
    if (p.button !== 0) return false;
    const id = pick(p.world);
    const s = studio();
    if (p.shift && id) s.select(s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
    else s.select(id ? [id] : []);
    return true;
  },
  pointerMove(p) {
    studio().setHover(pick(p.world));
    return true;
  },
  pointerUp() {
    return true;
  },
  doubleClick(p) {
    const t = showcaseTarget(studio().doc, pick(p.world));
    const component = t?.meta.showcase?.component;
    if (component) openWorkspace("components", { component, systemId: useSystems.getState().activeId });
    return true;
  },
  cursor() {
    return "default";
  },
  render() {
    return null;
  },
};

/** Show the Components page on a component (from an instance's badge, the Assets panel). */
export function revealComponent(component: string) {
  const go = () => {
    const s = studio();
    const card = cardOf(s.doc, component);
    if (!card) return;
    s.select([card.id]);
    onCanvasReady((c) => glideToLayer(c, card.id));
  };
  if (onComponentsPage(studio().doc) && cardOf(studio().doc, component)) return go();
  if (goToPage(COMPONENTS_PAGE)) void refreshComponentsPage().then(go);
}

// ---------------------------------------------------------------------------
// Starting

let started = false;

function enter() {
  setCanvasDelegate(componentsDelegate);
  setCommandGuard(componentsGuard, { announce: true });
  const s = studio();
  if (s.tool !== "select" && s.tool !== "hand") s.setTool("select");
  void refreshComponentsPage();
}

function leave() {
  setCanvasDelegate(null);
  setCommandGuard(null);
}

/** Screens projects: the Components page follows the project's system (idempotent). */
export function startComponentsPage() {
  if (started) return;
  started = true;
  registerDocPass(componentsPass);
  onPageChange((page, prev) => {
    if (page === COMPONENTS_PAGE) enter();
    else if (prev === COMPONENTS_PAGE) leave();
  });
  // The project's system changed, or was switched: draw it again while the page shows.
  useSystems.subscribe((s, prev) => {
    if (!onComponentsPage(studio().doc)) return;
    const a = s.systems.find((x) => x.id === s.activeId);
    const b = prev.systems.find((x) => x.id === prev.activeId);
    if (s.activeId !== prev.activeId || a?.updatedAt !== b?.updatedAt || s.systems.length !== prev.systems.length) scheduleRefresh();
  });
  if (onComponentsPage(studio().doc)) enter();
}
