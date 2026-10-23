/**
 * Editing a screen's route (the Prototype tab, the demo, Qalam AI's builds): adding the parts it
 * opens or shows — each a frame of its own, built with the screen's design system and placed under
 * the screen — and the rules that open and close them. Every op is one undo step.
 */
import { studio } from "@/doc/store";
import { insertNodes } from "@/doc/ops";
import { worldBounds, boxesIntersect, type Box } from "@/doc/geometry";
import type { Doc, OverlayDef, OverlayKind, Prototype, RouteProto, RouteRef, RouteRule } from "@/doc/schema";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes, ensureSystemFonts } from "@/design-system/place";
import { ensureYoga } from "@/engine/layout";
import { SURFACE_LABEL, type Surface } from "@/design-system/surfaces";
import { DEFAULT_DISMISS, TOAST_MS, emptyRoute, isUnusedRoute, newPartId, newRuleId, partFrames } from "./routes";
import { emptyProto } from "@/doc/proto";

/** Room between a screen and the parts under it (the wires run there), and between parts. */
export const PART_DROP = 120;
export const PART_GAP = 48;

/** Where a new part of `owner` goes: under the screen, after its other parts, clear of anything else. */
export function partSlot(doc: Doc, owner: string, size: { w: number; h: number }): { x: number; y: number } {
  const o = worldBounds(doc, owner);
  const parts = partFrames(doc, owner).map((p) => worldBounds(doc, p.frame));
  let x = parts.length ? Math.max(...parts.map((b) => b.x + b.w)) + PART_GAP : o.x;
  let y = o.y + o.h + PART_DROP;
  const mine = new Set([owner, ...partFrames(doc, owner).map((p) => p.frame)]);
  const others = doc.roots.filter((id) => !mine.has(id) && doc.nodes[id]).map((id) => worldBounds(doc, id));
  for (let guard = 0; guard < 100; guard++) {
    const box: Box = { x, y, w: size.w, h: size.h };
    const hit = others.find((b) => boxesIntersect(box, b));
    if (!hit) break;
    y = hit.y + hit.h + PART_GAP;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

type ScreenSpecLike = Pick<ScreenSpec, "platform" | "dir" | "lang">;

/** A starting point for a part the designer adds by hand: the kind's usual shape, to edit or ask Qalam AI about. */
export function starterSpec(kind: Surface, owner?: ScreenSpecLike): ScreenSpec {
  const base = { platform: owner?.platform, dir: owner?.dir, lang: owner?.lang, surface: kind };
  const t = (text: string, style = "body", tone = "primary"): Inst => ({ component: "Text", props: { text, style, tone } });
  switch (kind) {
    case "sheet":
      return {
        ...base,
        name: "Options",
        header: [{ component: "TopBar", props: { title: "Options", leading: "close" } }],
        body: [
          { component: "ListItem", props: { title: "First option", trailing: "checkbox", checked: true } },
          { component: "ListItem", props: { title: "Second option", trailing: "checkbox", checked: false } },
        ],
        footer: [{ component: "Button", props: { label: "Done", variant: "primary", fullWidth: true } }],
      };
    case "dialog":
      return {
        ...base,
        name: "Confirm",
        header: [t("Are you sure?", "title")],
        body: [t("Say what happens next, and whether it can be undone.", "body", "secondary")],
        footer: [
          { component: "Button", props: { label: "Confirm", variant: "primary", fullWidth: true } },
          { component: "Button", props: { label: "Cancel", variant: "tertiary", fullWidth: true } },
        ],
      };
    case "toast":
      return { ...base, name: "Done", body: [t("Done", "body-strong")] };
    case "menu":
      return {
        ...base,
        name: "Actions",
        body: [
          { component: "ListItem", props: { title: "Edit", leadingIcon: "pencil" } },
          { component: "ListItem", props: { title: "Share", leadingIcon: "share-2" } },
          { component: "ListItem", props: { title: "Delete", leadingIcon: "trash-2" } },
        ],
      };
    case "bar":
      return { ...base, name: "Bar", body: [{ component: "Button", props: { label: "Continue", variant: "primary", fullWidth: true } }] };
  }
}

/** Apply a change to the prototype as one undo step; a route left with nothing in it is dropped. */
export function editRoutes(fn: (p: Prototype) => Prototype) {
  studio().mutate((d) => {
    const next = fn(d.proto ?? emptyProto());
    for (const [screen, r] of Object.entries(next.routes ?? {})) if (isUnusedRoute(r)) delete next.routes![screen];
    if (next.routes && !Object.keys(next.routes).length) delete next.routes;
    d.proto = next;
  });
}

/** The prototype with one route changed (created when missing). */
export const withRoute = (p: Prototype, screen: string, fn: (r: RouteProto) => RouteProto): Prototype => ({
  ...p,
  routes: { ...p.routes, [screen]: fn(p.routes?.[screen] ?? emptyRoute()) },
});

/**
 * Add a part to a screen's route: build its frame with the screen's design system, place it under
 * the screen and register it, in one undo step. Returns its part id (and the frame's id).
 */
export async function addPart(owner: string, kind: Surface, spec?: ScreenSpec, extra: Partial<OverlayDef> = {}, id?: string): Promise<{ part: string; frame: string } | null> {
  const { doc } = studio();
  const root = doc.nodes[owner];
  if (!root || root.type !== "frame" || root.parentId) return null;
  const dsId = root.meta.designSystem ?? "builtin";
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const ownerSpec = root.meta.spec as ScreenSpecLike | undefined;
  const full: ScreenSpec = { ...(spec ?? starterSpec(kind, ownerSpec)), surface: kind };
  full.platform ??= ownerSpec?.platform;
  full.dir ??= ownerSpec?.dir ?? (root.dir === "rtl" ? "rtl" : undefined);
  full.lang ??= ownerSpec?.lang;
  // Built once to know its size, then again where it goes.
  const probe = buildScreenNodes(full, dsId, { x: 0, y: 0 }, "user");
  const at = partSlot(studio().doc, owner, { w: probe[0].w, h: probe[0].h });
  const nodes = buildScreenNodes(full, dsId, at, "user");
  const frame = nodes[0].id;
  // Its id: the one asked for (what a recipe's steps call it) when it's free, else one from its name.
  const route = studio().doc.proto?.routes?.[owner];
  const part = id && /^[a-z][a-z0-9-]{0,23}$/.test(id) && !route?.overlays[id] && !route?.addOns[id] ? id : newPartId(route, full.name || SURFACE_LABEL[kind]);
  studio().beginTx();
  insertNodes(nodes, null, undefined, false);
  editRoutes((p) =>
    withRoute(p, owner, (r) =>
      kind === "bar"
        ? { ...r, addOns: { ...r.addOns, [part]: { frame, region: "bottom" } } }
        : { ...r, overlays: { ...r.overlays, [part]: { frame, kind: kind as OverlayKind, dismiss: DEFAULT_DISMISS[kind as OverlayKind], ...(kind === "toast" ? { ms: TOAST_MS } : {}), ...extra } } },
    ),
  );
  studio().commitTx();
  return { part, frame };
}

/** Add a rule to a route; returns its id. */
export function addRule(owner: string, rule: Omit<RouteRule, "id">): string {
  let id = "";
  editRoutes((p) =>
    withRoute(p, owner, (r) => {
      id = newRuleId(r);
      return { ...r, rules: [...r.rules, { ...rule, id }] };
    }),
  );
  return id;
}

export function removeRule(owner: string, id: string) {
  editRoutes((p) => withRoute(p, owner, (r) => ({ ...r, rules: r.rules.filter((x) => x.id !== id) })));
}

/** "Tap this → open that part" (the commonest rule). */
export const openOnTap = (owner: string, ref: RouteRef, part: string) => addRule(owner, { when: { on: "tap", ref }, then: [{ do: "open", part }] });

/** Change how an overlay behaves (how it closes, a sheet's height, a toast's time). */
export function setOverlay(owner: string, part: string, patch: Partial<Omit<OverlayDef, "frame" | "kind">>) {
  editRoutes((p) =>
    withRoute(p, owner, (r) => {
      const o = r.overlays[part];
      return o ? { ...r, overlays: { ...r.overlays, [part]: { ...o, ...patch } } } : r;
    }),
  );
}

/** Remove a part: its frame goes, and the doc pass drops the rules that pointed at it (same step). */
export function removePart(owner: string, part: string) {
  const r = studio().doc.proto?.routes?.[owner];
  const frame = r?.overlays[part]?.frame ?? r?.addOns[part]?.frame;
  if (!frame) return;
  studio().mutate((d) => {
    const drop = (id: string) => {
      for (const c of d.nodes[id]?.children ?? []) drop(c);
      delete d.nodes[id];
    };
    drop(frame);
    d.roots = d.roots.filter((id) => id !== frame);
  });
}

/** Rules in a route that start from a ref (same frame and path). */
export const rulesFrom = (r: RouteProto | undefined, ref: RouteRef): RouteRule[] =>
  (r?.rules ?? []).filter((x) => "ref" in x.when && (x.when.ref.part ?? "") === (ref.part ?? "") && (x.when.ref.path ?? "") === (ref.path ?? ""));
