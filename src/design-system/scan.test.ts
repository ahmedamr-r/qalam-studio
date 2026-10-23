import { describe, expect, it } from "vitest";
import { SAMPLE_DS_SCAN } from "@/ai/fixtures-ds-scan";
import { SCAN_COMPONENTS, sanitizeScan } from "./scan";

const ctx = { images: 2, kinds: ["phone", "phone"] as ("phone" | "desktop")[] };

describe("first look at the screenshots", () => {
  it("keeps catalog components only and merges duplicates", () => {
    const s = sanitizeScan(
      {
        components: [
          { name: "Button", images: [1], count: 2, evidence: "CTA" },
          { name: "button", images: [2, 7], count: 3, evidence: "" },
          { name: "VideoPlayer", images: [1], count: 1, evidence: "" },
          { name: "Stack", images: [1], count: 9, evidence: "" },
          { name: "Card", images: [], count: 0, evidence: "" },
        ],
      },
      ctx,
    );
    expect(s.components.map((c) => c.name)).toEqual(["Button", "Card"]);
    expect(s.components[0]).toMatchObject({ count: 3, images: [1, 2], evidence: "CTA" });
    expect(s.components[1].count).toBe(1);
  });

  it("clamps counts and image numbers", () => {
    const s = sanitizeScan({ components: [{ name: "Tag", images: [0, 1.2, 3, "2"], count: 500 }, { name: "Chart", images: [2], count: 2.7 }] }, ctx);
    expect(s.components.find((c) => c.name === "Tag")).toMatchObject({ count: 99, images: [1, 2] });
    expect(s.components.find((c) => c.name === "Chart")?.count).toBe(3);
  });

  it("drops new components that are really catalog ones, and duplicates", () => {
    const s = sanitizeScan(
      {
        candidates: [
          { name: "Search bar", description: "", images: [1] },
          { name: "Balance card", description: "Gradient hero", images: [1] },
          { name: "balance CARD", description: "", images: [1] },
          ...Array.from({ length: 8 }, (_, i) => ({ name: `Widget ${i}`, description: "", images: [1] })),
        ],
      },
      ctx,
    );
    expect(s.candidates[0].name).toBe("Balance card");
    expect(s.candidates.filter((c) => /balance/i.test(c.name))).toHaveLength(1);
    expect(s.candidates).toHaveLength(6);
  });

  it("keeps only answerable questions, at most two", () => {
    const s = sanitizeScan(
      {
        questions: [
          { text: "Only one option?", why: "", options: ["Yes", "yes "], recommended: "Yes" },
          { text: "Which green is primary?", why: "Buttons", options: ["A", "B", "C", "D", "E", "A"], recommended: "Z" },
          { text: "Dark theme?", why: "", options: ["Theme", "Exception"], recommended: "Theme" },
          { text: "Third?", why: "", options: ["x", "y"], recommended: "x" },
        ],
      },
      ctx,
    );
    expect(s.questions.map((q) => q.id)).toEqual(["ai-1", "ai-2"]);
    expect(s.questions[0].options).toEqual(["A", "B", "C", "D"]);
    expect(s.questions[0].recommended).toBe("");
    expect(s.questions[1].recommended).toBe("Theme");
  });

  it("recommends tokens when nothing was recognised, and reads the platform from the capture", () => {
    expect(sanitizeScan({ recommendation: { fetch: "extended", why: "" }, platform: "web" }, ctx)).toMatchObject({ recommendation: { fetch: "tokens" }, platform: "mobile" });
    expect(sanitizeScan({ platform: "mobile" }, { images: 1, kinds: ["desktop"] }).platform).toBe("web");
    expect(sanitizeScan({ platform: "dashboard" }, { images: 1, kinds: ["desktop"] }).platform).toBe("dashboard");
    expect(sanitizeScan(null, ctx)).toMatchObject({ components: [], candidates: [], questions: [] });
  });

  it("leaves the recorded sample as it is", () => {
    expect(sanitizeScan(SAMPLE_DS_SCAN, { images: 1, kinds: ["phone"] })).toEqual(SAMPLE_DS_SCAN);
    expect(SAMPLE_DS_SCAN.components.every((c) => SCAN_COMPONENTS.includes(c.name))).toBe(true);
  });
});
