/**
 * Figma's pages (pure). The page showing keeps its top-level layers and prototype in `doc.roots`
 * and `doc.proto`, so everything that draws, hits, selects or places works on it unchanged; the
 * other pages keep theirs in their `CanvasPage` entry, while every node stays in the one shared
 * `doc.nodes` (chats, briefs and syncs find screens on any page by id). A document without
 * `pages` is one implicit page.
 *
 * The Components page ("components") is never in `pages`: code draws it from the design system
 * while it shows (design-system/showcase.ts) and leaving it drops its nodes, so it is never saved.
 *
 * Code that means the whole document (counts, thumbnails, looks in use, token renames) reads
 * `wholeDoc(doc)`; code that means what's on the canvas keeps reading `doc.roots`.
 */
import { nanoid } from "nanoid";
import { normalizeProto, pruneProto } from "./proto";
import type { CanvasPage, Doc, Prototype, SceneNode } from "./schema";

export const COMPONENTS_PAGE = "components";
/** The id of a document's only page before it has any (stable, so undo and tests agree). */
export const FIRST_PAGE = "page-1";
export const MAX_PAGES = 100;
export const MAX_PAGE_NAME = 60;

export const isShowcase = (n: SceneNode | undefined): boolean => !!n?.meta.showcase;
export const onComponentsPage = (doc: Doc): boolean => doc.page === COMPONENTS_PAGE;

/** The screens pages in order (an implicit "Page 1" when the document has none). */
export function pagesOf(doc: Doc): CanvasPage[] {
  return doc.pages?.length ? doc.pages : [{ id: FIRST_PAGE, name: "Page 1", roots: [] }];
}

/** The page showing: a screens page's id or COMPONENTS_PAGE. */
export function activePage(doc: Doc): string {
  if (doc.page === COMPONENTS_PAGE) return COMPONENTS_PAGE;
  const pages = pagesOf(doc);
  return doc.page && pages.some((p) => p.id === doc.page) ? doc.page : pages[0].id;
}

/** The screens page that shows, or that the Components page was opened from. */
export function screensPage(doc: Doc): string {
  const pages = pagesOf(doc);
  const id = doc.page === COMPONENTS_PAGE ? doc.returnPage : doc.page;
  return id && pages.some((p) => p.id === id) ? id : pages[0].id;
}

export const pageName = (doc: Doc, id: string): string => (id === COMPONENTS_PAGE ? "Components" : (pagesOf(doc).find((p) => p.id === id)?.name ?? "Page"));

/** A page's top-level layers (the showing one's are `doc.roots`). */
export function pageRoots(doc: Doc, id: string): string[] {
  if (id === activePage(doc)) return doc.roots;
  return pagesOf(doc).find((p) => p.id === id)?.roots ?? [];
}

/** Every screens page's top-level layers, in page order (never the Components page's). */
export function allScreenRoots(doc: Doc): string[] {
  if (!doc.pages?.length && doc.page !== COMPONENTS_PAGE) return doc.roots;
  const showing = activePage(doc);
  return pagesOf(doc).flatMap((p) => (p.id === showing ? doc.roots : p.roots));
}

const rootSets = new WeakMap<string[], Set<string>>();
const setOf = (roots: string[]) => {
  let s = rootSets.get(roots);
  if (!s) rootSets.set(roots, (s = new Set(roots)));
  return s;
};

/** The top-level layer a node is in (itself when it has no parent). */
export function topOf(doc: Doc, id: string): string {
  let cur = doc.nodes[id];
  let top = id;
  while (cur?.parentId) {
    top = cur.parentId;
    cur = doc.nodes[cur.parentId];
  }
  return top;
}

/** Is the node on the page showing? */
export const isOnPage = (doc: Doc, id: string): boolean => !!doc.nodes[id] && setOf(doc.roots).has(topOf(doc, id));

/** The page a node is on, if any. */
export function pageOf(doc: Doc, id: string): string | undefined {
  if (!doc.nodes[id]) return undefined;
  const top = topOf(doc, id);
  if (setOf(doc.roots).has(top)) return activePage(doc);
  return pagesOf(doc).find((p) => setOf(p.roots).has(top))?.id;
}

const wholeCache = new WeakMap<Doc, Doc>();

/**
 * The whole document as one page: every screens page's layers, in page order, and none of the
 * Components page's. No prototype (prototypes are per page). The doc itself when it has one page.
 */
