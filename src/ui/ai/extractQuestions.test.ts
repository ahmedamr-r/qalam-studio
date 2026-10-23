import { describe, expect, it } from "vitest";
import { SAMPLE_DS_SCAN } from "@/ai/fixtures-ds-scan";
import { normalizeOptions } from "@/design-system/extract-options";
import { SCAN_COMPONENTS } from "@/design-system/scan";
import { answerOf, type Answers } from "./questionFlow";
import { SUGGEST, coverage, extractQuestions, fetchOf, optionsFromAnswers } from "./extractQuestions";

const scan = SAMPLE_DS_SCAN;
const seen = scan.components.map((c) => c.name);
const fetch = (value: string): Answers => ({ fetch: { kind: "single", value } });

describe("extraction questions", () => {
  it("asks what to extract, which components, then Qalam AI's questions", () => {
    const qs = extractQuestions(scan, {});
    expect(qs.map((q) => q.id)).toEqual(["fetch", "components", "ai-1", "ai-2"]);
    expect(fetchOf(scan, {})).toBe("components");
    expect(qs[2]).toMatchObject({ source: "ai", optional: true, recommended: "Gradient for heroes, violet for buttons" });
  });

  it("doesn't ask about components for tokens only", () => {
    expect(extractQuestions(scan, fetch("tokens")).map((q) => q.id)).toEqual(["fetch", "ai-1", "ai-2"]);
  });

  it("ticks the components it saw, and the extras only when asked for them", () => {
    const q = extractQuestions(scan, {})[1];
    const a = answerOf(q, {});
    if (a.kind !== "multi" || q.kind !== "multi") throw new Error();
    expect(q.groups.map((g) => g.id)).toEqual(["seen", "extra", "new"]);
    expect(a.values.filter((v) => !v.startsWith("new:"))).toEqual(seen);
    expect(a.values.filter((v) => v.startsWith("new:"))).toHaveLength(4);
    const ext = answerOf(extractQuestions(scan, fetch("extended"))[1], fetch("extended"));
    if (ext.kind !== "multi") throw new Error();
    expect(ext.values.filter((v) => !v.startsWith("new:")).sort()).toEqual([...SCAN_COMPONENTS].sort());
  });

  it("falls back to the whole catalog when the first look failed", () => {
    const qs = extractQuestions(null, {});
    expect(qs.map((q) => q.id)).toEqual(["fetch", "components"]);
    const q = qs[1];
    if (q.kind !== "multi") throw new Error();
    expect(q.groups.map((g) => g.id)).toEqual(["extra", "new"]);
    expect(q.groups[1].options.map((o) => o.value)).toEqual([SUGGEST]);
    expect(optionsFromAnswers(null, { components: { kind: "multi", values: ["Button", SUGGEST], custom: [] } }).patterns).toBe("suggest");
  });
});

describe("answers to extraction options", () => {
  it("tokens only: standard depth, one pass, no component styling", () => {
    const o = optionsFromAnswers(scan, fetch("tokens"));
    expect(o).toMatchObject({ depth: "standard", docs: false, language: false, components: [], patterns: "none", recipes: "chosen" });
    expect(o.observed).toEqual(seen);
  });

  it("the components you use: complete depth, the ticked components and new ones", () => {
    const o = optionsFromAnswers(scan, { ...fetch("components"), components: { kind: "multi", values: ["Button", "Card", "Tabs", "new:Balance hero card"], custom: ["Stats strip"] } });
    expect(o).toMatchObject({ depth: "complete", docs: true, language: true, recipes: "chosen", patterns: "listed" });
    expect(o.components).toEqual(["Button", "Card", "Tabs"]);
    expect(o.patternNames).toEqual(["Balance hero card", "Stats strip"]);
    expect(coverage(o).line).toBe("3 components styled (2 seen, 1 designed to match) · 2 new · the rest keep the default styling");
  });

  it("extras: every catalog component", () => {
    const o = optionsFromAnswers(scan, fetch("extended"));
    expect(o.components).toHaveLength(SCAN_COMPONENTS.length);
    expect(coverage(o).line).not.toMatch(/the rest/);
  });

  it("follows the depth and docs set on the review step", () => {
    expect(optionsFromAnswers(scan, fetch("tokens"), { depth: "essentials", language: true, rebuild: true })).toMatchObject({ depth: "essentials", docs: true, language: true });
    expect(optionsFromAnswers(scan, {}, { depth: "standard", language: false, rebuild: false })).toMatchObject({ depth: "standard", language: false, docs: true });
  });

  it("passes the note and Qalam AI's answers on, not skipped ones", () => {
    const o = optionsFromAnswers(scan, { "ai-1": { kind: "single", value: "__other", other: "Violet everywhere" }, "ai-2": { kind: "skipped" } }, undefined, " It's a banking app ");
    expect(o.notes).toEqual([
      { question: "Designer's note", answer: "It's a banking app" },
      { question: scan.questions[0].text, answer: "Violet everywhere" },
    ]);
    // Unanswered but shown with a recommendation: the recommendation stands.
    expect(optionsFromAnswers(scan, {}).notes.map((n) => n.answer)).toEqual(["Gradient for heroes, violet for buttons", "Success colour"]);
  });

  it("is already normalised", () => {
    for (const a of [fetch("tokens"), fetch("components"), fetch("extended"), {}]) {
      const o = optionsFromAnswers(scan, a);
      expect(normalizeOptions(o)).toEqual(o);
    }
  });
});
