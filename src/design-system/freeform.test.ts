import { describe, expect, it } from "vitest";
import { freeformGenerateSchema, GENERATE_SCHEMA } from "@/ai/schemas";
import { FREEFORM_BLOCK, FREEFORM_KEEP_NOTE } from "@/ai/prompts";
import { systemPayload } from "@/ai/ds-payload";
import { contrastFailures } from "./contrast";
import { isValid, validateTree } from "./contract";
import { defaultLook, isListed, lookSystem, sanitizeLook } from "./freeform";
import { pruneLooks, useSystems } from "./registry";
import { TokenSet } from "./resolve";

const EDITOR = {
  name: "Quiet studio",
  rationale: "A pro video editor reads dense and calm, so the chrome stays out of the footage's way.",
  adjectives: ["precise", "calm", "dense"],
  hue: 285,
  chroma: "muted",
  neutralTint: "cool",
  contrast: "high",
  radius: "small",
  density: "compact",
  bodySize: "14",
  typeRatio: "1.2",
  font: "IBM Plex Sans",
  displayFont: "IBM Plex Sans",
  arabicFont: "IBM Plex Sans Arabic",
  elevation: "hairline",
  fill: "outline",
  motion: "standard",
};

describe("looks for screens without a design system", () => {
  it("keeps the model's choices when each is one of its options", () => {
    const l = sanitizeLook(EDITOR, { brief: "A video editor for YouTubers", platform: "app" });
    expect(l.name).toBe("Quiet studio");
    expect(l.knobs).toMatchObject({ hue: 285, chroma: "muted", radius: "small", density: "compact", font: "IBM Plex Sans", elevation: "hairline", fill: "outline" });
    // The same face for headings is "same", as the interview stores it.
    expect(l.knobs.displayFont).toBe("same");
    expect(l.knobs.brandHex).toBeNull();
  });

  it("falls back for anything that isn't an option, and takes a brand colour only from the brief", () => {
    const l = sanitizeLook({ ...EDITOR, radius: "huge", font: "Comic Sans", hue: "red", arabicFont: "Arial" }, { brief: "Checkout for Kite, brand colour #FF5A1F", platform: "mobile" });
    const base = defaultLook("mobile").knobs;
    expect(l.knobs.radius).toBe(base.radius);
    expect(l.knobs.font).toBe(base.font);
    expect(l.knobs.arabicFont).toBe(base.arabicFont);
    expect(l.knobs.brandHex).toBe("#FF5A1F");
    // The hue follows the brand colour (orange-red), not the model's.
    expect(l.knobs.hue).toBeGreaterThan(20);
    expect(l.knobs.hue).toBeLessThan(60);
    // A brand colour the model made up is ignored.
    expect(sanitizeLook({ ...EDITOR, brandHex: "#00FF00" }, { brief: "A video editor" }).knobs.brandHex).toBeNull();
  });

  it("cuts a long rationale after a whole sentence", () => {
    const long = `${"Warm clay colours suit a plant app. ".repeat(9)}And then the rounded corners keep it friendly for everyone who opens it daily`;
    const r = sanitizeLook({ ...EDITOR, rationale: long }, { brief: "x" }).rationale;
    expect(r.length).toBeLessThanOrEqual(320);
    expect(r.endsWith("plant app.")).toBe(true);
  });

  it("names a look the model left unnamed after its hue", () => {
    expect(sanitizeLook({ ...EDITOR, name: "" }, { brief: "x" }).name).toMatch(/look$/);
    expect(sanitizeLook(null, { brief: "x" }).knobs).toEqual(defaultLook().knobs);
  });

  it("builds a complete, legible system the pickers don't list until it is saved", () => {
    const l = sanitizeLook(EDITOR, { brief: "A video editor", platform: "app" });
    const ds = lookSystem(l, { platform: "app", projectId: "p1", id: "look-test", now: 1 });
    expect(ds).toMatchObject({ id: "look-test", name: "Quiet studio", source: "freeform", projectId: "p1", look: { rationale: l.rationale, knobs: l.knobs } });
    expect(isValid(validateTree(ds.tree))).toBe(true);
    expect(contrastFailures(ds.tree)).toEqual([]);
    expect(ds.fonts.map((f) => f.family)).toContain("IBM Plex Sans");
    expect(new TokenSet(ds.tree).typography("type.body")?.fontSize).toBe(14);
    expect(ds.docs.language.summary).toBe(l.rationale);
    expect(isListed(ds)).toBe(false);
    expect(isListed({ ...ds, kept: true })).toBe(true);
    expect(isListed({ source: "extracted" })).toBe(true);
    // Its prompt payload is an ordinary system's (follow-ups describe the look the screens keep).
    expect(systemPayload(ds).tokens?.length).toBeGreaterThan(50);
  });

  it("asks for the look right after the approach, before the screens", () => {
    const fresh = freeformGenerateSchema(false) as { properties: Record<string, { anyOf?: unknown[]; required?: string[] }>; required: string[] };
    expect(Object.keys(fresh.properties).slice(0, 3)).toEqual(["approach", "style", "newComponents"]);
    expect(fresh.required).toContain("style");
    expect(fresh.properties.style.required).toEqual(expect.arrayContaining(["name", "rationale", "hue", "font", "radius"]));
    // Continuing screens with a look: null keeps it.
    const keep = freeformGenerateSchema(true) as { properties: Record<string, { anyOf?: { type?: string }[] }> };
    expect(keep.properties.style.anyOf?.some((s) => s.type === "null")).toBe(true);
    // The design-system schema is untouched.
    expect(Object.keys(GENERATE_SCHEMA.properties as object)).not.toContain("style");
    expect(FREEFORM_BLOCK).toContain('"style"');
    expect(FREEFORM_KEEP_NOTE).toContain("null");
  });

  it("drops a project's unused looks when it opens, keeping saved ones and other projects'", () => {
    const mk = (id: string, projectId: string, kept?: boolean) => ({ ...lookSystem(defaultLook(), { id, projectId, now: 1 }), ...(kept ? { kept } : {}) });
    const before = useSystems.getState().systems;
    useSystems.setState({ systems: [...before, mk("look-used", "p1"), mk("look-gone", "p1"), mk("look-saved", "p1", true), mk("look-other", "p2")] });
    pruneLooks("p1", new Set(["look-used"]));
    const ids = useSystems.getState().systems.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["look-used", "look-saved", "look-other"]));
    expect(ids).not.toContain("look-gone");
    useSystems.setState({ systems: before });
  });
});
