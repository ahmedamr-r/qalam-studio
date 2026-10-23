import { beforeAll, describe, expect, it } from "vitest";
import raw from "./tokens.json";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildInstance, buildScreen, isDarkColor, type BuildCtx, type Inst, type LBox, type ScreenSpec } from "./builders";
import { cropRefs, isImageRef, parseCrop, replaceRefs } from "./crops";
import { completeTree } from "./contract";
import { designSystemFromExtraction } from "./fromExtraction";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { SAMPLE_DS_FOUNDATIONS } from "@/ai/fixtures-ds";

/**
 * The built-in system's super-app look, and the pieces its screens needed: pictures
 * cut from a screenshot, a header band the content rises over, a dark tab bar, scrolling tiles,
 * checkbox rows, offer and membership tags, full-bleed bands and dividers.
 */

const ctx: BuildCtx = { dir: "ltr", lang: "en" };
const lay = (spec: ScreenSpec, ts: TokenSet = BUILTIN) => layoutToNodes(buildScreen(spec, ts), { dir: spec.dir ?? "ltr", lang: "en", ts }, { x: 0, y: 0 });
const find = (b: LBox, pred: (x: LBox) => boolean): LBox | undefined => (pred(b) ? b : (b.children ?? []).map((c) => find(c, pred)).find(Boolean));
const all = (b: LBox): LBox[] => [b, ...(b.children ?? []).flatMap(all)];
const screen = (p: Partial<ScreenSpec>): ScreenSpec => ({ name: "S", body: [], ...p });

describe("pictures from a screenshot", () => {
  it("reads crop references and knows what an image prop may hold", () => {
    expect(parseCrop("crop:12,40,100,80")).toEqual({ x: 12, y: 40, w: 100, h: 80 });
    expect(parseCrop("crop: 1.5, 2, 30, 30")).toEqual({ x: 1.5, y: 2, w: 30, h: 30 });
    expect(parseCrop("crop:0,0,0,10")).toBeNull();
    expect(isImageRef("asset:abc123")).toBe(true);
    expect(isImageRef("data:image/png;base64,AAAA")).toBe(true);
    expect(isImageRef("")).toBe(true);
    expect(isImageRef("https://example.com/a.png")).toBe(false);
    expect(isImageRef("<svg/>")).toBe(false);
  });

  it("finds every crop in a spec and swaps them for stored pictures", () => {
    const spec = screen({
      body: [
        { component: "Image", props: { src: "crop:1,2,30,30", alt: "Logo", height: 40 } },
        { component: "ServiceGrid", props: { tiles: [{ label: "Rides", icon: "car", image: "crop:5,5,40,40" }] } },
      ],
    });
    expect(cropRefs(spec)).toEqual(["crop:1,2,30,30", "crop:5,5,40,40"]);
    const out = replaceRefs(spec, new Map([["crop:1,2,30,30", "asset:aaa"]]));
    expect(out.body[0].props!.src).toBe("asset:aaa");
    // A crop that couldn't be cut becomes a placeholder.
    expect((out.body[1].props!.tiles as { image: string }[])[0].image).toBe("");
  });

  it("draws a stored picture, and a placeholder until there is one", () => {
    const pic = buildInstance({ component: "Image", props: { src: "asset:abc", alt: "Cake", height: 120, radius: "md", fit: "contain", background: "surface" } }, ctx);
    expect(pic.kind).toBe("image");
    expect(pic.image).toEqual({ src: "asset:abc", fit: "contain" });
    expect(pic.radius).toBe("radius.md");
    expect(pic.fill).toBe("bg.surface");
    const pending = buildInstance({ component: "Image", props: { src: "crop:1,1,20,20", alt: "Cake", height: 120 } }, ctx);
    expect(pending.kind).toBe("frame");
    expect(pending.fill).toBe("bg.surface");
    const bad = buildInstance({ component: "Image", props: { src: "javascript:alert(1)", alt: "x", height: 40 } }, ctx);
    expect(bad.flags?.map((f) => f.rule)).toContain("bad-image");
  });
});

