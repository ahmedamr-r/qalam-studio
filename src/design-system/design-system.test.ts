import { describe, expect, it } from "vitest";
import { tokens, contrastRatio, flattenTokens, normalizeHex, wcagLevel } from "./resolve";
import { extractFromCSS, extractFromJSON, SAMPLE_CSS } from "./extract";
import { buildInstance, buildScreen } from "./builders";
import { CATALOG } from "./components";
import { DEMO_SCREENS } from "@/ui/demo";

describe("token resolution", () => {
  it("follows aliases to primitive values", () => {
    expect(tokens.color("bg.brand")).toBe("#8E9CFF");
    expect(tokens.get("bg.brand")?.aliasOf).toBe("color.ink.500");
    expect(tokens.color("text.secondary")).toBe("#5C5C5C");
  });

  it("keeps brand and success as separate tokens with their own colours", () => {
    expect(tokens.color("feedback.success")).not.toBe(tokens.color("bg.brand"));
    expect(tokens.colorMatches(tokens.color("bg.brand")!).map((t) => t.path)).not.toContain("feedback.success");
    expect(tokens.colorMatches(tokens.color("feedback.success")!).map((t) => t.path)).toContain("feedback.success");
  });

  it("resolves composite typography", () => {
    expect(tokens.typography("type.body")).toEqual({ fontFamily: "Inter", fontWeight: 400, fontSize: 13, lineHeight: 18, letterSpacing: 0 });
  });

  it("inherits $type from groups", () => {
    const flat = flattenTokens({ a: { $type: "color", b: { $value: "#fff" }, c: { $value: "{a.b}" } } });
    expect(flat.map((t) => [t.path, t.type, t.value])).toEqual([
      ["a.b", "color", "#FFFFFF"],
      ["a.c", "color", "#FFFFFF"],
    ]);
  });

  it("suggests the nearest token within a group", () => {
    expect(tokens.nearestColor("#F2F2F2", ["bg."])?.token.path).toBe("bg.surface");
    expect(tokens.nearestDimension(11, "radius.")?.token.path).toBe("radius.md");
  });
});

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(wcagLevel(contrastRatio("#8A8A8A", "#FFFFFF"))).toBe("AA Large");
    expect(wcagLevel(contrastRatio(tokens.color("text.secondary")!, "#FFFFFF"))).not.toBe("Fail");
  });

  it("brand label on forest passes AA", () => {
    expect(contrastRatio(tokens.color("text.on-brand-strong")!, tokens.color("bg.brand-strong")!)).toBeGreaterThan(4.5);
  });

  it("normalises colour syntax", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("rgba(0,0,0,.5)")).toBe("#00000080");
  });
});

describe("raw value extraction", () => {
  it("counts colours with their CSS contexts and resolves custom properties", () => {
    const raw = extractFromCSS(SAMPLE_CSS);
    const green = raw.find((r) => r.value === "#00A651")!;
    expect(green.kind).toBe("color");
    expect(green.contexts.join(" ")).toMatch(/btn-primary/);
    expect(green.contexts.join(" ")).toMatch(/toast--success/);
    expect(raw.find((r) => r.value === "#00A650")).toBeTruthy();
    expect(raw.find((r) => r.kind === "dimension" && r.value === "14px")).toBeTruthy();
  });

  it("reads DTCG JSON and skips aliases", () => {
    const raw = extractFromJSON(JSON.stringify({ color: { brand: { $value: "#8E9CFF" }, alias: { $value: "{color.brand}" } }, radius: { md: { $value: "12px" } } }));
    expect(raw.map((r) => r.value)).toEqual(expect.arrayContaining(["#8E9CFF", "12px"]));
    expect(raw).toHaveLength(2);
  });
});

describe("builders", () => {
  it("flags components that are not in the system", () => {
    const box = buildInstance({ component: "VideoPlayer", props: {} }, { dir: "ltr", lang: "en" });
    expect(box.flags?.[0].rule).toBe("not-in-system");
  });

  it("flags copy over the character limit and bad enum values", () => {
    const box = buildInstance({ component: "Button", props: { label: "Confirm and pay for your order now please", variant: "neon" } }, { dir: "ltr", lang: "en" });
    const rules = box.flags?.map((f) => f.rule);
    expect(rules).toContain("char-limit");
    expect(rules).toContain("off-system-value");
  });

  it("mirrors directional icons in RTL", () => {
    const box = buildInstance({ component: "TopBar", props: { title: "طلبك", leading: "back" } }, { dir: "rtl", lang: "ar" });
    const icon = box.children![0].children![0];
    expect(icon.icon?.name).toBe("arrow-left");
    expect(icon.icon?.mirrored).toBe(true);
  });

  it("every catalog example builds without flags", () => {
    for (const c of CATALOG) {
      const box = buildInstance({ component: c.name, props: c.example, children: c.exampleChildren }, { dir: "ltr", lang: "en" });
      expect(box.flags ?? [], c.name).toEqual([]);
    }
  });

  it("demo screens build", () => {
    for (const s of DEMO_SCREENS) expect(buildScreen(s).children!.length).toBeGreaterThan(3);
  });
});
