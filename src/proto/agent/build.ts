/**
 * Building picked steps (pure): each candidate the designer picked becomes part of the route, in
 * a copy of the document — its part added under the screen when it needs one (what the model
 * wrote, else what code writes), its recipe applied, its step named in the words the designer
 * saw — and is kept only if the route still passes its checks: no lint errors, it compiles
 * cleanly, and every tap in its walkthrough does something. A step that doesn't pass is left out
 * with why, so the next can still be built. The studio commits the result in one undo step.
 */
import type { ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes } from "@/design-system/place";
import { dsIdForNode } from "@/design-system/registry";
import type { Doc, RouteProto, RouteRef, VarDef } from "@/doc/schema";
import { compilePrototype, type CompileOptions } from "@/codegen/compile";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { DEFAULT_DISMISS, TOAST_MS, actionWords, newPageId, newPartId, pageName, routeOf } from "../routes";
import { partSlot } from "../edit";
import { lintRoute } from "../lint";
import { applyDelta, chooseOne, collectionBar, configureAndAdd, confirmFirst, fromList, headerOnScroll, nextPage, stickySections, tabPanels, toastAfter, type RouteDelta } from "../recipes";
import { scanFrame, type FrameScan } from "../scan";
import { walkthrough, type Machine } from "../walk";
import type { Candidate, PartRole } from "./candidates";
import { blockDelta, blockIssues, partBasics } from "./blocks";
import { layerIndex, type LayerEntry } from "./layers";
import type { PlayAction } from "@/doc/schema";
import { findMoney, sameCurrency } from "../money";
import { partFor } from "./parts";

export interface Picked {
  candidate: Candidate;
  /** The step's name as the designer saw it (the model's words), when not the recipe's own. */
  label?: string;
  /** What its new part says (the model's), when it needs one. */
  part?: ScreenSpec;
}

export interface Built {
  id: string;
  ok: boolean;
  /** Why it was left out. */
  issues: string[];
  /** Whose words the part has: the model's, or code's when the model's didn't pass or wasn't asked. */
  wrote?: "model" | "code";
  /** Why the model's part wasn't kept (code's stood in), for it to fix. */
  rejected?: string[];
}

/** Ids parts get by what they're for. */
const PART_NAME = { options: "options", collection: "basket", confirm: "confirm", done: "done", custom: "part" } as const;

/** The document with a part added under the screen, and its id (from what it's for: "options", "confirm"). */
function withPart(doc: Doc, screen: string, spec: ScreenSpec, idBase: string): { doc: Doc; part: string; frame: string } | null {
  const kind = spec.surface;
  if (!kind) return null;
  const dsId = dsIdForNode(doc, screen);
  const probe = buildScreenNodes(spec, dsId, { x: 0, y: 0 }, "ai");
  const nodes = buildScreenNodes(spec, dsId, partSlot(doc, screen, { w: probe[0].w, h: probe[0].h }), "ai");
  const route: RouteProto = routeOf(doc, screen) ?? { overlays: {}, addOns: {}, rules: [] };
  const part = newPartId(route, idBase);
  const frame = nodes[0].id;
  const next: RouteProto =
    kind === "bar"
      ? { ...route, addOns: { ...route.addOns, [part]: { frame, region: "bottom" } } }
      : { ...route, overlays: { ...route.overlays, [part]: { frame, kind, dismiss: [...DEFAULT_DISMISS[kind]], ...(kind === "toast" ? { ms: TOAST_MS } : {}) } } };
  const out: Doc = { ...doc, nodes: { ...doc.nodes }, roots: [...doc.roots, frame] };
  for (const n of nodes) out.nodes[n.id] = n;
  out.proto = { links: [], states: {}, tracks: [], ...doc.proto, routes: { ...doc.proto?.routes, [screen]: next } };
  return { doc: out, part, frame };
}

/** The money the screen writes (its first amount), to hold a part's money to. */
function screenMoney(scan: FrameScan) {
  for (const t of scan.texts) {
    const m = findMoney(t.text);
    if (m) return m.format;
  }
  for (const a of scan.actions) {
    const m = findMoney(a.label);
    if (m) return m.format;
  }
  return null;
}

