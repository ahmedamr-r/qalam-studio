import { OVERLAP_PX, buildScreen, hasBackdrop, platformOf, type Inst, type LBox, type Overlap, type ScreenSpec } from "./builders";
import { CATALOG_BY_NAME, type PropSpec } from "./components";
import type { TokenSet } from "./resolve";
import type { ComponentDef } from "./docs";
import { withProps } from "./component-props";
import { CUSTOM, componentLookup } from "./custom";

/**
 * Deterministic checks on a generated screen spec, before anyone looks at it: the builders' own
 * validation (character limits, unknown icons, values outside the system) plus composition
 * patterns that make screens read as machine-made. Every issue points at a spec path, so a repair
 * pass can fix exactly that part.
 */

export interface SpecIssue {
  /** Spec path, e.g. "body.2.children.0"; "" for the whole screen. */
  path: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
}

/** Builder flags worth repairing (info-level clamps and the like are left alone). */
const BUILD_RULES = new Set(["not-in-system", "missing-prop", "char-limit", "off-system-value", "unknown-icon", "unexpected-children", "unknown-prop", "bad-path", "graphic-bounds", "graphic-empty", "bad-image"]);

const PLACEHOLDER = /\b(lorem|ipsum|dolor sit|john doe|jane doe|placeholder|your text|restaurant name|product name|item \d+|user name)\b/i;
/** A string that is just the name of its slot ("Title", "Text") — unless it names a view or tool. */
const SLOT_NAME = /^(title|subtitle|text|description|button|heading|caption)$/i;
const HYPE = /\b(amazing|seamless(ly)?|unlock|elevate|supercharge|revolutionary|effortless(ly)?|game[- ]changer|delightful)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const AMOUNT = /(?:AED|USD|SAR|EGP|KWD|QAR|BHD|OMR|GBP|EUR|INR|\$|€|£|₹)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:AED|SAR|EGP|د\.إ|ر\.س|ج\.م)/g;

/** A string that states a price or another amount of money. */
export const hasAmount = (s: string) => new RegExp(AMOUNT.source).test(s);

interface Visit {
  inst: Inst;
  path: string;
  region: string;
  parent: Inst | null;
}

function walk(spec: ScreenSpec): Visit[] {
  const out: Visit[] = [];
  const go = (list: Inst[] | undefined, base: string, region: string, parent: Inst | null) =>
    (list ?? []).forEach((inst, i) => {
      if (!inst || typeof inst !== "object") return;
      const path = `${base}${i}`;
      out.push({ inst, path, region, parent });
      go(inst.children, `${path}.children.`, region, inst);
    });
  for (const region of ["header", "sidebar", "hero", "body", "footer"] as const) go(spec[region], `${region}.`, region, null);
  return out;
}

/** Every string a component shows (props, list items, table cells); not option values such as a track's kind. */
export function strings(inst: Inst): string[] {
  const out: string[] = [];
  const add = (p: PropSpec | undefined, v: unknown) => {
    if (!p || p.type === "enum" || p.type === "icon" || p.type === "number" || p.type === "numbers" || p.type === "boolean" || p.type === "path" || p.type === "image") return;
    if (p.type === "items") {
      for (const item of Array.isArray(v) ? v : []) if (item && typeof item === "object") for (const [k, f] of Object.entries(p.fields)) add(f, (item as Record<string, unknown>)[k]);
    } else if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") out.push(s);
  };
  const spec = CATALOG_BY_NAME.get(inst.component);
  for (const [k, v] of Object.entries(inst.props ?? {})) add(spec?.props[k], v);
  return out;
}

/** Components whose strings are short names of views, tools or tracks, where "Text" or "Captions" is a real name. */
const NAMES = new Set(["Tabs", "SegmentedControl", "ChipGroup", "Toolbar", "Timeline", "PropertyRow", "Slider"]);

/** Components without a fill of their own whose tiles or cards are surfaces, so they can rise over a hero. */
const TILED = new Set(["ServiceGrid", "Carousel"]);

