import { describe, expect, it } from "vitest";
import { SAMPLE_ANSWERS, SAMPLE_READ_RAW, SAMPLE_REVIEW_RAW, sampleNudgeRaw } from "@/ai/fixtures-interview";
import { DIRECTIONS_SCHEMA, NUDGE_SCHEMA, READ_SCHEMA, REVIEW_SCHEMA } from "@/ai/interview";
import { knobHash, type Knobs } from "./knobs";
import { brandHexFrom, sanitizeDeltas, sanitizeDirections, sanitizeNudge, sanitizeRead, sanitizeReview } from "./sanitize";
import { baselineKnobs } from "./table";
import { fontCandidates } from "./fonts";
import { axisValues } from "./table";

const { read } = sanitizeRead(SAMPLE_READ_RAW, SAMPLE_ANSWERS, 0);
const base = baselineKnobs(read);
const candidates = fontCandidates(axisValues(read));

describe("reading the brief", () => {
  it("keeps the sample as recorded", () => {
    expect(read.domain).toBe("consumer-finance");
    expect(read.adjectives).toEqual(["calm", "warm", "clear", "trustworthy"]);
    expect(read.scripts).toEqual(["latin", "arabic"]);
    expect(read.axes.energetic.evidence).toEqual(["Calm and in control", "no neon, no hype"]);
    expect(read.slots.brand).toBe("Lumen");
  });

  it("drops quotes the designer never said, and lowers confidence without them", () => {
    const raw = structuredClone(SAMPLE_READ_RAW);
    raw.axes.authority = { value: 0.2, confidence: 0.9, evidence: ["We are a premium luxury bank"] };
    const r = sanitizeRead(raw, SAMPLE_ANSWERS, 0).read;
    expect(r.axes.authority.evidence).toEqual([]);
    expect(r.axes.authority.confidence).toBeLessThanOrEqual(0.35);
  });

  it("never invents a brand colour, and reads one from the answer", () => {
    const raw = { ...SAMPLE_READ_RAW, brandHex: "#FF0000" };
    expect(sanitizeRead(raw, SAMPLE_ANSWERS, 0).read.brandHex).toBeNull();
    const answers = SAMPLE_ANSWERS.map((a) => (a.id === "color" ? { ...a, answer: "Yes, it's 0090ff" } : a));
    expect(sanitizeRead(raw, answers, 0).read.brandHex).toBe("#0090FF");
    expect(brandHexFrom("our green #0a8")).toBe("#00AA88");
    expect(brandHexFrom("no colour yet")).toBeNull();
  });

  it("asks at most three follow-ups, and none once they're answered", () => {
    const raw = { ...SAMPLE_READ_RAW, followUps: [1, 2, 3, 4].map((i) => ({ id: `q${i}`, question: `Question ${i}?`, why: "", options: ["a", "b"] })) };
    expect(sanitizeRead(raw, SAMPLE_ANSWERS, 0).followUps).toHaveLength(3);
    expect(sanitizeRead(raw, SAMPLE_ANSWERS, 1).followUps).toHaveLength(0);
  });

  it("clamps what's out of range and falls back on unknown values", () => {
    const raw = { ...SAMPLE_READ_RAW, domain: "spaceships", platform: "toaster", axes: { ...SAMPLE_READ_RAW.axes, compact: { value: 7, confidence: -2, evidence: [] } }, slots: { ...SAMPLE_READ_RAW.slots, currency: "dirhams" } };
    const r = sanitizeRead(raw, SAMPLE_ANSWERS, 0).read;
    expect(r.domain).toBe("other");
    expect(r.platform).toBe("mobile");
    expect(r.axes.compact.value).toBe(1);
    expect(r.axes.compact.confidence).toBe(0);
    expect(r.slots.currency).toBe("AED");
  });
});