/**
 * What's wrong with a part for what it's for: an options sheet needs a main action that shows the
 * price (when the screen has prices); a bar, a button with the total; a dialog, a way to go ahead
 * and one to back out; a toast, something to say. Money is written the way the screen writes it.
 */
export function partIssues(role: PartRole, part: FrameScan, screen: FrameScan): string[] {
  const money = screenMoney(screen);
  const out: string[] = [];
  const shows = (label: string | undefined) => {
    const m = label ? findMoney(label) : null;
    if (!m) return false;
    if (money && (!sameCurrency(m.format, money) || m.format.digits !== money.digits)) out.push(`It writes money as "${m.text}", not the way the screen does.`);
    return true;
  };
  switch (role) {
    case "options":
      if (!part.primary) out.push("The sheet has no main action to add with.");
      else if (!shows(part.primary.label) && money) out.push(`Its "${part.primary.label}" doesn't show the price.`);
      break;
    case "collection":
      if (!part.primary) out.push("The bar has no button.");
      else if (!shows(part.primary.label) && money) out.push(`Its "${part.primary.label}" doesn't show the total.`);
      break;
    case "confirm":
      if (!part.primary) out.push("The dialog has no button to go ahead.");
      if (!part.secondary) out.push("The dialog has no button to back out.");
      for (const t of part.texts) shows(t.text);
      break;
    case "done":
      if (!part.texts.some((t) => t.text.trim())) out.push("The toast says nothing.");
      for (const t of part.texts) shows(t.text);
      break;
    case "custom":
      // What the designer asked it to hold can be anything the catalog has; an empty part never gets this far.
      break;
  }
  return out;
}

/** A var name the route doesn't use yet ("choice", "choice2"…). */
const freeVar = (route: RouteProto, base: string) => {
  let name = base;
  for (let i = 2; route.vars?.[name]; i++) name = `${base}${i}`;
  return name;
};

/** What a candidate's recipe adds, over the screen and its part. */
/**
 * Where a screen's way on is tapped: the bar's button, or the main action — or its dialog's
 * confirm, once it asks first. `scanOf` reads one of the route's parts.
 */
function wayOn(c: Candidate, route: RouteProto, scan: FrameScan, scanOf: (part: string) => FrameScan | null): { ref: RouteRef; label: string } | null {
  if (c.opts?.from === "bar") {
    for (const id of Object.keys(route.addOns)) {
      const s = scanOf(id);
      if (s?.primary) return { ref: { part: id, path: s.primary.path }, label: s.primary.label };
    }
    return null;
  }
  const act = scan.actions.find((a) => a.path === (c.opts?.action ?? c.at.path));
  if (!act) return null;
  const opens = route.rules.find((ru) => "ref" in ru.when && !ru.when.ref.part && ru.when.ref.path === act.path)?.then.find((a) => a.do === "open");
  const dialog = opens?.do === "open" && route.overlays[opens.part]?.kind === "dialog" ? opens.part : undefined;
  const confirm = dialog ? scanOf(dialog)?.primary : undefined;
  return dialog && confirm ? { ref: { part: dialog, path: confirm.path }, label: act.label } : { ref: { path: act.path }, label: act.label };
}