/** Builder flags, attached to the nearest catalog instance's spec path. */
function builderIssues(root: LBox): SpecIssue[] {
  const out: SpecIssue[] = [];
  const visit = (b: LBox, path: string) => {
    const here = b.specPath ?? path;
    for (const f of b.flags ?? []) if (BUILD_RULES.has(f.rule)) out.push({ path: here, rule: f.rule, severity: f.rule === "not-in-system" ? "error" : "warning", message: f.message });
    for (const c of b.children ?? []) visit(c, here);
  };
  visit(root, "");
  return out;
}

/** The built box of the catalog instance at a spec path. */
function boxAt(b: LBox, path: string): LBox | undefined {
  if (b.specPath === path) return b;
  for (const c of b.children ?? []) {
    const hit = boxAt(c, path);
    if (hit) return hit;
  }
}

/** A component tree's shape: which components, nested how (values left out). */
const shapeOf = (i: Inst): string => `${i?.component}(${(i?.children ?? []).map(shapeOf).join(",")})`;
const nodeCount = (i: Inst): number => 1 + (i?.children ?? []).reduce((n, c) => n + nodeCount(c), 0);

export const isPrimaryButton = (i: Inst | undefined) => i?.component === "Button" && (i.props?.variant ?? "primary") === "primary";

/** A primary Button on each of several items of one collection: the same action, placed again and again. */
export interface RepeatedPrimary {
  /** The collection: a container's spec path, or a region ("body") whose items they are. */
  collection: string;
  /** Each item's path and the path of its primary Button (the item's own, for a component's instances). */
  items: { item: string; button: string }[];
  /** The items are instances of a component made for the screen, whose composition holds the Button: its name and that part's path in it. */
  component?: { name: string; part: string };
}

/** The path, within an instance, of its first primary Button ("" for itself); null when it has none. */
export function firstPrimary(i: Inst, path = ""): string | null {
  if (isPrimaryButton(i)) return path;
  for (const [k, c] of (i?.children ?? []).entries()) {
    const p = firstPrimary(c, `${path ? `${path}.` : ""}children.${k}`);
    if (p !== null) return p;
  }
  return null;
}