describe("built-in super-app components", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("runs a scrolling tile grid off the end edge in even rows, the next tile peeking in", () => {
    const tiles = Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, icon: "car" }));
    const grid = buildInstance({ component: "ServiceGrid", props: { columns: "4", scroll: true, tiles } }, ctx);
    expect(grid.children).toHaveLength(2);
    expect(grid.children!.map((r) => r.children!.length)).toEqual([5, 5]);
    expect(grid.clip).toBe(true);
    expect(grid.margin?.end).toBeLessThan(0);
    // Eight tiles: two rows of four.
    const eight = buildInstance({ component: "ServiceGrid", props: { columns: "4", scroll: true, tiles: tiles.slice(0, 8) } }, ctx);
    expect(eight.children!.map((r) => r.children!.length)).toEqual([4, 4]);
    // A tile with a picture shows it instead of the icon.
    const pic = buildInstance({ component: "ServiceGrid", props: { tiles: [{ label: "Rides", icon: "car", image: "asset:car" }] } }, ctx);
    expect(find(pic, (b) => b.kind === "image")?.image?.src).toBe("asset:car");
  });

  it("puts a price before a checkbox, and fills a ticked one", () => {
    const row = buildInstance({ component: "ListItem", props: { title: "Mabrook topper", trailing: "checkbox", trailingText: "+ AED 20" } }, ctx);
    const kids = all(row);
    const box = kids.find((b) => b.component === "Checkbox")!;
    expect(box.stroke?.token).toBe("border.default");
    expect(kids.some((b) => b.text?.content === "+ AED 20")).toBe(true);
    const ticked = buildInstance({ component: "ListItem", props: { title: "Mabrook topper", trailing: "checkbox", checked: true } }, ctx);
    expect(all(ticked).find((b) => b.component === "Checkbox")!.fill).toBe("bg.brand-strong");
  });

  it("sets runs of rows in a card flush, apart from the card's other content", () => {
    const row = (t: string): Inst => ({ component: "ListItem", props: { title: t, trailing: "checkbox", divider: true } });
    const card = buildInstance({ component: "Card", props: { title: "Add-ons" }, children: [{ component: "Text", props: { text: "Select any options" } }, row("A"), row("B"), row("C")] }, ctx);
    expect(card.children!.map((c) => c.name)).toEqual(["Add-ons", "Select any options", "Rows"]);
    const rows = card.children![2];
    expect(rows.gap).toBeUndefined();
    expect(rows.children).toHaveLength(3);
  });

  it("draws offer and membership tags from their recipes", () => {
    const promo = buildInstance({ component: "Tag", props: { label: "30% off", tone: "promo" } }, ctx);
    expect(promo.fill).toBe("component.tag.promo-fill");
    const member = buildInstance({ component: "Tag", props: { label: "Plus", tone: "member" } }, ctx);
    expect(member.fill).toBe("component.tag.member-fill");
    expect(member.stroke?.token).toBe("component.tag.member-border");
  });

  it("turns primary and secondary text light on a dark card, and leaves chosen tones alone", () => {
    const card: Inst = {
      component: "Card",
      props: { tone: "inverse" },
      children: [
        { component: "Text", props: { text: "Selected city is Dubai", style: "headline" } },
        { component: "Text", props: { text: "Change", style: "body", tone: "link" } },
        { component: "Stack", props: { background: "surface" }, children: [{ component: "Text", props: { text: "Inside a light panel", style: "body" } }] },
      ],
    };
    const b = buildInstance(card, ctx);
    const texts = all(b).filter((x) => x.text);
    expect(texts.find((t) => t.text!.content === "Selected city is Dubai")!.text!.color).toBe("text.inverse");
    expect(texts.find((t) => t.text!.content === "Change")!.text!.color).toBe("text.link");
    expect(texts.find((t) => t.text!.content === "Inside a light panel")!.text!.color).toBe("text.primary");
    // A dark card is its own edge.
    expect(b.stroke).toBeUndefined();
  });

  it("runs full-bleed bands and dividers past the side margins", () => {
    const g = BUILTIN.dimension("layout.gutter")!;
    const band = buildInstance({ component: "Card", props: { tone: "inverse", fullBleed: true } }, ctx);
    expect(band.margin).toEqual({ start: -g, end: -g });
    const line = buildInstance({ component: "Divider", props: { fullBleed: true } }, ctx);
    expect(line.margin).toEqual({ start: -g, end: -g });
  });

  it("draws a brand title lockup and a filled trailing button in the top bar", () => {
    const bar = buildInstance({ component: "TopBar", props: { title: "Shops", titleIcon: "smile", leading: "back", trailing: "menu", trailingVariant: "brand" } }, ctx);
    const title = find(bar, (b) => b.name === "Title")!;
    expect(title.children!.map((c) => c.kind)).toEqual(["icon", "text"]);
    const menu = find(bar, (b) => b.name === "menu")!;
    expect(menu.fill).toBe("component.icon-button.brand-fill");
    expect(menu.stroke).toBeUndefined();
    // 40px buttons keep a 44px touch target.
    expect(menu.hitArea).toBe(44);
  });

  it("puts the search icon where the system says, and makes the field translucent on a dark band", () => {
    const end = buildInstance({ component: "SearchBar", props: { placeholder: "Search" } }, ctx);
    expect(end.children!.map((c) => c.kind)).toEqual(["text", "icon"]);
    const glass = buildInstance({ component: "SearchBar", props: { placeholder: "Search" } }, { ...ctx, onDark: true });
    expect(glass.fill).toBe("component.search.backdrop-fill");
    expect(glass.stroke).toBeUndefined();
  });

  it("docks the dark tab bar over the home indicator, with tabs coloured by its recipe", () => {
    const nodes: SceneNode[] = lay(screen({ body: [{ component: "Text", props: { text: "Hi" } }], footer: [{ component: "BottomNav", props: { active: 0, items: [{ label: "Home", icon: "house" }, { label: "Profile", icon: "user" }] } }] }));
    expect(nodes.find((n) => n.name === "Home indicator")!.fill?.token).toBe("component.nav-bar.fill");
    const labels = nodes.filter((n) => n.type === "text" && (n.name === "Home" || n.name === "Profile"));
    expect(labels.map((n) => n.fill?.token)).toEqual(["component.nav-bar.active", "component.nav-bar.inactive"]);
    expect(isDarkColor(BUILTIN.color("component.nav-bar.fill"))).toBe(true);
  });
});