function deltaFor(c: Candidate, route: RouteProto, scan: FrameScan, part: { id: string; scan: FrameScan } | null, confirms: Map<string, RouteRef>, layers: Map<string, LayerEntry>, scanOf: (part: string) => FrameScan | null = () => null): RouteDelta {
  switch (c.recipe) {
    case "blocks": {
      // The ask's blocks, one after another, as one step.
      const blocks = c.blocks ?? [];
      const wrong = blocks.flatMap((b) => blockIssues(b, layers));
      if (!blocks.length || wrong.length) return { skipped: wrong[0] ?? "Nothing to build" };
      let r = route;
      const out: RouteDelta = { vars: {}, items: {}, rules: [], bindings: [], swaps: [] };
      const play: PlayAction[] = [];
      const add = (d: RouteDelta) => {
        r = applyDelta(r, d);
        Object.assign(out.vars!, d.vars);
        Object.assign(out.items!, d.items);
        out.rules!.push(...(d.rules ?? []));
        out.bindings!.push(...(d.bindings ?? []));
        out.swaps!.push(...(d.swaps ?? []));
      };
      for (const b of blocks) {
        const one = blockDelta(b, r, layers, scan, b.kind === "open-part" || b.kind === "toast" ? part?.id : undefined);
        if (one.delta.skipped) return one.delta;
        add(one.delta);
        // A part opened for the ask works on its own: its picks, and buttons that close it.
        if (b.kind === "open-part" && part) add(partBasics(part.scan, part.id, r));
        play.push(...one.play);
      }
      return { ...out, step: { recipe: "blocks", label: c.what, at: c.at, play } };
    }
    case "headerOnScroll":
      return headerOnScroll(scan);
    case "stickySections":
      return stickySections(scan);
    case "tabPanels":
      return tabPanels(scan, { at: c.at.path });
    case "chooseOne":
      return chooseOne(scan, { at: c.opts?.at, name: freeVar(route, "choice") });
    case "configureAndAdd":
      return part ? configureAndAdd(scan, part.scan, { part: part.id }) : { skipped: "No sheet to configure the item in" };
    case "collectionBar":
      return part ? collectionBar(scan, part.scan, { part: part.id }) : { skipped: "No bar to show the basket in" };
    case "confirmFirst":
      return part ? confirmFirst(route, scan, part.scan, { part: part.id, action: c.opts?.action }) : { skipped: "No dialog to ask in" };
    case "toastAfter": {
      if (!part) return { skipped: "No toast to show" };
      // After its confirm, when that's built: the confirm button; else the action itself.
      const at = (c.after && confirms.get(c.after)) || { path: c.opts?.action ?? c.at.path ?? "" };
      return toastAfter(route, at, { part: part.id });
    }
    case "fromList":
      return c.opts?.list ? fromList(scan, { list: c.opts.list, label: c.opts.label }) : { skipped: "No list to show" };
    case "nextPage": {
      const way = wayOn(c, route, scan, scanOf);
      if (!way) return { skipped: "Nothing leads on from here yet" };
      const name = c.opts?.name?.trim() || pageName(way.label) || "Next page";
      const words = actionWords(way.label);
      return nextPage(way.ref, { id: newPageId(route, name), name, brief: c.opts?.brief?.trim() || `What "${words}" opens` }, { action: words });
    }
  }
}

/** Does the document's route still pass: lint, a clean compile, a walkthrough where every tap does something? */
export function check(doc: Doc, screen: string, opts: Pick<CompileOptions, "typography"> = {}): string[] {
  const issues = lintRoute(doc, screen)
    .filter((x) => x.severity === "error")
    .map((x) => x.message);
  try {
    const r = compilePrototype(doc, { ...opts, screens: [screen] });
    issues.push(...r.warnings.filter((w) => !/assets/.test(w)));
    const key = r.screens.find((s) => s.id === screen)?.key;
    if (key && doc.proto?.routes?.[screen]?.steps?.length) {
      const mod = evaluate(transpile(r.code)) as unknown as Machine;
      for (const d of walkthrough(mod, doc, screen, key, { max: 2000 }).dead) issues.push(`A step's walkthrough taps ${d.ref.path ?? d.ref.part ?? "something"} and nothing happens.`);
    }
  } catch (e) {
    issues.push(`It doesn't compile: ${e instanceof Error ? e.message : String(e)}`);
  }
  return issues;
}

/**
 * Builds the picked steps in order into a copy of `doc`: each kept only if the route still
 * passes. Returns the document with what was kept, the app's values the recipes added, and what
 * happened to each step.
 */
