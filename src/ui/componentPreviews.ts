import { useEffect, useState } from "react";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { ComponentDef } from "@/design-system/docs";
import { componentLookup } from "@/design-system/custom";
import { buildScreenNodes, componentNodes, ensureSystemFonts } from "@/design-system/place";
import { systemFor, tokenSetFor, type DesignSystem } from "@/design-system/registry";
import { TokenSet } from "@/design-system/resolve";
import { ensureFonts } from "@/engine/fonts";
import { makeFrame } from "@/doc/factory";
import { selectionBounds } from "@/doc/geometry";
import type { Doc, SceneNode } from "@/doc/schema";
import { ensureYoga } from "@/engine/layout";
import { exportRenderer } from "./exporter";
import { cutTexts, overflowing } from "@/design-system/component-import";

/**
 * Thumbnails for the Assets panel: each component is built with the design system and drawn by the
 * canvas renderer, so the preview is exactly what a click inserts. Rendered one at a time off the
 * main thread's critical path and cached per system version.
 */

/** Narrower than a screen so text stays legible at thumbnail size. */
const PREVIEW_W = 280;
/** Largest bitmap side, in device pixels (tiles are ~140–240 CSS px wide, at 2x). */
const MAX_PX = 480;

/** A rendered thumbnail and the component's size in canvas px, or "error" when it can't be built. */
export type Preview = { url: string; w: number; h: number };
type Result = Preview | "error";

let cache: { key: string; urls: Map<string, Result>; pending: Map<string, Promise<Result>> } = { key: "", urls: new Map(), pending: new Map() };
let queue: Promise<unknown> = Promise.resolve();

/** Drop every thumbnail from an older system version when a new one is asked for. */
function cacheFor(dsId: string) {
  const key = `${dsId}@${systemFor(dsId).updatedAt}`;
  if (cache.key !== key) {
    for (const r of cache.urls.values()) if (r !== "error") URL.revokeObjectURL(r.url);
    cache = { key, urls: new Map(), pending: new Map() };
  }
  return cache;
}

/** Pictures a set of nodes shows (to decode before drawing them). */
const imageSources = (nodes: SceneNode[]) => nodes.flatMap((n) => (n.type === "image" && n.src ? [n.src] : []));

/** Larger renders for the component library: real width, either direction. */
export interface PreviewOpts {
  width?: number;
  dir?: "ltr" | "rtl";
  /** Components not in the system yet (proposed for a screen) that the instance may place. */
  components?: ComponentDef[];
}

async function draw(inst: Inst, dsId: string, opts: PreviewOpts = {}): Promise<{ bytes: Uint8Array; w: number; h: number; nodes: SceneNode[] } | null> {
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const renderer = await exportRenderer();
  const dir = opts.dir ?? "ltr";
  const components = componentLookup(systemFor(dsId).docs.patterns, opts.components);
  const nodes = componentNodes(inst, { dir, lang: dir === "rtl" ? "ar" : "en", ts: tokenSetFor(dsId), components }, opts.width ?? PREVIEW_W);
  await renderer.loadImages(imageSources(nodes));
  const top = nodes[0];
  const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [top.id] };
  // Badges and shadows can reach outside the component's box: frame everything that draws.
  const shadow = Math.max(0, ...nodes.flatMap((n) => (n.effects ?? []).filter((e) => e.kind === "drop").map((e) => e.blur + e.spread + Math.max(Math.abs(e.x), Math.abs(e.y)))));
  const u = selectionBounds(doc, Object.keys(doc.nodes))!;
  const pad = Math.ceil(shadow);
  const b = { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 };
  const frame = makeFrame({ name: "Preview", x: b.x, y: b.y, w: b.w, h: b.h, fill: null, clip: false, children: [top.id] }, tokenSetFor(dsId));
  top.parentId = frame.id;
  top.x -= b.x;
  top.y -= b.y;
  doc.nodes[frame.id] = frame;
  doc.roots = [frame.id];
  const scale = Math.min(2, (opts.width ? MAX_PX * 3 : MAX_PX) / Math.max(b.w, b.h, 1));
  const bytes = renderer.exportNode(doc, frame.id, scale);
  return bytes ? { bytes, w: b.w, h: b.h, nodes } : null;
}

async function render(inst: Inst, dsId: string, opts: PreviewOpts = {}): Promise<Result> {
  const r = await draw(inst, dsId, opts);
  return r ? { url: URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "image/png" })), w: r.w, h: r.h } : "error";
}

/** A component drawn at screen width as base64 PNG (for the AI), or null if it can't be built. */
export async function componentPNG(inst: Inst, dsId: string): Promise<string | null> {
  const r = await draw(inst, dsId, { width: 358 }).catch(() => null);
  return r ? toBase64(r.bytes) : null;
}