describe("directions", () => {
  it("always gives three distinct ones, recommending the closest to the baseline", () => {
    for (const raw of [{}, { directions: [] }, { directions: [{ knobs: base }, { knobs: base }] }, { directions: "nope" }]) {
      const { directions, recommended } = sanitizeDirections(raw, { read, baseline: base, candidates });
      expect(directions).toHaveLength(3);
      expect(new Set(directions.map((d) => knobHash(d.knobs))).size).toBe(3);
      expect(recommended).toBeGreaterThanOrEqual(0);
    }
  });

  it("repairs knobs the model got wrong", () => {
    const { directions } = sanitizeDirections(
      { directions: [{ name: "Neon dreams", rationale: "x", quote: "y", knobs: { ...base, radius: "huge", font: "Comic Sans MS", arabicFont: "Arial", hue: 900 }, hueReason: "" }] },
      { read, baseline: base, candidates },
    );
    const k = directions[0].knobs;
    expect(k.radius).toBe(base.radius);
    expect(candidates).toContain(k.font);
    expect(k.arabicFont).toBe(base.arabicFont);
    expect(k.hue).toBe(180);
  });

  it("keeps the designer's brand colour in every direction", () => {
    const branded = { ...read, brandHex: "#0090FF" };
    const { directions } = sanitizeDirections({ directions: [{ knobs: { ...base, hue: 20 } }] }, { read: branded, baseline: baselineKnobs(branded), candidates });
    for (const d of directions) expect(d.knobs.brandHex).toBe("#0090FF");
  });
});

describe("nudges and reviews", () => {
  const ctx = { knobs: { ...base, radius: "medium", chroma: "balanced" } as Knobs, locks: [] as const, candidates };

  it("moves ordinal knobs one step toward what was asked", () => {
    const { knobs, applied } = sanitizeDeltas({ deltas: [{ knob: "radius", to: "none", reason: "" }] }, ctx);
    expect(knobs.radius).toBe("small");
    expect(applied).toEqual([{ knob: "radius", from: "medium", to: "small", reason: "" }]);
  });

  it("never touches a locked knob, and limits hue turns", () => {
    const { knobs, applied } = sanitizeDeltas({ deltas: [{ knob: "radius", to: "none" }, { knob: "chroma", to: "bold" }], hueShift: 90 }, { ...ctx, locks: ["radius"] });
    expect(knobs.radius).toBe("medium");
    expect(knobs.chroma).toBe("vivid");
    expect(applied.find((a) => a.knob === "hue")?.to).toBe(String((ctx.knobs.hue + 30) % 360));
    expect(sanitizeDeltas({ hueShift: 20 }, { ...ctx, knobs: { ...ctx.knobs, brandHex: "#0090FF" } }).applied).toEqual([]);
  });

  it("works offline with the sample nudges", () => {
    const n = sanitizeNudge(sampleNudgeRaw("make it more serious"), ctx);
    expect(n.knobs.radius).toBe("small");
    expect(n.knobs.chroma).toBe("muted");
    expect(sanitizeNudge(sampleNudgeRaw("hmm"), ctx).applied).toEqual([]);
  });

  it("checks every adjective of the brief", () => {
    const r = sanitizeReview({ ...SAMPLE_REVIEW_RAW, checks: SAMPLE_REVIEW_RAW.checks.slice(0, 2) }, { ...ctx, read });
    expect(r.checks.map((c) => c.adjective)).toEqual(read.adjectives);
    expect(r.checks[2].verdict).toBe("partly");
    expect(r.knobs.neutralTint).toBe("warm");
  });
});

describe("schemas", () => {
  it("require every property they define (structured outputs)", () => {
    const walk = (s: Record<string, unknown>) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(new Set(s.required as string[])).toEqual(new Set(Object.keys(s.properties as object)));
        for (const p of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(p);
      }
      if (s.type === "array") walk(s.items as Record<string, unknown>);
    };
    for (const s of [READ_SCHEMA, DIRECTIONS_SCHEMA, NUDGE_SCHEMA, REVIEW_SCHEMA]) walk(s);
  });
});
