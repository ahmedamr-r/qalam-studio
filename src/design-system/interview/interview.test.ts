import { describe, expect, it } from "vitest";
import raw from "../tokens.json";
import { systemPayload } from "@/ai/ds-payload";
import { flattenTokens, TokenSet, type Tree } from "../resolve";
import { designSystemFromInterview, expandKnobs } from "./expand";
import { ARABIC_FONTS, FONTS, arabicPairing, fontCandidates, rankFonts, weightGaps } from "./fonts";
import { KNOB_SPECS, knobDistance, knobHash, type AxisId, type Domain, type Knobs } from "./knobs";
import { readOf } from "./samples";
import { baselineKnobs, codeDirections, lowConfidenceAxes } from "./table";

const B2B = readOf("b2b-finance", { authority: 0.85, serious: 0.85, energetic: 0.25, compact: 0.8, innovative: 0.55 }, { platform: "web" });
const CONSUMER = readOf("consumer-finance", { authority: 0.3, serious: 0.45, energetic: 0.55, compact: 0.3, innovative: 0.6 });

const idx = (k: Knobs, id: keyof typeof KNOB_SPECS) => KNOB_SPECS[id].options.indexOf(k[id] as string);

describe("from personality to knobs", () => {
  it("makes finance for businesses tighter, sharper and more solid than finance for people", () => {
    const b = baselineKnobs(B2B);
    const c = baselineKnobs(CONSUMER);
    expect(idx(b, "radius")).toBeLessThan(idx(c, "radius"));
    expect(idx(b, "density")).toBeLessThan(idx(c, "density"));
    expect(b.fill).toBe("solid");
    expect(c.fill).toBe("tonal");
    expect(b.bodySize).toBe("14");
    expect(c.bodySize).toBe("16");
  });

  it("moves knobs one way only as an axis grows", () => {
    const grid = [0.05, 0.25, 0.5, 0.75, 0.95];
    for (const domain of ["other", "b2b-finance", "consumer-finance"] as Domain[]) {
      const at = (axis: AxisId, v: number) => baselineKnobs(readOf(domain, { [axis]: v }));
      for (let i = 1; i < grid.length; i++) {
        expect(idx(at("compact", grid[i]), "density")).toBeLessThanOrEqual(idx(at("compact", grid[i - 1]), "density"));
        expect(idx(at("serious", grid[i]), "radius")).toBeLessThanOrEqual(idx(at("serious", grid[i - 1]), "radius"));
        expect(idx(at("authority", grid[i]), "radius")).toBeLessThanOrEqual(idx(at("authority", grid[i - 1]), "radius"));
        expect(idx(at("serious", grid[i]), "chroma")).toBeLessThanOrEqual(idx(at("serious", grid[i - 1]), "chroma"));
        expect(idx(at("energetic", grid[i]), "chroma")).toBeGreaterThanOrEqual(idx(at("energetic", grid[i - 1]), "chroma"));
      }
    }
  });

  it("keeps the brand colour, never inventing one", () => {
    expect(baselineKnobs(readOf("commerce", {}, { brandHex: "#e4002b" })).brandHex).toBe("#E4002B");
    expect(baselineKnobs(readOf("commerce")).brandHex).toBeNull();
  });

  it("offers three distinct directions, exploring the least certain axes", () => {
    for (const r of [B2B, CONSUMER, readOf("other")]) {
      const dirs = codeDirections(r);
      expect(dirs).toHaveLength(3);
      expect(new Set(dirs.map((d) => knobHash(d.knobs))).size).toBe(3);
    }
    const unsure = readOf("other");
    unsure.axes.energetic.confidence = 0.1;
    expect(lowConfidenceAxes(unsure, 1)).toEqual(["energetic"]);
  });

  it("measures how far apart two systems are", () => {
    const a = baselineKnobs(B2B);
    const b = baselineKnobs(CONSUMER);
    expect(knobDistance(a, a)).toBe(0);
    expect(knobDistance(a, b)).toBeCloseTo(knobDistance(b, a));
    expect(knobDistance(a, b)).toBeGreaterThan(1);
    expect(knobHash(a)).toBe(knobHash({ ...a }));
  });
});

describe("fonts", () => {
  it("only offers families with regular and bold", () => {
    for (const f of FONTS) expect(f.weights.includes(400) && f.weights.includes(700)).toBe(true);
  });

  it("ranks the same way every time, and suggests from the catalogue", () => {
    const a = { authority: 0.8, serious: 0.8, energetic: 0.3, compact: 0.7, innovative: 0.5 };
    expect(rankFonts(a).map((f) => f.family)).toEqual(rankFonts(a).map((f) => f.family));
    for (const f of fontCandidates(a)) expect(FONTS.some((x) => x.family === f)).toBe(true);
  });

  it("pairs every Latin family with one of the Arabic faces", () => {
    for (const f of FONTS.slice(0, 60)) for (const v of [0.1, 0.5, 0.9]) expect(ARABIC_FONTS).toContain(arabicPairing(f.family, { authority: v, serious: v, energetic: 1 - v, compact: v, innovative: v }));
  });

  it("names the weights a family lacks", () => {
    expect(weightGaps("Almarai", [400, 600, 700])).toEqual([600]);
    expect(weightGaps("IBM Plex Sans Arabic", [400, 600, 700])).toEqual([]);
  });
});