describe("the built-in look stays the built-in's", () => {
  it("completes other systems with neutral defaults, not the built-in's", () => {
    const tree = structuredClone(raw) as Tree;
    const comp = tree.component as Tree;
    delete comp.search;
    delete (comp.backdrop as Record<string, unknown>)["sheet-radius"];
    delete (comp.backdrop as Record<string, unknown>).fill;
    const ts = new TokenSet(completeTree(tree).tree);
    expect(ts.dimension("component.backdrop.sheet-radius")).toBe(0);
    expect(ts.get("component.search.style.icon")?.value).toBe("start");
    expect(ts.dimension("component.search.height")).toBe(ts.dimension("component.input.height"));
    expect(ts.gradient("component.backdrop.fill")?.stops.map((s) => s.color)).toEqual([ts.color("bg.brand-subtle"), ts.color("bg.canvas")]);
  });

  it("starts an extraction from neutral recipes where the model didn't style a component", () => {
    const ts = new TokenSet(designSystemFromExtraction({ foundations: { ...SAMPLE_DS_FOUNDATIONS, components: undefined } as never }).tree);
    expect(ts.dimension("component.backdrop.sheet-radius")).toBe(0);
    expect(ts.get("component.nav-bar.fill")?.aliasOf).toBe("bg.canvas");
    expect(ts.dimension("component.button.radius")).toBe(ts.dimension("radius.pill"));
  });

  it("keeps the built-in system's own look", () => {
    expect(BUILTIN.color("text.primary")).toBe("#1C1C1C");
    expect(BUILTIN.color("bg.brand-strong")).toBe("#161C5B");
    expect(BUILTIN.dimension("component.button.radius")).toBe(8);
    expect(BUILTIN.dimension("component.backdrop.sheet-radius")).toBeGreaterThan(0);
  });
});