export function buildSteps(doc: Doc, screen: string, picked: Picked[], opts: Pick<CompileOptions, "typography"> = {}): { doc: Doc; appVars: Record<string, VarDef>; results: Built[] } {
  let cur = doc;
  const appVars: Record<string, VarDef> = {};
  const results: Built[] = [];
  // Parts built here, by candidate id (a bar's after its configure; a toast's after its confirm).
  const confirms = new Map<string, RouteRef>();
  const before = new Set(check(doc, screen, opts));
  // The layers asks point at, by id (the screen's own: building steps doesn't change them).
  const layers = new Map(layerIndex(doc, screen).map((l) => [l.id, l]));
  // A page an action leads to is built before the confirm that action asks first with, which takes it on to its dialog's button.
  const order = [...picked];
  for (const p of picked) {
    if (p.candidate.recipe !== "nextPage" || p.candidate.opts?.from !== "main") continue;
    const i = order.indexOf(p);
    const j = order.findIndex((q) => q.candidate.recipe === "confirmFirst" && q.candidate.opts?.action === p.candidate.opts?.action);
    if (j >= 0 && j < i) order.splice(j, 0, ...order.splice(i, 1));
  }
  for (const p of order) {
    const c = p.candidate;
    const tryWith = (spec: ScreenSpec | null | undefined): { doc: Doc; issues: string[]; delta?: RouteDelta; part?: { id: string; scan: FrameScan } } => {
      let next = cur;
      let part: { id: string; scan: FrameScan } | null = null;
      if (c.part) part = { id: c.part, scan: scanFrame(next, routeOf(next, screen)?.overlays[c.part]?.frame ?? routeOf(next, screen)?.addOns[c.part]?.frame ?? "") };
      else if (c.needs) {
        if (!spec) return { doc: cur, issues: [`Nothing to put in its ${c.needs.kind}`] };
        const added = withPart(next, screen, { ...spec, surface: c.needs.kind, name: spec.name || PART_NAME[c.needs.role] }, PART_NAME[c.needs.role]);
        if (!added) return { doc: cur, issues: [`Its ${c.needs.kind} couldn't be built`] };
        next = added.doc;
        part = { id: added.part, scan: scanFrame(next, added.frame) };
        // A part that wouldn't do its job (no price on Add, no way to back out) isn't kept.
        const wrong = partIssues(c.needs.role, part.scan, scanFrame(next, screen));
        if (wrong.length) return { doc: cur, issues: wrong };
      }
      const route = routeOf(next, screen) ?? { overlays: {}, addOns: {}, rules: [] };
      const scanOf = (id: string) => {
        const frame = route.overlays[id]?.frame ?? route.addOns[id]?.frame;
        return frame && next.nodes[frame] ? scanFrame(next, frame) : null;
      };
      const delta = deltaFor(c, route, scanFrame(next, screen), part, confirms, layers, scanOf);
      if (delta.skipped) return { doc: cur, issues: [delta.skipped] };
      const step = delta.step ? { ...delta.step, label: p.label?.trim() || delta.step.label } : undefined;
      const applied = applyDelta(route, { ...delta, step });
      next = { ...next, proto: { links: [], states: {}, tracks: [], ...next.proto, routes: { ...next.proto?.routes, [screen]: applied }, vars: { ...next.proto?.vars, ...delta.appVars } } };
      // Only what this step brought: problems the route had before aren't its.
      const issues = check(next, screen, opts).filter((x) => !before.has(x));
      return { doc: next, issues, delta, part: part ?? undefined };
    };
    let wrote: "model" | "code" | undefined = c.needs ? (p.part ? "model" : "code") : undefined;
    let attempt = tryWith(p.part ?? (c.needs ? partFor(cur, screen, scanFrame(cur, screen), c) : null));
    let rejected: string[] | undefined;
    // What the model wrote didn't pass: code's own words, which keep it simple.
    if (attempt.issues.length && c.needs && p.part) {
      rejected = attempt.issues;
      const plain = tryWith(partFor(cur, screen, scanFrame(cur, screen), c));
      if (!plain.issues.length) {
        attempt = plain;
        wrote = "code";
      }
    }
    if (attempt.issues.length) {
      results.push({ id: c.id, ok: false, issues: attempt.issues });
      continue;
    }
    cur = attempt.doc;
    Object.assign(appVars, attempt.delta?.appVars ?? {});
    if (c.recipe === "confirmFirst" && attempt.part) {
      const dialog = attempt.part.scan.primary;
      if (dialog) confirms.set(c.id, { part: attempt.part.id, path: dialog.path });
    }
    results.push({ id: c.id, ok: true, issues: [], ...(wrote ? { wrote } : {}), ...(rejected ? { rejected } : {}) });
  }
  return { doc: cur, appVars, results };
}
