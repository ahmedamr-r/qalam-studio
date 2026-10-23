import { describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { BUILTIN_DOCS } from "./docs";
import { TokenSet, type Tree } from "./resolve";
import { isValid, validateTree } from "./contract";
import { GUIDANCE_TARGETS, TUNABLE_PATHS, applyChanges, guidanceLabel, guidanceLists, parseTokenValue, revertChanges, type SystemChange } from "./tune";

const tree = raw as Tree;
const ts = new TokenSet(tree);
const tok = (path: string, value: string): SystemChange => ({ kind: "token", path, value, reason: "" });
const rule = (target: string, op: "add" | "remove", text: string): SystemChange => ({ kind: "guidance", target, op, text, reason: "" });

describe("tuning a design system", () => {
  it("covers every contract path and a list per component", () => {
    expect(TUNABLE_PATHS).toContain("component.card.raised.shadow");
    expect(TUNABLE_PATHS).toContain("layout.section-gap");
    expect(GUIDANCE_TARGETS).toContain("layout.rules");
    expect(GUIDANCE_TARGETS).toContain("Card.donts");
    expect(guidanceLabel("Card.whenNotToUse")).toBe("Card · Avoid when");
  });

  it("parses values in the token's own type", () => {
    expect(parseTokenValue(ts, "radius.lg", "12")).toEqual({ value: "12px" });
    expect(parseTokenValue(ts, "bg.surface", "#f4f4f4")).toEqual({ value: "#F4F4F4" });
    expect(parseTokenValue(ts, "component.card.radius", "{radius.md}")).toEqual({ value: "{radius.md}" });
    expect(parseTokenValue(ts, "component.card.radius", "{bg.surface}")).toHaveProperty("error");
    expect(parseTokenValue(ts, "radius.lg", "big")).toHaveProperty("error");
    expect(parseTokenValue(ts, "color.ink.500", "#000000")).toHaveProperty("error");
    const t = parseTokenValue(ts, "type.title", '{"fontSize":22,"fontWeight":650}');
    expect(t).toEqual({ value: expect.objectContaining({ fontFamily: "{font.family.latin}", fontSize: "22px", fontWeight: 700, lineHeight: "26px" }) });
    expect(parseTokenValue(ts, "component.card.raised.shadow", "[]")).toEqual({ value: [] });
  });

  it("applies token and guidance changes, skipping the ones that don't check out", () => {
    const r = applyChanges(tree, BUILTIN_DOCS, [
      tok("component.card.raised.shadow", "{shadow.none}"),
      tok("component.card.raised.border-width", "1"),
      tok("radius.lg", "nope"),
      rule("layout.rules", "add", "Group settings rows in one Card, separated by Dividers"),
      rule("Card.donts", "add", "One Card per list row"),
      rule("language.donts", "remove", "Lorem ipsum"),
      rule("language.donts", "remove", "Not a rule of this system"),
      rule("layout.rules", "add", "group settings rows in one card, separated by dividers"),
    ]);
    expect(r.problems.map((p) => p !== null)).toEqual([false, false, true, false, false, false, true, true]);
    const after = new TokenSet(r.tree);
    expect(after.shadowLayers("component.card.raised.shadow")).toEqual([]);
    expect(after.dimension("component.card.raised.border-width")).toBe(1);
    expect(after.get("component.card.raised.border-width")?.type).toBe("dimension");
    expect(isValid(validateTree(r.tree))).toBe(true);
    expect(r.docs.layout.rules[0]).toBe("Group settings rows in one Card, separated by Dividers");
    expect(r.docs.components.find((c) => c.component === "Card")?.donts).toEqual(["One Card per list row"]);
    expect(r.docs.language.donts).not.toContain("Lorem ipsum");
    // The inputs are untouched.
    expect(BUILTIN_DOCS.language.donts).toContain("Lorem ipsum");
    expect(ts.shadowLayers("component.card.raised.shadow")?.length).toBeGreaterThan(0);
    expect(guidanceLists(r.docs).map((l) => l.target)).toContain("Card.donts");
  });

  it("undoes exactly what it applied", () => {
    const r = applyChanges(tree, BUILTIN_DOCS, [
      tok("component.card.raised.shadow", '[{"color":"#00000014","offsetY":4,"blur":12}]'),
      tok("type.title", '{"fontSize":"22px"}'),
      rule("language.dos", "add", "Use one accent colour per screen"),
      rule("language.donts", "remove", "Lorem ipsum"),
    ]);
    expect(r.undo).toHaveLength(4);
    expect(new TokenSet(r.tree).shadowLayers("component.card.raised.shadow")?.[0]).toMatchObject({ y: 4, blur: 12 });
    const back = revertChanges(r.tree, r.docs, r.undo);
    expect(back.tree).toEqual(tree);
    expect(back.docs.language).toEqual(BUILTIN_DOCS.language);
  });
});

describe("gradient recipes", () => {
  it("lets a hero card take the brand gradient", () => {
    const r = applyChanges(raw as Tree, BUILTIN_DOCS, [{ kind: "token", path: "component.card.brand-fill", value: "{gradient.brand}", reason: "hero card" }]);
    expect(r.problems).toEqual([null]);
    expect(new TokenSet(r.tree).paint("component.card.brand-fill")?.gradient).toBeTruthy();
  });
});
