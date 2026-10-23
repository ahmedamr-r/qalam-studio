import { describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { addDetectedTokens, parseFont, parseShadow, tokenPath } from "./detective";
import { TokenSet, type Tree } from "./resolve";

describe("Detective tokens", () => {
  it("reads CSS font and box-shadow shorthands", () => {
    expect(parseFont("600 16px/24px Inter")).toMatchObject({ fontFamily: "Inter", fontWeight: 600, fontSize: "16px", lineHeight: "24px" });
    expect(parseFont("14px/1.5 'DM Sans', sans-serif")).toMatchObject({ fontFamily: "DM Sans", fontWeight: 400, lineHeight: "21px" });
    expect(parseShadow("0 2px 8px rgba(0,0,0,.08), inset 0 1px 0 #fff")).toEqual([
      { color: "#00000014", offsetX: "0px", offsetY: "2px", blur: "8px", spread: "0px" },
      { color: "#FFFFFF", offsetX: "0px", offsetY: "1px", blur: "0px", spread: "0px", inset: true },
    ]);
    expect(tokenPath(" Feedback/Success Subtle ")).toBe("feedback.success-subtle");
  });

  it("adds new tokens and leaves existing, reused and dropped ones alone", () => {
    const base = raw as Tree;
    const row = (name: string, type: "color" | "dimension" | "typography" | "shadow", value: string, action: "new-token" | "merge" | "reuse-existing" | "drop" = "new-token") => ({ name, type, value, intent: "test", usage: ".x", action });
    const r = addDetectedTokens(base, [
      row("bg.legacy-promo", "color", "#004D40"),
      row("radius.checkout", "dimension", "14"),
      row("type.price", "typography", "700 18px/24px Inter"),
      row("shadow.legacy-card", "shadow", "0 2px 8px rgba(0,0,0,.08)"),
      row("bg.canvas", "color", "#FFFFFF"),
      row("text.link", "color", "#0B5D32", "reuse-existing"),
      row("bg.junk", "color", "#123456", "drop"),
      row("bg.legacy-promo", "color", "#004D41", "merge"),
    ]);
    expect(r.added).toEqual(["bg.legacy-promo", "radius.checkout", "type.price", "shadow.legacy-card"]);
    expect(r.skipped.map((s) => s.name)).toEqual(["bg.canvas", "text.link"]);
    const ts = new TokenSet(r.tree);
    expect(ts.color("bg.legacy-promo")).toBe("#004D40");
    expect(ts.dimension("radius.checkout")).toBe(14);
    expect(ts.typography("type.price")?.fontSize).toBe(18);
    expect(ts.shadowLayers("shadow.legacy-card")).toHaveLength(1);
    expect(ts.unresolved()).toEqual([]);
  });
});
