/**
 * What could be prototyped on a screen (pure): every recipe that applies to what a scan of it
 * finds — where it acts, the part it needs that the screen hasn't got yet (a sheet for a dish's
 * options, a dialog to confirm a transfer), whether it's on the main path (what a person does
 * first), and what it's an alternative to. Code decides what applies; the prototyping agent picks,
 * orders and words these for the designer, and writes what a new part says. A candidate's id is
 * what the model points at: it never names a layer itself.
 */
import { isPlatform, PLATFORMS } from "@/design-system/platform";
import type { Surface } from "@/design-system/surfaces";
import type { Doc, RouteRef } from "@/doc/schema";
import { findMoney } from "../money";
import { findLayer, partFrames, routeOf } from "../routes";
import { addRef, scanFrame, tappedItems, type Collection, type FrameScan } from "../scan";
import type { Block } from "./blocks";

export type RecipeId = "headerOnScroll" | "stickySections" | "tabPanels" | "chooseOne" | "configureAndAdd" | "collectionBar" | "confirmFirst" | "toastAfter" | "nextPage" | "fromList" | "blocks";

/** Why a part is needed, so what it should say can be asked for ("custom": what the designer asked a part to hold). */
export type PartRole = "options" | "collection" | "confirm" | "done" | "custom";

export interface Candidate {
  /** "c1", "c2"… in the order they're offered. */
  id: string;
  recipe: RecipeId;
  /** What it acts on, by role and copy, for the model and the designer ("the chips Popular, Shawarma, Plates, Drinks"). */
  what: string;
  /** Where its marker sits. */
  at: RouteRef;
  /** The part it needs, when the screen hasn't one that does (its kind, what it's for); `part` when it has. */
  needs?: { kind: Surface; role: PartRole };
  part?: string;
  /** The recipe's options (which group, which action, whose toast). */
  opts?: Record<string, string>;
  /** On the main path: proposed, and built, first. */
  main: boolean;
  /** Only after this one (a basket bar after adding to it; a toast after a confirm). */
  after?: string;
  /** Instead of this one (tabs that scroll to their section, or show only it). */
  instead?: string;
  /** What code would recommend without the model. */
  recommended: boolean;
  /** For what the designer asked that no recipe covers: the building blocks it's made of. */
  blocks?: Block[];
}

const quote = (labels: string[]) => labels.slice(0, 6).map((l) => `"${l}"`).join(", ") + (labels.length > 6 ? "…" : "");

/** Does the screen scroll (taller than the platform's window)? */
function scrolls(doc: Doc, screen: string): boolean {
  const n = doc.nodes[screen];
  const platform = n?.meta.spec?.platform;
  const h = PLATFORMS[isPlatform(platform) ? platform : "mobile"].h;
  return !!n && n.h > h + 1;
}

/** An existing part of the route that can serve (a sheet whose scan has groups or a main action; a bar; a dialog; a toast). */
function partFor(doc: Doc, screen: string, kind: Surface, ok: (scan: FrameScan) => boolean): string | undefined {
  for (const p of partFrames(doc, screen)) if (p.kind === kind && ok(scanFrame(doc, p.frame))) return p.part;
  return undefined;
}

/** What a collection's item is, in words: its component ("a listitem"), or the design's own by name ("a Dish Tile or a Dish Row"). */
function itemKind(doc: Doc, screen: string, col: Collection): string {
  if (!col.component.startsWith("Custom")) return `a ${col.component.toLowerCase()}`;
  const names = [...new Set(col.items.map((p) => findLayer(doc, screen, p, "Custom")).map((id) => (id ? (doc.nodes[id].meta.component ?? "") : "").split("/")[1]).filter(Boolean))];
  return names.length ? names.map((n) => `a ${n}`).join(" or ") : "a component of the design's own";
}