// The built-in system's own palette must never leak into a generated system.
const BUILTIN_PALETTE = new Set(
  flattenTokens(raw as Tree)
    .filter((t) => /^color\.(ink|category|mist)\./.test(t.path) && typeof t.value === "string")
    .map((t) => String(t.value).toUpperCase().slice(0, 7)),
);

function check(k: Knobs, label: string) {
  const e = expandKnobs(k, { platform: "mobile" });
  expect(e.failures, label).toEqual([]);
  const ts = new TokenSet(e.tree);
  expect(ts.unresolved(), label).toEqual([]);
  for (const t of ts.tokens) {
    expect(t.description ?? "", label).not.toMatch(/^Inferred/);
    if (t.type === "color" && typeof t.value === "string") expect(BUILTIN_PALETTE.has(t.value.toUpperCase().slice(0, 7)), `${label} ${t.path}`).toBe(false);
  }
  return e;
}

describe("expanding knobs into a system", () => {
  it("is complete and legible across hues, colour levels, greys and contrast", () => {
    const shapes = [
      { radius: "none", density: "compact", elevation: "hairline", fill: "outline" },
      { radius: "full", density: "spacious", elevation: "layered", fill: "tonal" },
      { radius: "medium", density: "regular", elevation: "flat", fill: "solid" },
    ] as const;
    let n = 0;
    for (const hue of [0, 60, 110, 150, 250, 300])
      for (const chroma of ["muted", "balanced", "vivid", "bold"] as const)
        for (const neutralTint of ["pure", "brand"] as const)
          for (const contrast of ["standard", "high"] as const) {
            const k: Knobs = { ...baselineKnobs(readOf("other")), hue, chroma, neutralTint, contrast, ...shapes[n++ % shapes.length] };
            check(k, `${hue}/${chroma}/${neutralTint}/${contrast}`);
          }
  }, 30_000); // ~100 full expansions: slow when the whole suite runs in parallel

  it("handles awkward brand colours", () => {
    for (const brandHex of ["#FFE600", "#0090FF", "#0A0A3F", "#808080", "#E4002B", "#FFFFFF", "#000000"]) {
      for (const neutralTint of ["cool", "warm"] as const) check({ ...baselineKnobs(readOf("commerce", {}, { brandHex })), neutralTint }, brandHex);
    }
  });

  it("keeps the brand colour as the brand fill", () => {
    const ts = new TokenSet(expandKnobs(baselineKnobs(readOf("mobility", {}, { brandHex: "#0090FF" }))).tree);
    expect(ts.color("bg.brand")).toBe("#0090FF");
    // Too light for white text: the primary action steps down the ramp instead.
    expect(ts.color("bg.brand-strong")).not.toBe("#0090FF");
  });

  it("gives light brands dark labels instead of darkening them", () => {
    const ts = new TokenSet(expandKnobs(baselineKnobs(readOf("commerce", {}, { brandHex: "#FFE600" }))).tree);
    expect(ts.color("bg.brand-strong")).toBe("#FFE600");
    expect(ts.color("component.button.primary.fill")).toBe("#FFE600");
  });

  it("is deterministic", () => {
    const k = baselineKnobs(CONSUMER);
    expect(JSON.stringify(expandKnobs(k).tree)).toBe(JSON.stringify(expandKnobs({ ...k }).tree));
  });

  it("changes only secondary controls when the control style changes", () => {
    const k = baselineKnobs(CONSUMER);
    const a = new TokenSet(expandKnobs({ ...k, fill: "solid" }).tree);
    const b = new TokenSet(expandKnobs({ ...k, fill: "outline" }).tree);
    const changed = a.tokens.filter((t) => JSON.stringify(t.value) !== JSON.stringify(b.get(t.path)?.value)).map((t) => t.path);
    expect(changed.length).toBeGreaterThan(0);
    for (const p of changed) expect(p).toMatch(/^component\.(button\.secondary|chip|icon-button|tabs|nav-bar|list-item|tile)\./);
  });

  it("keeps touch targets on phones however compact", () => {
    const ts = new TokenSet(expandKnobs({ ...baselineKnobs(B2B), density: "compact" }, { platform: "mobile" }).tree);
    expect(ts.dimension("component.button.height-md")).toBeGreaterThanOrEqual(44);
    expect(ts.dimension("component.list-item.min-height")).toBeGreaterThanOrEqual(48);
    expect(ts.dimension("component.input.height")).toBeGreaterThanOrEqual(40);
  });

  it("saves as an interview system the AI treats as fully chosen", () => {
    const ds = designSystemFromInterview({ knobs: baselineKnobs(CONSUMER), read: CONSUMER, name: "Lumen", projectId: "p1", now: 1 });
    expect(ds.source).toBe("interview");
    expect(ds.projectId).toBe("p1");
    expect(ds.docs.language.personality).toEqual(CONSUMER.adjectives);
    expect(ds.fonts.map((f) => f.family)).toContain(baselineKnobs(CONSUMER).font);
    expect(systemPayload(ds).inferred).toBeUndefined();
  });
});