/** What an instance is as an item of a collection, so items placed again are the same kind. */
const itemKind = (i: Inst) => (i.component === CUSTOM ? `${CUSTOM}:${i.props?.name}` : i.component === "Stack" ? `Stack:${i.props?.direction ?? "vertical"}` : i.component);
/** An action by the verb it leads with ("Reorder", "Add", "Book"): the same verb on each item is one action repeated. */
const verbOf = (i: Inst) => String(i.props?.label ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
/** How an item looks (its tone or background), with the catalog's defaults. */
const lookOf = (i: Inst) =>
  ["tone", "background"]
    .map((k) => {
      const p = CATALOG_BY_NAME.get(i.component)?.props[k];
      return String(i.props?.[k] ?? (p && "default" in p ? p.default : ""));
    })
    .join("|");

/**
 * Primary Buttons repeated across same-kind items: a Carousel's cards, a row of tiles, a list's
 * rows, cards one under another. Each item's action is the same (a Carousel's items are one
 * collection by definition; elsewhere their Buttons lead with the same verb), so a primary on
 * every one makes the screen's main action a dozen. The innermost collection claims a Button; an
 * item set apart from the rest (its own tone, e.g. the plan a pricing page recommends) keeps its
 * primary, and the rest still count. Instances of a component made for the screen count by the
 * Button in its composition (one Button, shown on every instance); a design system's own
 * components are the designer's and are left as they are.
 */
export function repeatedPrimaries(spec: ScreenSpec, library?: ComponentDef[]): RepeatedPrimary[] {
  const visits = walk(spec);
  const lookup = componentLookup(library, spec.components);
  const lists: { path: string; carousel: boolean; kids: { inst: Inst; path: string }[] }[] = [];
  for (const region of ["header", "sidebar", "hero", "body", "footer"] as const)
    lists.push({ path: region, carousel: false, kids: (spec[region] ?? []).map((inst, i) => ({ inst, path: `${region}.${i}` })) });
  for (const v of visits) if (v.inst.children?.length) lists.push({ path: v.path, carousel: v.inst.component === "Carousel", kids: v.inst.children.map((inst, i) => ({ inst, path: `${v.path}.children.${i}` })) });
  // Innermost first: a list's rows inside a Card are that Card's collection, not the screen's.
  const depth = (p: string) => p.split(".").length;
  lists.sort((a, b) => depth(b.path) - depth(a.path));
  const claimed = new Set<string>();
  const out: RepeatedPrimary[] = [];
  for (const list of lists) {
    const groups = new Map<string, { inst: Inst; path: string }[]>();
    for (const k of list.kids) {
      if (!k.inst || typeof k.inst !== "object" || !(k.inst.children?.length || k.inst.component === CUSTOM)) continue;
      groups.set(itemKind(k.inst), [...(groups.get(itemKind(k.inst)) ?? []), k]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      if (group[0].inst.component === CUSTOM) {
        const hit = lookup(String(group[0].inst.props?.name ?? ""));
        const part = hit?.from === "local" ? firstPrimary(hit.def.composition) : null;
        if (part !== null && hit) out.push({ collection: list.path, items: group.map((k) => ({ item: k.path, button: k.path })), component: { name: hit.def.name, part } });
        continue;
      }
      const holders = group.flatMap((k) => {
        const b = visits.find((v) => v.path.startsWith(`${k.path}.`) && !claimed.has(v.path) && isPrimaryButton(v.inst));
        return b ? [{ ...k, button: b }] : [];
      });
      // One action repeated: every item of a Carousel, elsewhere the items whose Buttons share a verb.
      const verbs = new Map<string, typeof holders>();
      for (const h of holders) verbs.set(verbOf(h.button.inst), [...(verbs.get(verbOf(h.button.inst)) ?? []), h]);
      for (const set of list.carousel ? [holders] : [...verbs.values()]) {
        const lead = setApart(set.map((h) => h.inst));
        const same = set.filter((_, i) => i !== lead);
        if (same.length < 2) continue;
        for (const h of same) claimed.add(h.button.path);
        out.push({ collection: list.path, items: same.map((h) => ({ item: h.path, button: h.button.path })) });
      }
    }
  }
  return out;
}

/** The one item that looks unlike the rest, which all look alike (a recommended plan); -1 when there's none. */
function setApart(items: Inst[]): number {
  const looks = items.map(lookOf);
  if (items.length === 2) {
    // Two items: the one that changed its look from the default.
    const changed = [0, 1].filter((i) => looks[i] !== lookOf({ component: items[i].component }));
    return looks[0] !== looks[1] && changed.length === 1 ? changed[0] : -1;
  }
  return looks.findIndex((l, i) => {
    const rest = looks.filter((_, j) => j !== i);
    return new Set(rest).size === 1 && rest[0] !== l;
  });
}

export function lintSpec(spec: ScreenSpec, ts?: TokenSet, library?: ComponentDef[]): SpecIssue[] {
  const built = buildScreen(spec, ts, library);
  const issues = builderIssues(built);
  const platform = platformOf(spec);
  const all = walk(spec);
  const push = (path: string, rule: string, severity: SpecIssue["severity"], message: string) => issues.push({ path, rule, severity, message });

  if (!spec.body?.length) push("", "empty-body", "error", "The screen has no body content.");

  // One primary action, and none repeated on every item of a collection.
  const repeated = repeatedPrimaries(spec, library);
  for (const r of repeated) {
    const where = r.collection.includes(".") ? `this ${all.find((v) => v.path === r.collection)?.inst.component ?? "collection"}'s items` : `the ${r.collection}'s items`;
    const fix = "A primary is the screen's one main action; an action repeated on every item is tertiary and small, beside the item's price on its last row, or secondary on a line of its own.";
    if (r.component) {
      push(r.collection, "repeated-primary", "warning", `${r.items.length} of ${where} are ${r.component.name}, whose composition has a primary Button (part "${r.component.part || "itself"}"), so every one shows it. ${fix} Change it in ${r.component.name}'s composition.`);
      continue;
    }
    const first = all.find((v) => v.path === r.items[0].button)?.inst;
    push(r.collection, "repeated-primary", "warning", `${r.items.length} of ${where} each have a primary Button ("${String(first?.props?.label ?? "")}", at ${r.items.map((i) => i.button).join(", ")}). ${fix}`);
  }
  const inRepeat = new Set(repeated.flatMap((r) => r.items.map((i) => i.button)));
  const primaries = all.filter((v) => isPrimaryButton(v.inst) && !inRepeat.has(v.path));
  if (primaries.length > 1) push(primaries[1].path, "one-primary", "warning", `${primaries.length} primary Buttons (${primaries.map((p) => p.path).join(", ")}); a screen has one primary action, the rest are secondary or tertiary.`);

  const banners = all.filter((v) => v.inst.component === "PromoBanner");
  if (banners.length > 1) push(banners[1].path, "promo-overload", "warning", `${banners.length} PromoBanners on one screen; keep at most one.`);

  // Platform chrome.
  const phoneOnly = new Set(["TopBar", "BottomNav", "BottomSheet"]);
  if (platform !== "mobile") for (const v of all) if (phoneOnly.has(v.inst.component)) push(v.path, "wrong-platform", "error", `${v.inst.component} is phone chrome; ${platform} screens use their own navigation.`);
  if (platform !== "dashboard" && platform !== "app" && spec.sidebar?.length) push("sidebar.0", "wrong-platform", "warning", "Only dashboards and desktop apps have a sidebar.");
  // Hero and overlap.
  const overlap = OVERLAP_PX[spec.overlap as Overlap] ?? 0;
  if (spec.hero?.length && (platform === "dashboard" || platform === "app")) push("hero.0", "wrong-platform", "warning", `${platform === "app" ? "Desktop apps" : "Dashboards"} have no hero backdrop; put this content at the top of the body and leave hero empty.`);
  if (overlap && !hasBackdrop(spec)) push("", "overlap-without-hero", "warning", `overlap is "${spec.overlap}" but the screen has no hero for the body to rise over; set overlap to "none" or add a hero.`);
  if (overlap && hasBackdrop(spec) && spec.body?.length && !boxAt(built, "body.0")?.fill && !TILED.has(spec.body[0]?.component))
    push("body.0", "overlap-surface", "warning", `body.0 (${spec.body[0]?.component}) has no surface of its own, so rising over the hero's edge (overlap "${spec.overlap}") reads as a mistake; start the body with a Card, a Stack with a background, a ServiceGrid, PromoBanner or SearchBar, or set overlap to "none".`);
  if (platform === "mobile" && (spec.hero?.length ?? 0) > 4) push("hero.4", "hero-size", "warning", `The hero holds ${spec.hero!.length} items; keep it to the screen's lead content (1–4 items) and move the rest into the body.`);
  for (const v of all) if (v.region === "hero" && (v.inst.component === "BottomNav" || v.inst.component === "BottomSheet")) push(v.path, "wrong-region", "error", `${v.inst.component} belongs in the footer, not the hero.`);

  const navs = all.filter((v) => v.inst.component === "BottomNav");
  if (navs.length > 1) push(navs[1].path, "one-nav", "error", "More than one BottomNav.");
  for (const n of navs) {
    const items = n.inst.props?.items;
    if (Array.isArray(items) && items.length < 3) push(n.path, "nav-items", "warning", "A BottomNav needs 3–5 tabs; use a TopBar or Tabs for fewer destinations.");
  }

  // Heading that repeats the TopBar title.
  const bar = spec.header?.find((i) => i?.component === "TopBar");
  const firstText = all.find((v) => (v.region === "hero" || v.region === "body") && v.inst.component === "Text");
  const barTitle = String(bar?.props?.title ?? "").trim().toLowerCase();
  if (barTitle && firstText && String(firstText.inst.props?.text ?? "").trim().toLowerCase() === barTitle)
    push(firstText.path, "repeated-title", "warning", "This heading repeats the TopBar title right below it; drop it or say something new.");

  // One Card per row of a list.
  const cardRun = (list: Inst[] | undefined, base: string) => {
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 3) push(run[0], "card-per-row", "warning", `${run.length} Cards in a row that each hold a single ListItem (${run.join(", ")}); put the rows in one Card, divided.`);
      run = [];
    };
    (list ?? []).forEach((inst, i) => {
      const one = inst?.component === "Card" && inst.children?.length === 1 && inst.children[0]?.component === "ListItem";
      if (one) run.push(`${base}${i}`);
      else flush();
    });
    flush();
  };
  cardRun(spec.body, "body.");
  for (const v of all) if (v.inst.children?.length) cardRun(v.inst.children, `${v.path}.children.`);

  // A system's own component copied part by part: copies drift from it and from each other
  // (widths, picture shapes, spacing), so it's placed by name. Only exact copies of its structure.
  const own = (library ?? []).map((d) => withProps(d)).filter((d) => d.props?.length && nodeCount(d.composition) >= 3);
  const copied: string[] = [];
  for (const v of all) {
    if (v.inst.component === CUSTOM || copied.some((p) => v.path.startsWith(`${p}.`))) continue;
    const d = own.find((x) => shapeOf(x.composition) === shapeOf(v.inst));
    if (!d) continue;
    copied.push(v.path);
    push(v.path, "rebuilt-component", "warning", `This rebuilds ${d.name}, a component of the design system, from its parts; copies drift apart. Place it with Custom (name "${d.name}") and fill its props (${d.props!.map((p) => p.name).join(", ")}).`);
  }

  // Rows on a phone.
  if (platform === "mobile")
    for (const v of all) {
      if (v.inst.component !== "Stack" || v.inst.props?.direction !== "horizontal") continue;
      const kids = (v.inst.children ?? []).filter((c) => c?.component !== "Tag" && c?.component !== "ChipGroup");
      if (kids.length > 3) push(v.path, "crowded-row", "warning", `A horizontal Stack with ${kids.length} items on a phone; use at most 3, or a Carousel.`);
    }

  // Copy.
  for (const v of all) {
    for (const s of strings(v.inst)) {
      const t = s.trim();
      if (!t) continue;
      if (PLACEHOLDER.test(t) || (SLOT_NAME.test(t) && !NAMES.has(v.inst.component))) push(v.path, "placeholder-copy", "error", `Placeholder copy "${t.slice(0, 40)}"; write real, specific copy.`);
      else if (EMOJI.test(t)) push(v.path, "emoji", "warning", `Emoji in UI copy ("${t.slice(0, 40)}").`);
      else if (HYPE.test(t) || /!/.test(t)) push(v.path, "hype-copy", "warning", `Marketing tone in UI copy ("${t.slice(0, 40)}"); state it plainly, without exclamation marks.`);
    }
    if (v.inst.component === "Text" && v.inst.props?.align === "center" && String(v.inst.props?.style ?? "body") === "body" && String(v.inst.props?.text ?? "").length > 80)
      push(v.path, "centred-paragraph", "warning", "A long paragraph set centred; align body text to the start.");
  }

  // The same number everywhere.
  const amounts = all.flatMap((v) => strings(v.inst).flatMap((s) => [...s.matchAll(AMOUNT)].map((m) => (m[1] ?? m[2]).replace(/,/g, ""))));
  if (amounts.length >= 3 && new Set(amounts).size === 1) push("", "same-numbers", "warning", `Every amount on the screen is ${amounts[0]}; use realistic, varied values.`);
  const ratings = all.filter((v) => v.inst.component === "Rating").map((v) => Number(v.inst.props?.value));
  if (ratings.length >= 3 && new Set(ratings).size === 1) push("", "same-numbers", "warning", `Every rating is ${ratings[0]}; vary them.`);

  // The same icon on every row.
  const icons = all.filter((v) => v.inst.component === "ListItem" && v.inst.props?.leadingIcon).map((v) => String(v.inst.props!.leadingIcon));
  if (icons.length >= 4 && new Set(icons).size === 1) push("", "same-icon", "warning", `All ${icons.length} ListItems use the "${icons[0]}" icon; give each row an icon that says what it is, or none.`);

  // Data components.
  for (const v of all) {
    const p = v.inst.props ?? {};
    if (v.inst.component === "Chart") {
      const vals = Array.isArray(p.values) ? p.values : [];
      const labels = Array.isArray(p.labels) ? p.labels : [];
      if (vals.length !== labels.length) push(v.path, "chart-data", "warning", `The Chart has ${labels.length} labels but ${vals.length} values.`);
      else if (vals.length >= 3 && new Set(vals).size === 1) push(v.path, "chart-data", "warning", "Every bar in the Chart has the same value.");
    }
    if (v.inst.component === "Timeline") {
      const duration = Number(p.duration) || 0;
      const clips = (Array.isArray(p.tracks) ? (p.tracks as { clips?: unknown }[]) : []).flatMap((t) => (Array.isArray(t?.clips) ? (t.clips as { start?: unknown; end?: unknown }[]) : []));
      if (clips.some((c) => !(Number(c?.end) > Number(c?.start)))) push(v.path, "timeline-data", "warning", "Some Timeline clips end before they start; every clip needs end > start (in seconds).");
      else if (duration && clips.some((c) => Number(c?.end) > duration)) push(v.path, "timeline-data", "warning", `Some Timeline clips run past the project's duration (${duration}s).`);
      if (clips.length >= 3 && new Set(clips.map((c) => Number(c?.end) - Number(c?.start))).size === 1) push(v.path, "same-numbers", "warning", "Every clip on the Timeline has the same length; real edits have uneven cuts.");
    }
    if (v.inst.component === "Panel" && (v.region === "sidebar" || v.parent?.component !== "Stack" || v.parent.props?.direction !== "horizontal"))
      push(v.path, "panel-placement", "warning", "A Panel is a fixed-width side panel: put it after the stage in a horizontal Stack in the body (the sidebar is already a panel).");
    if (v.inst.component === "Graphic") {
      // Artwork, not UI: copy and controls belong in catalog components around it.
      const shapes = Array.isArray(p.shapes) ? (p.shapes as { kind?: unknown }[]) : [];
      const texts = shapes.filter((x) => x?.kind === "text").length;
      if (texts > 3 || (texts && texts === shapes.length))
        push(v.path, "graphic-as-ui", "warning", `The Graphic "${p.label ?? ""}" is mostly text (${texts} of ${shapes.length} shapes); set copy with Text and catalog components around the art, and keep the Graphic for what they can't draw.`);
      if (shapes.length > 16) push(v.path, "graphic-busy", "warning", `The Graphic "${p.label ?? ""}" has ${shapes.length} shapes; a mark or card face reads better with a few bold ones.`);
    }
    if (v.inst.component === "Table") {
      const cols = Array.isArray(p.columns) ? p.columns.length : 0;
      const rows = Array.isArray(p.rows) ? (p.rows as { cells?: unknown[] }[]) : [];
      if (rows.some((r) => (Array.isArray(r?.cells) ? r.cells.length : 0) !== cols)) push(v.path, "table-shape", "warning", `Some Table rows don't have one cell per column (${cols}).`);
    }
  }
  return issues;
}