/** Every candidate for the screen, the main path first (in reading order), then the rest. */
export function candidates(doc: Doc, screen: string): Candidate[] {
  const scan = scanFrame(doc, screen);
  const route = routeOf(doc, screen);
  const done = new Set((route?.steps ?? []).map((s) => s.recipe));
  const long = scrolls(doc, screen);
  const out: Omit<Candidate, "id">[] = [];
  const keys: string[] = [];
  /** Does tapping it already go somewhere (a page, or one not designed yet)? */
  const leadsOn = (at: RouteRef) => !!route?.rules.some((ru) => "ref" in ru.when && (ru.when.ref.part ?? "") === (at.part ?? "") && ru.when.ref.path === at.path && ru.then.some((a) => a.do === "go" || a.do === "next"));
  /** It asks first, and its dialog's confirm already goes somewhere. */
  const confirmLeadsOn = (path: string) =>
    !!route?.rules.some((ru) => "ref" in ru.when && !ru.when.ref.part && ru.when.ref.path === path && ru.then.some((a) => a.do === "open" && route.overlays[a.part]?.kind === "dialog" && route.rules.some((r2) => "ref" in r2.when && r2.when.ref.part === a.part && r2.then.some((x) => x.do === "go" || x.do === "next"))));
  const add = (key: string, c: Omit<Candidate, "id">) => {
    keys.push(key);
    out.push(c);
  };

  // A row of options that names the sections below it: they scroll to their section (a long screen), or show only it.
  for (const row of scan.optionRows) {
    const named = row.sections.filter(Boolean).length;
    if (named < 2) continue;
    const what = `the ${row.component === "ChipGroup" ? "chips" : row.component === "Tabs" ? "tabs" : "segments"} ${quote(row.labels)}, which name the sections below`;
    const scrollFirst = long && row.component !== "SegmentedControl";
    if (row.component !== "SegmentedControl") add(`sticky:${row.path}`, { recipe: "stickySections", what, at: { path: row.path }, main: true, recommended: scrollFirst });
    if (row.component !== "ChipGroup") add(`panels:${row.path}`, { recipe: "tabPanels", what, at: { path: row.path }, main: true, recommended: !scrollFirst });
  }

  // Repeated items with an add action: it opens a sheet about the item, then a bar shows what's in the list.
  const col = scan.collections[0];
  if (col) {
    const sheet = partFor(doc, screen, "sheet", (s) => !!s.primary);
    const bar = partFor(doc, screen, "bar", (s) => !!s.primary);
    add("configure", {
      recipe: "configureAndAdd",
      what: tappedItems(col) ? `${col.items.length} items with a price, each tapped to choose it (${itemKind(doc, screen, col)} per item)` : `${col.items.length} items, each with a + (${itemKind(doc, screen, col)} per item)`,
      at: addRef(col, col.items[0]),
      ...(sheet ? { part: sheet } : { needs: { kind: "sheet", role: "options" } }),
      main: true,
      recommended: true,
    });
    add("bar", {
      recipe: "collectionBar",
      what: "what's been added: its total, and each item's count",
      at: bar ? { part: bar } : addRef(col, col.items[0]),
      ...(bar ? { part: bar } : { needs: { kind: "bar", role: "collection" } }),
      main: true,
      after: "configure",
      recommended: true,
    });
    // Where the bar's button leads (the basket): a page of its own, not designed yet.
    const barScan = bar ? scanFrame(doc, partFrames(doc, screen).find((x) => x.part === bar)!.frame) : null;
    const barAt = barScan?.primary ? { part: bar, path: barScan.primary.path } : null;
    if (!barAt || !leadsOn(barAt))
      add("next:bar", { recipe: "nextPage", what: `the bar's ${barScan?.primary ? `"${barScan.primary.label}"` : "button"}, to the page it opens`, at: barAt ?? addRef(col, col.items[0]), opts: { from: "bar" }, main: true, after: "bar", recommended: true });
  }


  // Pick-one options on the screen itself: the main action follows the pick.
  for (const g of scan.groups) {
    if (g.pick !== "one") continue;
    add(`choose:${g.pattern}`, {
      recipe: "chooseOne",
      what: `the options ${quote(g.titles)}${g.title ? ` under "${g.title}"` : ""}`,
      at: { path: g.rows[0] },
      opts: { at: g.pattern },
      main: true,
      recommended: true,
    });
  }
  for (const row of scan.optionRows) {
    if (row.sections.some(Boolean)) continue;
    add(`choose:${row.path}`, { recipe: "chooseOne", what: `the ${row.component === "ChipGroup" ? "chips" : "options"} ${quote(row.labels)}`, at: { path: row.path }, opts: { at: row.path }, main: true, recommended: true });
  }

  // An action that moves money, or can't be undone, asks first; then a toast says it's done.
  for (const a of scan.actions) {
    const money = !!findMoney(a.label);
    if (a.variant !== "danger" && !(money && a.path === scan.primary?.path)) continue;
    const dialog = partFor(doc, screen, "dialog", (s) => !!s.primary);
    const key = `confirm:${a.path}`;
    add(key, {
      recipe: "confirmFirst",
      what: `"${a.label}"${a.variant === "danger" ? ", which can't be undone" : ", which moves money"}`,
      at: { path: a.path },
      opts: { action: a.path },
      ...(dialog ? { part: dialog } : { needs: { kind: "dialog", role: "confirm" } }),
      main: a.variant !== "danger",
      recommended: true,
    });
    add(`toast:${a.path}`, { recipe: "toastAfter", what: `once "${a.label}" is done`, at: { path: a.path }, opts: { action: a.path }, needs: { kind: "toast", role: "done" }, main: false, after: key, recommended: true });
  }

  // The screen's ways on (Checkout, Book, Send): each goes to its next page, not designed yet; after
  // it asks first, a confirm takes the page on to its dialog's button (built before it: build.ts).
  for (const a of scan.actions.filter((x) => x.variant === "primary").slice(0, 2)) {
    if (leadsOn({ path: a.path }) || confirmLeadsOn(a.path)) continue;
    // Adding something stays on the page.
    const adds = /^(add|\+)/i.test(a.label.trim());
    add(`next:${a.path}`, { recipe: "nextPage", what: `"${a.label}", to the page it leads to`, at: { path: a.path }, opts: { from: "main", action: a.path }, main: true, recommended: !adds });
    // The page it goes to shows it's done: a toast as well isn't needed.
    const toast = out.findIndex((c, i) => keys[i] === `toast:${a.path}`);
    if (toast >= 0 && !adds) out[toast] = { ...out[toast], recommended: false };
  }

  // Lines the app keeps, filled on the screen before this one (a basket, on the menu): this screen's rows show them.
  if (scan.lines) {
    const vars = doc.proto?.vars ?? {};
    const filled = Object.values(doc.proto?.routes ?? {}).flatMap((r) => {
      const goes = r.rules.some((ru) => ru.then.some((a) => a.do === "go" && a.screen === screen));
      return goes ? r.rules.flatMap((ru) => ru.then.flatMap((a) => (a.do === "push" && vars[a.v.replace(/^app\./, "")]?.type.t === "list" ? [a.v] : []))) : [];
    });
    const list = filled[0];
    if (list) {
      const def = vars[list.replace(/^app\./, "")]!;
      const more = scan.lines.rows.length - 1;
      add("lines", { recipe: "fromList", what: `the rows "${scan.lines.title}"${more ? ` and ${more} more` : ""}, as the lines of the ${def.label.toLowerCase()}`, at: { path: scan.lines.rows[0] }, opts: { list, label: def.label.toLowerCase() }, main: true, recommended: true });
    }
  }

  // The top bar turns solid as content scrolls under it.
  if (scan.topBar && long) add("header", { recipe: "headerOnScroll", what: "the top bar, as content scrolls under it", at: { path: scan.topBar.path }, main: false, recommended: true });

  // What's built already isn't offered again; ids follow the main path first, each follower right after what it follows.
  const live = out.map((c, i) => ({ c, i, key: keys[i] })).filter(({ c }) => c.recipe === "nextPage" || !done.has(c.recipe));
  live.sort((a, b) => Number(b.c.main) - Number(a.c.main) || a.i - b.i);
  const has = new Set(live.map((x) => x.key));
  const order: typeof live = [];
  const place = (x: (typeof live)[number]) => {
    order.push(x);
    for (const y of live) if (y.c.after === x.key) place(y);
  };
  for (const x of live) if (!x.c.after || !has.has(x.c.after)) place(x);
  const ids = new Map(order.map(({ key }, n) => [key, `c${n + 1}`]));
  const result: Candidate[] = order.map(({ c, key }) => ({ ...c, id: ids.get(key)! }));
  // `after` and `instead` point at candidate ids.
  for (const r of result) {
    // What it comes after may be built already: then it just comes after that.
    const after = r.after ? ids.get(r.after) : undefined;
    if (after) r.after = after;
    else delete r.after;
  }
  for (const r of result) {
    if (r.recipe !== "stickySections" && r.recipe !== "tabPanels") continue;
    const other = result.find((x) => x !== r && x.at.path === r.at.path && (x.recipe === "stickySections" || x.recipe === "tabPanels"));
    if (other) r.instead = other.id;
  }
  return result;
}