export function wholeDoc(doc: Doc): Doc {
  if (!doc.pages?.length && doc.page !== COMPONENTS_PAGE) return doc;
  let w = wholeCache.get(doc);
  if (!w) {
    const nodes = doc.page === COMPONENTS_PAGE ? withoutShowcase(doc.nodes, doc.roots) : doc.nodes;
    w = { nodes, roots: allScreenRoots(doc), brief: doc.brief, knowledge: doc.knowledge };
    wholeCache.set(doc, w);
  }
  return w;
}

/** Nodes without these top-level layers' subtrees and any stray showcase node. */
function withoutShowcase(nodes: Doc["nodes"], roots: string[]): Doc["nodes"] {
  const drop = new Set<string>();
  const add = (id: string) => {
    const n = nodes[id];
    if (!n || drop.has(id)) return;
    drop.add(id);
    n.children.forEach(add);
  };
  roots.filter((id) => isShowcase(nodes[id])).forEach(add);
  for (const n of Object.values(nodes)) if (n.meta.showcase && !n.parentId) add(n.id);
  if (!drop.size) return nodes;
  const out: Doc["nodes"] = {};
  for (const [id, n] of Object.entries(nodes)) if (!drop.has(id)) out[id] = n;
  return out;
}

/** The pages as a real list (the implicit page made real), copied so it can be changed. */
const materialize = (doc: Doc): CanvasPage[] => pagesOf(doc).map((p) => ({ ...p }));

/**
 * Show another page. The page leaving keeps its layers and prototype in its entry (the Components
 * page drops its nodes); the page arriving moves its own into `roots` and `proto`. The Components
 * page arrives empty: its runtime builds it. Returns `doc` when that page already shows.
 */
export function switchPage(doc: Doc, id: string): Doc {
  const from = activePage(doc);
  const pages = materialize(doc);
  if (id === from || (id !== COMPONENTS_PAGE && !pages.some((p) => p.id === id))) return doc;
  let nodes = doc.nodes;
  let returnPage: string | undefined;
  if (from === COMPONENTS_PAGE) nodes = withoutShowcase(doc.nodes, doc.roots);
  else {
    const i = pages.findIndex((p) => p.id === from);
    pages[i] = withProto({ ...pages[i], roots: doc.roots }, doc.proto);
    returnPage = from;
  }
  const next: Doc = { ...doc, nodes, pages, page: id };
  delete next.returnPage;
  delete next.proto;
  if (id === COMPONENTS_PAGE) {
    next.roots = [];
    next.returnPage = returnPage ?? screensPage(doc);
  } else {
    const i = pages.findIndex((p) => p.id === id);
    next.roots = pages[i].roots;
    if (pages[i].proto) next.proto = pages[i].proto;
    pages[i] = { id: pages[i].id, name: pages[i].name, roots: [] };
  }
  return next;
}

const withProto = (p: CanvasPage, proto: Prototype | undefined): CanvasPage => {
  const out: CanvasPage = { id: p.id, name: p.name, roots: p.roots };
  if (proto) out.proto = proto;
  return out;
};

/** What to save: on the Components page, the page it was opened from shows and its nodes go. */
export const forStorage = (doc: Doc): Doc => (doc.page === COMPONENTS_PAGE ? switchPage(doc, screensPage(doc)) : doc);

