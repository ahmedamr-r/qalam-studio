import { currentKnowledgeGraph } from "./knowledge/useKnowledgeGraph";
import { useKnowledge } from "@/knowledge/store";
import { layoutDb } from "@/knowledge/db";
import { generateKnowledge } from "./knowledge/record";
import { feedback } from "@/commands/feedback";
import type { ScreenSpec } from "@/design-system/builders";
import { systemFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { insertScreens, nextSlot, SCREEN_GAP } from "@/design-system/place";
import { putAsset } from "@/doc/assets";
import { makeFrame, makeIcon, makeImage, makeShape, makeText } from "@/doc/factory";
import { descendants, worldBounds } from "@/doc/geometry";
import { fitText, insertNodes } from "@/doc/ops";
import { type AutoLayout, type SceneNode, type Sizing, type TextProps, uniformRadius } from "@/doc/schema";
import { studio } from "@/doc/store";
import { screenPNG } from "./componentPreviews";
import { cutCrops } from "./ai/crops";
import { getController } from "./CanvasView";
import { send, useChats } from "./ai/chats";
import { directionTargets, nextDir, type DirectionMode } from "./ai/direction";
import { exportRenderer, nodeToDataURL } from "./exporter";
import { loadDemo, loadRouteFixture } from "./demo";

/**
 * A layer of a board in a dev import (walkthrough sections, notes): plain colours and sizes, and
 * Figma-style auto layout on frames, so text wraps and stacks without measuring it up front.
 */
export interface BoardLayer {
  type: "frame" | "rect" | "ellipse" | "text" | "icon";
  name?: string;
  /** Boards: position from the import's top-left corner. Ignored inside auto layout. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** #RRGGBB or #RRGGBBAA; text and icons take their colour from it. */
  fill?: string;
  radius?: number;
  stroke?: { color: string; width: number };
  /** Locked boards are a backdrop: clicks, drags and drops go to what's on top of them. */
  locked?: boolean;
  sizeH?: Sizing;
  sizeV?: Sizing;
  grow?: number;
  /** Frames: auto layout. Padding is a number or [top, end, bottom, start]. */
  layout?: { direction: AutoLayout["direction"]; gap?: number; padding?: number | [number, number, number, number]; justify?: AutoLayout["justify"]; align?: AutoLayout["align"] };
  children?: BoardLayer[];
  content?: string;
  size?: number;
  weight?: number;
  lineHeight?: number;
  tracking?: number;
  align?: TextProps["align"];
  /** Icons: a Lucide name. */
  icon?: string;
  strokeWidth?: number;
}

function boardLayers(b: BoardLayer, parentId: string | null, out: SceneNode[]): string {
  const paint = (color?: string) => (color ? { color } : null);
  const p = {
    ...(b.name ? { name: b.name } : {}),
    x: b.x ?? 0,
    y: b.y ?? 0,
    locked: !!b.locked,
    ...(b.sizeH ? { sizeH: b.sizeH } : {}),
    ...(b.sizeV ? { sizeV: b.sizeV } : {}),
    ...(b.grow ? { grow: b.grow } : {}),
    meta: { source: "import" as const },
  };
  let n: SceneNode;
  if (b.type === "text") {
    const size = b.size ?? 16;
    const t = makeText({
      ...p,
      w: b.w ?? 40,
      fill: paint(b.fill ?? "#1C1C1C"),
      text: {
        content: b.content ?? "",
        fontSize: size,
        fontWeight: b.weight ?? 400,
        lineHeight: b.lineHeight ?? Math.round(size * 1.4),
        letterSpacing: b.tracking ?? 0,
        align: b.align ?? "start",
        autoSize: b.w || b.sizeH === "fill" ? "height" : "width",
        typeToken: undefined,
      },
    });
    fitText(t);
    n = t;
  } else if (b.type === "icon") {
    n = makeIcon(b.icon ?? "circle", { ...p, w: b.w ?? 24, h: b.w ?? 24, fill: paint(b.fill ?? "#1C1C1C"), strokeWidth: b.strokeWidth ?? 2 });
  } else if (b.type === "frame") {
    const l = b.layout;
    const pad = typeof l?.padding === "number" ? [l.padding, l.padding, l.padding, l.padding] : (l?.padding ?? [0, 0, 0, 0]);
    const layout: AutoLayout | undefined = l && {
      direction: l.direction,
      wrap: false,
      gap: l.gap ?? 0,
      crossGap: 0,
      padding: { top: pad[0], end: pad[1], bottom: pad[2], start: pad[3] },
      justify: l.justify ?? "start",
      align: l.align ?? "start",
    };
    n = makeFrame({ ...p, w: b.w ?? 100, h: b.h ?? 100, fill: paint(b.fill), stroke: b.stroke ?? null, radius: uniformRadius(b.radius ?? 0), clip: false, ...(layout ? { layout } : {}) });
  } else {
    n = makeShape(b.type, { ...p, w: b.w ?? 100, h: b.h ?? 100, fill: paint(b.fill), stroke: b.stroke ?? null, radius: b.type === "rect" ? uniformRadius(b.radius ?? 0) : null });
  }
  n.parentId = parentId;
  out.push(n);
  n.children = (b.children ?? []).map((c) => boardLayers(c, n.id, out));
  return n.id;
}

/**
 * Development only, for the console or a test harness (window.__qalamDev):
 * - renderSpec: a screen spec as a PNG, with crops cut from a source screenshot at a URL;
 * - nodePNG: a layer as a PNG (base64), its pictures loaded, drawn off screen (works with the page hidden);
 * - insertRebuilds: rebuilt screenshots onto the canvas, each screenshot with its rebuild beside it;
 * - insertBoards: boards (BoardLayer trees) to the left of everything, under the other frames;
 * - direction: run the Direction tool on frames as the chat does (switch or mirror, copy translated);
 * - loadDemo: the demo screens, as the main menu loads them;
 * - loadRouteFixture: a route fixture (ride, bank, dashboard, shop, grocery, orders), prototyped, on the canvas;
 * - knowledge: the Knowledge hub's graph (stats, graph), decision traces and saved positions.
 */
export function installDevHooks() {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const sourceBlob = async (url: string) => (await fetch(url)).blob();
  const hooks = {
    loadDemo,
    loadRouteFixture,

    async renderSpec(spec: ScreenSpec, opts: { dsId?: string; source?: string; scale?: number; maxSide?: number } = {}): Promise<string | null> {
      let s = spec;
      if (opts.source) s = await cutCrops(spec, await sourceBlob(opts.source), { x: opts.scale ?? 1, y: opts.scale ?? 1 });
      const r = await screenPNG(s, systemFor(opts.dsId ?? "builtin"), opts.maxSide ?? 2000);
      return r?.data ?? null;
    },

    async insertRebuilds(items: { spec: ScreenSpec; source?: string; scale?: number; name?: string }[], dsId = "builtin"): Promise<string[]> {
      const ids: string[] = [];
      // Screens without a screenshot go in a row of their own.
      const plain = items.filter((it) => !it.source).map((it) => ({ ...it.spec, name: it.name ?? it.spec.name }));
      if (plain.length) ids.push(...(await insertScreens(plain, "import", dsId)));
      for (const it of items) {
        if (!it.source) continue;
        const blob = await sourceBlob(it.source);
        const spec = await cutCrops(it.spec, blob, { x: it.scale ?? 1, y: it.scale ?? 1 });
        const name = it.name ?? spec.name;
        const bmp = await createImageBitmap(blob);
        const w = 390;
        const h = Math.round((bmp.height * w) / bmp.width);
        bmp.close();
        const at = nextSlot();
        insertNodes([makeImage(await putAsset(blob), { name: `${name} · screenshot`, x: at.x, y: at.y, w, h, meta: { source: "import" } })], null, undefined, false);
        const [id] = await insertScreens([{ ...spec, name }], "import", dsId, { x: at.x + w + SCREEN_GAP, y: at.y });
        ids.push(id);
      }
      return ids;
    },

    async direction(ids: string[], opts: { mode?: DirectionMode; translate?: boolean } = {}) {
      const targets = directionTargets(studio().doc, ids);
      const frames = targets.map((f) => ({ id: f.id, name: f.name }));
      const { chatId, turnId } = await send({ tool: "direction", text: "Switch direction", frames, direction: { mode: opts.mode ?? "switch", to: nextDir(targets), translate: opts.translate ?? true } });
      return useChats.getState().chats.find((c) => c.id === chatId)?.turns.find((t) => t.id === turnId);
    },

    async nodePNG(id: string, scale = 1): Promise<string | null> {
      const { doc } = studio();
      const srcs = [id, ...descendants(doc, id)].flatMap((k) => (doc.nodes[k]?.type === "image" ? [(doc.nodes[k] as { src: string }).src] : []));
      await (await exportRenderer()).loadImages(srcs);
      return nodeToDataURL(id, scale)?.split(",")[1] ?? null;
    },

    insertBoards(boards: BoardLayer[]): string[] {
      if (!boards.length) return [];
      const { doc } = studio();
      const boxes = doc.roots.map((id) => worldBounds(doc, id));
      const width = Math.max(...boards.map((b) => (b.x ?? 0) + (b.w ?? 0)));
      const at = { x: boxes.length ? Math.min(...boxes.map((b) => b.x)) - width - 400 : 0, y: boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0 };
      const out: SceneNode[] = [];
      const ids = boards.map((b) => boardLayers({ ...b, x: Math.round(at.x + (b.x ?? 0)), y: Math.round(at.y + (b.y ?? 0)) }, null, out));
      insertNodes(out, null, 0, false);
      return ids;
    },
  };
  // The Knowledge hub: its graph as the stores hold it now, the decision traces, and saved positions.
  const knowledge = {
    stats() {
      const g = currentKnowledgeGraph({ window: Infinity });
      const by = (k: (n: (typeof g.nodes)[number]) => string) => g.nodes.reduce<Record<string, number>>((m, n) => ((m[k(n)] = (m[k(n)] ?? 0) + 1), m), {});
      return { nodes: g.nodes.length, edges: g.edges.length, groups: by((n) => n.group), statuses: by((n) => n.status) };
    },
    graph: (opts?: { asOf?: number; window?: number }) => currentKnowledgeGraph(opts),
    traces: () => useKnowledge.getState().traces,
    /** What a Generate request about these screens would send of the project's knowledge now. */
    request(screenIds: string[] = []) {
      const doc = studio().doc;
      const k = generateKnowledge(systemFor(useSystems.getState().activeId), doc, screenIds);
      return { knowledge: k.designSystem?.knowledge ?? null, brief: k.brief ?? "", given: k.entries.map((e) => `${e.short} ${e.ref}`) };
    },
    async positions() {
      const id = useKnowledge.getState().projectId;
      return id ? ((await layoutDb.get(id))?.positions ?? null) : null;
    },
  };
  (window as unknown as { __qalamDev: unknown }).__qalamDev = { ...hooks, knowledge };

  // ?devImport=<name> (a file in .qalam-dev/, served by /api/dev-import) or ?devImport=<manifest url>:
  // add boards and rebuilt screens to this browser's document (each browser keeps its own). Frames
  // already on the canvas under the same name are skipped, so a reload is safe.
  const manifest = new URLSearchParams(location.search).get("devImport");
  if (manifest) {
    history.replaceState(null, "", location.pathname);
    const url = /^[\w.-]+$/.test(manifest) ? `/api/dev-import?name=${manifest}` : manifest;
    void (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const { items = [], boards = [], systems = [], dsId } = (await res.json()) as {
        items?: { spec: ScreenSpec; source?: string; scale?: number; name?: string }[];
        boards?: BoardLayer[];
        /** Design systems the screens are built with, added when this browser doesn't have them. */
        systems?: DesignSystem[];
        /** The system to build the screens with (the built-in one when omitted). */
        dsId?: string;
      };
      const known = new Set(useSystems.getState().systems.map((s) => s.id));
      for (const s of systems) if (s?.id && s.tree && !known.has(s.id)) useSystems.getState().add(s, false);
      const { doc } = studio();
      const have = new Set(doc.roots.map((id) => doc.nodes[id]?.name));
      const added = [...hooks.insertBoards(boards.filter((b) => !have.has(b.name ?? ""))), ...(await hooks.insertRebuilds(items.filter((it) => !have.has(it.name ?? it.spec.name)), dsId))];
      console.info(`devImport: added ${added.length} of ${boards.length + items.length}`);
      if (added.length) getController()?.zoomToFit(added, true);
    })().catch((e: unknown) => {
      console.error("devImport failed", e);
      feedback(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { kind: "error" });
    });
  }
}