/**
 * A component drawn at a width: base64 PNG for the AI and its pixels for measuring (the Add
 * component check compares them with the screenshot), or why it couldn't be drawn.
 */
export async function componentDrawing(inst: Inst, dsId: string, width: number): Promise<{ base64: string; pixels: ImageData; cut: string[]; overflow: { name: string; by: number }[] } | { error: string }> {
  try {
    const r = await draw(inst, dsId, { width });
    if (!r) return { error: "The renderer returned nothing." };
    const bmp = await createImageBitmap(new Blob([r.bytes as BlobPart], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return { base64: toBase64(r.bytes), pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), cut: cutTexts(r.nodes), overflow: overflowing(r.nodes) };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
  }
}

/**
 * A whole screen drawn with a system that may not be saved yet: the PNG bytes, the nodes it was
 * built from (the brand interview compares them to show what a change did), and the scale.
 */
async function drawScreen(spec: ScreenSpec, ds: DesignSystem, maxSide: number): Promise<{ bytes: Uint8Array; nodes: SceneNode[]; scale: number } | null> {
  await Promise.all([ensureYoga(), ensureFonts([...new TokenSet(ds.tree).families(), ...ds.fonts.map((f) => f.googleFont ?? f.family)])]);
  const renderer = await exportRenderer();
  const nodes = buildScreenNodes(spec, ds.id, { x: 0, y: 0 }, "import", ds);
  await renderer.loadImages(imageSources(nodes));
  const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
  const scale = Math.min(2, maxSide / Math.max(nodes[0].w, nodes[0].h, 1));
  const bytes = renderer.exportNode(doc, nodes[0].id, scale);
  return bytes ? { bytes, nodes, scale } : null;
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** A screen drawn with a (maybe unsaved) system: an object URL, its logical size and its nodes. */
export async function screenRender(spec: ScreenSpec, ds: DesignSystem, maxSide = 900): Promise<{ url: string; w: number; h: number; nodes: SceneNode[] } | null> {
  const r = await drawScreen(spec, ds, maxSide);
  if (!r) return null;
  return { url: URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "image/png" })), w: r.nodes[0].w, h: r.nodes[0].h, nodes: r.nodes };
}

/** A whole screen drawn with a system that may not be saved yet (the extraction's fidelity check), as an object URL, or null if it can't be drawn. */
export async function screenPreview(spec: ScreenSpec, ds: DesignSystem, maxSide = 900): Promise<string | null> {
  return (await screenRender(spec, ds, maxSide))?.url ?? null;
}

/** A whole screen drawn with a (maybe unsaved) system as base64 PNG, for the AI, with its logical size. */
export async function screenPNG(spec: ScreenSpec, ds: DesignSystem, maxSide = 1200): Promise<{ data: string; w: number; h: number } | null> {
  const r = await drawScreen(spec, ds, maxSide);
  return r ? { data: toBase64(r.bytes), w: r.nodes[0].w, h: r.nodes[0].h } : null;
}

function preview(id: string, inst: Inst, dsId: string, opts?: PreviewOpts): Promise<Result> {
  const c = cacheFor(dsId);
  const hit = c.urls.get(id) ?? c.pending.get(id);
  if (hit) return Promise.resolve(hit);
  // One at a time, yielding between renders so a full panel doesn't block input.
  const p = (queue = queue
    .then(() => new Promise((r) => setTimeout(r, 0)))
    .then(() => render(inst, dsId, opts))
    .catch(() => "error" as const)) as Promise<Result>;
  c.pending.set(id, p);
  void p.then((r) => {
    if (cache !== c) {
      if (r !== "error") URL.revokeObjectURL(r.url);
      return;
    }
    c.pending.delete(id);
    c.urls.set(id, r);
  });
  return p;
}

/** Thumbnail for a component in a design system: null while rendering, "error" if it can't be built. */
export function useComponentPreview(id: string, inst: Inst, dsId: string, opts?: PreviewOpts): Result | null {
  const version = systemFor(dsId).updatedAt;
  const [state, setState] = useState<{ key: string; preview: Result | null }>({ key: "", preview: null });
  const key = `${dsId}@${version}/${id}`;
  useEffect(() => {
    let live = true;
    void preview(id, inst, dsId, opts).then((r) => live && setState({ key, preview: r }));
    return () => {
      live = false;
    };
    // `inst` and `opts` are part of `id` (catalog data, or the library's props): stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key === key) return state.preview;
  return cache.key === `${dsId}@${version}` ? (cache.urls.get(id) ?? null) : null;
}