/** "Page 3": the first number after the pages named that way. */
export function nextPageName(doc: Doc): string {
  let n = pagesOf(doc).length;
  for (const p of pagesOf(doc)) {
    const m = /^Page (\d+)$/.exec(p.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Page ${n + 1}`;
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, MAX_PAGE_NAME);

/** A new empty page after the others (not shown yet). Returns the doc and the page's id. */
export function addPage(doc: Doc, name?: string): { doc: Doc; id: string } {
  const pages = materialize(doc);
  if (pages.length >= MAX_PAGES) return { doc, id: "" };
  const id = nanoid(10);
  pages.push({ id, name: cleanName(name ?? "") || nextPageName(doc), roots: [] });
  return { doc: { ...doc, pages, page: doc.page ?? pages[0].id }, id };
}

export function renamePage(doc: Doc, id: string, name: string): Doc {
  const n = cleanName(name);
  const pages = materialize(doc);
  const i = pages.findIndex((p) => p.id === id);
  if (!n || i < 0 || pages[i].name === n) return doc;
  pages[i] = { ...pages[i], name: n };
  return { ...doc, pages, page: doc.page ?? pages[0].id };
}

/** Move a page to `index` in the list. */
export function reorderPage(doc: Doc, id: string, index: number): Doc {
  const pages = materialize(doc);
  const i = pages.findIndex((p) => p.id === id);
  const to = Math.max(0, Math.min(pages.length - 1, index));
  if (i < 0 || i === to) return doc;
  const [p] = pages.splice(i, 1);
  pages.splice(to, 0, p);
  return { ...doc, pages, page: doc.page ?? pages[0].id };
}

export const canDeletePage = (doc: Doc, id: string): true | string =>
  id === COMPONENTS_PAGE ? "The Components page is always there" : pagesOf(doc).length < 2 ? "A project keeps one page at least" : true;

/**
 * Delete a page and everything on it. When it is showing, its neighbour (the next, else the
 * previous) shows instead.
 */
export function deletePage(doc: Doc, id: string): Doc {
  if (canDeletePage(doc, id) !== true) return doc;
  const list = pagesOf(doc);
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return doc;
  let d = doc;
  if (activePage(doc) === id) d = switchPage(doc, list[i + 1]?.id ?? list[i - 1].id);
  else if (doc.page === COMPONENTS_PAGE && doc.returnPage === id) d = { ...doc, returnPage: list[i + 1]?.id ?? list[i - 1].id };
  const gone = new Set<string>();
  const add = (n: string) => {
    if (gone.has(n) || !d.nodes[n]) return;
    gone.add(n);
    d.nodes[n].children.forEach(add);
  };
  pageRoots(d, id).forEach(add);
  const nodes: Doc["nodes"] = {};
  for (const [k, n] of Object.entries(d.nodes)) if (!gone.has(k)) nodes[k] = n;
  return { ...d, nodes, pages: materialize(d).filter((p) => p.id !== id) };
}

/** The page showing, emptied: its layers and prototype go; other pages and the Knowledge hub stay. */
export function clearPage(doc: Doc): Doc {
  const gone = new Set<string>();
  const add = (id: string) => {
    if (gone.has(id) || !doc.nodes[id]) return;
    gone.add(id);
    doc.nodes[id].children.forEach(add);
  };
  doc.roots.forEach(add);
  const nodes: Doc["nodes"] = {};
  for (const [k, n] of Object.entries(doc.nodes)) if (!gone.has(k)) nodes[k] = n;
  const next: Doc = { ...doc, nodes, roots: [] };
  delete next.proto;
  return next;
}

/** Both prototypes in one (the target's own settings win). */
export function mergeProto(into: Prototype | undefined, add: Prototype | undefined): Prototype | undefined {
  if (!add) return into;
  if (!into) return add;
  const out: Prototype = {
    links: [...into.links, ...add.links],
    tracks: [...into.tracks, ...add.tracks],
    states: { ...add.states, ...into.states },
  };
  const start = into.start ?? add.start;
  if (start) out.start = start;
  if (into.keys || add.keys) out.keys = { ...add.keys, ...into.keys };
  if (into.routes || add.routes) out.routes = { ...add.routes, ...into.routes };
  if (into.vars || add.vars) out.vars = { ...add.vars, ...into.vars };
  if (into.takes || add.takes) out.takes = [...(into.takes ?? []), ...(add.takes ?? [])];
  const feel = into.feel ?? add.feel;
  if (feel) out.feel = feel;
  return out;
}

/** A route's part frames (its sheets, dialogs and bars), from the prototype that holds it. */
function partsOf(proto: Prototype | undefined, screen: string): string[] {
  const r = proto?.routes?.[screen];
  return r ? [...Object.values(r.overlays), ...Object.values(r.addOns)].map((p) => p.frame) : [];
}

/**
 * Move top-level layers of the page showing to another screens page, with their route parts and
 * the part of the prototype about them. They keep their place on the canvas, as in Figma.
 */
export function moveToPage(doc: Doc, ids: string[], pageId: string): Doc {
  const pages = materialize(doc);
  const t = pages.findIndex((p) => p.id === pageId);
  if (t < 0 || pageId === activePage(doc) || doc.page === COMPONENTS_PAGE) return doc;
  const here = setOf(doc.roots);
  const moving = new Set(ids.filter((id) => here.has(id)));
  for (const id of [...moving]) for (const f of partsOf(doc.proto, id)) if (here.has(f)) moving.add(f);
  if (!moving.size) return doc;
  const order = doc.roots.filter((id) => moving.has(id));
  const rest = doc.roots.filter((id) => !moving.has(id));
  const target = pages[t];
  const carried = doc.proto ? pruneProto(doc.proto, order) : undefined;
  const carriedSome = carried && (carried.links.length || carried.tracks.length || Object.keys(carried.states).length || carried.routes || carried.takes || carried.keys);
  pages[t] = withProto({ ...target, roots: [...target.roots, ...order] }, carriedSome ? mergeProto(target.proto, carried) : target.proto);
  const next: Doc = { ...doc, roots: rest, pages, page: doc.page ?? pages[0].id };
  const left = doc.proto ? pruneProto(doc.proto, rest) : undefined;
  if (left) next.proto = left;
  else delete next.proto;
  return next;
}

/**
 * Make a document's pages consistent (opening a stored or imported file): unique ids and names,
 * each top-level layer on exactly one page, orphans on the page showing, stored prototypes valid
 * and pruned to their page, and no Components-page nodes (they are never saved; a document that
 * was on that page opens on the page it came from). A document without pages stays without.
 */
export function normalizePages(doc: Doc): Doc {
  let d = doc;
  const stray = Object.values(d.nodes).some((n) => n.meta.showcase);
  if (stray || d.page === COMPONENTS_PAGE) {
    const nodes = withoutShowcase(d.nodes, d.roots);
    d = { ...d, nodes, roots: d.roots.filter((id) => nodes[id]) };
    if (d.page === COMPONENTS_PAGE) {
      const back = d.returnPage;
      d = { ...d, page: back };
      delete d.returnPage;
      if (d.roots.length === 0 && back && d.pages?.some((p) => p.id === back)) {
        // Saved mid-way (an older build): the page it came from still holds its layers.
        const p = d.pages.find((x) => x.id === back)!;
        d = { ...d, roots: p.roots, pages: d.pages.map((x) => (x.id === back ? { id: x.id, name: x.name, roots: [] } : x)) };
        if (p.proto) d.proto = p.proto;
      }
    }
  }
  if (!d.pages?.length) {
    if (d.page !== undefined || d.returnPage !== undefined) {
      d = { ...d };
      delete d.page;
      delete d.returnPage;
    }
    return d;
  }
  const seenIds = new Set<string>();
  const placed = new Set<string>();
  const top = (id: string) => !!d.nodes[id] && !d.nodes[id].parentId && !placed.has(id);
  const showing = d.page && d.pages.some((p) => p.id === d.page) ? d.page : d.pages[0].id;
  const roots: string[] = [];
  for (const id of d.roots) if (top(id)) (placed.add(id), roots.push(id));
  const pages: CanvasPage[] = [];
  for (const raw of d.pages.slice(0, MAX_PAGES)) {
    if (!raw || typeof raw.id !== "string" || !raw.id || seenIds.has(raw.id) || raw.id === COMPONENTS_PAGE) continue;
    seenIds.add(raw.id);
    const name = cleanName(typeof raw.name === "string" ? raw.name : "") || `Page ${pages.length + 1}`;
    const own = (Array.isArray(raw.roots) ? raw.roots : []).filter((id) => typeof id === "string" && top(id));
    own.forEach((id) => placed.add(id));
    if (raw.id === showing) {
      // The showing page's layers are `roots`; anything left in its entry joins them.
      roots.push(...own);
      pages.push({ id: raw.id, name, roots: [] });
      continue;
    }
    const proto = normalizeProto(raw.proto);
    const pruned = proto ? pruneProto(proto, own) : undefined;
    pages.push(withProto({ id: raw.id, name, roots: own }, pruned));
  }
  if (!pages.length) return { ...d, pages: undefined, page: undefined };
  // Top-level layers no page holds go on the page showing.
  for (const n of Object.values(d.nodes)) if (!n.parentId && !placed.has(n.id)) (placed.add(n.id), roots.push(n.id));
  const out: Doc = { ...d, roots, pages, page: pages.some((p) => p.id === showing) ? showing : pages[0].id };
  delete out.returnPage;
  return out;
}
