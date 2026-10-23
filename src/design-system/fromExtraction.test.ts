import { describe, expect, it } from "vitest";
import type { FoundationsResult, GuideResult } from "@/ai/ds-schemas";
import foundations from "@/ai/fixtures/ds-foundations.json";
import { designSystemFromExtraction, docsFromGuide, foundationsText } from "./fromExtraction";
import { isValid, validateTree } from "./contract";
import { TokenSet, contrastRatio } from "./resolve";
import { sampleRegion } from "./extract";
import { CATALOG } from "./components";
import { captureScale } from "./pixels";
import { BUILTIN } from "./resolve";
import { recipeGroupsFor } from "./recipes";

const F = foundations as unknown as FoundationsResult;

/** A w×h image filled with one colour (ImageData isn't available in Node). */
function flatImage(hex: string, w = 20, h = 20): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

describe("design system from an extraction", () => {
  const ds = designSystemFromExtraction({ foundations: F });
  const ts = new TokenSet(ds.tree);

  it("fills the whole role contract with nothing dangling", () => {
    expect(isValid(validateTree(ds.tree))).toBe(true);
    expect(ts.unresolved()).toEqual([]);
  });

  it("keeps the model's reassignment and aliases the palette", () => {
    expect(ts.get("bg.brand-strong")?.aliasOf).toMatch(/^color\./);
    expect(ts.shadowLayers("shadow.sm")!.length).toBeGreaterThan(1);
    expect(ts.shadowLayers("shadow.inset")?.[0]?.kind).toBe("inner");
    expect(ts.gradient("gradient.brand")?.stops.length).toBeGreaterThanOrEqual(2);
    expect(ts.get("font.family.latin")?.value).toBe(F.fonts.latin.googleFont);
  });

  it("guarantees legible text roles", () => {
    expect(contrastRatio(ts.color("text.primary")!, ts.color("bg.canvas")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ts.color("text.on-brand-strong")!, ts.color("bg.brand-strong")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("recipes resolve against this system's roles", () => {
    expect(ts.dimension("component.button.radius")).toBe(ts.dimension("radius.lg"));
    expect(foundationsText(ds.tree)).toContain("component.button.radius = {radius.lg}");
  });

  it("snaps colours to the pixels the model pointed at", () => {
    const f = structuredClone(F);
    (f.colors as unknown as { bg: Record<string, unknown> }).bg["brand-strong"] = { hex: "#6A21C8", source: "observed", evidence: "", bbox: [0, 0, 1, 1] };
    const snapped = new TokenSet(designSystemFromExtraction({ foundations: f, pixels: flatImage("#5B21B6") }).tree);
    expect(snapped.color("bg.brand-strong")).toBe("#5B21B6");
    expect(sampleRegion(flatImage("#5B21B6"), [0.2, 0.2, 0.4, 0.4])).toEqual({ hex: "#5B21B6", coverage: 1 });
  });

  it("clamps nonsense numbers and falls back on bad recipe values", () => {
    const f = structuredClone(F);
    (f.type as Record<string, { size: number }>).body.size = 900;
    (f.components as { button: { radius: string } }).button.radius = "{radius.nope}";
    const t2 = new TokenSet(designSystemFromExtraction({ foundations: f }).tree);
    expect(t2.typography("type.body")!.fontSize).toBe(96);
    expect(t2.dimension("component.button.radius")).toBe(t2.dimension("radius.pill"));
  });
});

/** A 2x phone capture (750×1334) with a 20pt-inset, 50pt-tall button with 12pt corners and a pill chip. */
function phoneCapture() {
  const w = 750,
    h = 1334;
  const data = new Uint8ClampedArray(w * h * 4);
  const fill = (x0: number, y0: number, rw: number, rh: number, r: number, rgb: number[]) => {
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + rw - r);
        const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + rh - r);
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) data.set([...rgb, 255], (y * w + x) * 4);
      }
  };
  fill(0, 0, w, h, 0, [255, 255, 255]);
  fill(40, 1100, 670, 100, 24, [91, 33, 182]);
  fill(40, 400, 180, 64, 32, [237, 233, 254]);
  const img = { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
  const capture = { ...captureScale(w, h), sentWidth: w, sentHeight: h };
  return { img, capture };
}

describe("checks on the model's numbers", () => {
  it("rescales a model that measured at the wrong scale", () => {
    const f = structuredClone(F);
    f.scale = 1;
    const body = (f.type as Record<string, { size: number }>).body.size;
    const ds = designSystemFromExtraction({ foundations: f, captures: [{ ...captureScale(1170, 2532), sentWidth: 1170, sentHeight: 2532 }] });
    // The fixture is at 1x; told it assumed 1x on a 3x capture, every size is divided by 3 (then clamped).
    expect(new TokenSet(ds.tree).typography("type.body")!.fontSize).toBe(Math.max(9, Math.round((body / 3) * 10) / 10));
    expect(ds.notes!.join(" ")).toMatch(/rescaled/);
  });

  it("uses measured heights, radii and margins over the model's estimates", () => {
    const { img, capture } = phoneCapture();
    const f = structuredClone(F);
    f.elements = [
      { kind: "primary-button", image: 1, bbox: [45 / 750, 1105 / 1334, 700 / 750, 1195 / 1334] },
      { kind: "chip", image: 1, bbox: [42 / 750, 402 / 1334, 218 / 750, 462 / 1334] },
    ];
    const ds = designSystemFromExtraction({ foundations: f, pixels: [img], captures: [capture] });
    const ts = new TokenSet(ds.tree);
    expect(ts.dimension("component.button.height-lg")).toBe(50);
    expect(Math.abs(ts.dimension("component.button.radius")! - 12)).toBeLessThanOrEqual(1.5);
    expect(ts.dimension("component.chip.height")).toBe(32);
    expect(ts.get("component.chip.radius")?.aliasOf).toBe("radius.pill");
    expect(ts.dimension("layout.gutter")).toBe(20);
    expect(ds.notes!.join(" ")).toMatch(/Measured in the pixels/);
  });

  it("keeps scales in order and on the base grid", () => {
    const f = structuredClone(F);
    f.radius = { ...f.radius, sm: 14, md: 10 };
    f.space = { ...f.space, baseUnit: 4, "300": 13 };
    const ts = new TokenSet(designSystemFromExtraction({ foundations: f }).tree);
    expect(ts.dimension("radius.sm")!).toBeLessThanOrEqual(ts.dimension("radius.md")!);
    expect(ts.dimension("space.300")).toBe(12);
  });

  it("makes component labels legible on their fills", () => {
    const f = structuredClone(F);
    const c = f.components as { button: { primary: { fill: string; label: string } } };
    c.button.primary.fill = "#FFE14D";
    c.button.primary.label = "#FFFFFF";
    const ts = new TokenSet(designSystemFromExtraction({ foundations: f }).tree);
    expect(contrastRatio(ts.color("component.button.primary.label")!, ts.color("component.button.primary.fill")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a well-formed recording alone", () => {
    const notes = designSystemFromExtraction({ foundations: F }).notes!.join(" ");
    expect(notes).not.toMatch(/Reordered|rescaled/);
  });
});

describe("docs from the guide pass", () => {
  it("covers every catalog component and drops patterns built from unknown parts", () => {
    const guide = {
      language: { name: "Aura", summary: "Soft violet fintech", personality: ["calm"], principles: [], color: "", typography: "", shape: "", depth: "", density: "", iconography: "", imagery: "", voice: "", dos: [], donts: [] },
      layout: { summary: "Cards on lavender", density: "regular", grid: "", rhythm: "", navigation: "", hierarchy: "", templates: [], rules: [] },
      components: [{ component: "Button", observed: true, purpose: "Primary actions", whenToUse: ["Pay"], whenNotToUse: [], anatomy: [], variants: [], content: "", placement: "", states: "", dos: [], donts: [], tokens: [] }],
      patterns: [
        { name: "BalanceCard", purpose: "Hero balance", guide: {}, composition: { component: "Card", props: { tone: "brand-strong" }, children: [{ component: "Text", props: { text: "AED 12,480" } }] } },
        { name: "VideoPlayer", purpose: "Nope", guide: {}, composition: { component: "VideoPlayer" } },
      ],
    } as unknown as GuideResult;
    const notes: string[] = [];
    const docs = docsFromGuide(guide, notes);
    expect(docs.components.map((c) => c.component)).toEqual(CATALOG.map((c) => c.name));
    expect(docs.components[CATALOG.findIndex((c) => c.name === "Button")].observed).toBe(true);
    expect(docs.patterns.map((p) => p.name)).toEqual(["BalanceCard"]);
    expect(notes.join(" ")).toMatch(/VideoPlayer/);
  });
});

describe("styling only the chosen components", () => {
  const withBackdrop = { ...F, components: { ...(F.components as object), backdrop: { fill: "{gradient.brand}" } } } as FoundationsResult;
  const ds = designSystemFromExtraction({ foundations: withBackdrop, recipeGroups: recipeGroupsFor(["Button"]) });
  const all = designSystemFromExtraction({ foundations: withBackdrop });
  const leaf = (tree: unknown, path: string) => path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], tree) as { $value: unknown };

  it("keeps the default recipe for components the designer didn't choose", () => {
    expect(leaf(all.tree, "component.card.raised.border-width").$value).toBe("{border-width.none}");
    expect(leaf(ds.tree, "component.card.raised.border-width").$value).toBe(BUILTIN.get("component.card.raised.border-width")!.authored);
    expect(leaf(ds.tree, "component.button.shadow").$value).toBe("{shadow.md}");
    expect(isValid(validateTree(ds.tree))).toBe(true);
    expect(ds.notes?.some((n) => /Kept the default styling for \d+ component families/.test(n))).toBe(true);
  });

  it("still takes recipes no catalog component is drawn with", () => {
    expect(leaf(ds.tree, "component.backdrop.fill").$value).toBe("{gradient.brand}");
  });

  it("knows which groups style a component", () => {
    expect(recipeGroupsFor(["PromoBanner"])).toEqual(["component.banner", "component.button"]);
    expect(recipeGroupsFor(["Avatar"])).toEqual([]);
  });
});
