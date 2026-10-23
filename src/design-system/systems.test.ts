import { afterAll, beforeAll, describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { completeTree, validateTree, isValid, setToken, upgradeTree, ROLE_SPECS } from "./contract";
import { buildScreen } from "./builders";
import { useSystems, type DesignSystem } from "./registry";
import { BUILTIN_DOCS } from "./docs";
import { insertScreens } from "./place";
import { applyDesignSystem, isEdited } from "./apply";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { setAutoLayoutEnabled } from "@/doc/autolayout";
import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import { auditSubtree, auditNode } from "@/lint/rules";
import type { SceneNode } from "@/doc/schema";
import { DEMO_SCREENS } from "@/ui/demo";

/** A deliberately different system: square-ish buttons, outlined flat cards, recessed inputs, gradient CTA. */
function altTree(): Tree {
  const t = structuredClone(raw) as Tree;
  const set = (path: string, value: unknown, type?: string) => setToken(t, path, type ? { $type: type, $value: value } : { $value: value });
  set("radius.pill", "8px", "dimension");
  set("component.button.radius", "{radius.sm}");
  set("component.button.height-lg", "56px", "dimension");
  set("component.input.shadow", [{ color: "#00000014", offsetX: "0px", offsetY: "2px", blur: "4px", spread: "0px", inset: true }], "shadow");
  set("component.card.flat.border-width", "{border-width.default}");
  set("component.card.raised.shadow", [
    { color: "#0000000F", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" },
    { color: "#0000001A", offsetX: "0px", offsetY: "8px", blur: "24px", spread: "-4px" },
  ], "shadow");
  set("gradient.brand", { kind: "linear", angle: 90, stops: [{ color: "#6D28D9", position: 0 }, { color: "#DB2777", position: 1 }] }, "gradient");
  set("component.button.primary.fill", "{gradient.brand}");
  set("layout.gutter", "20px", "dimension");
  return t;
}

const ALT: DesignSystem = { id: "alt", name: "Alt", source: "extracted", tree: altTree(), docs: BUILTIN_DOCS, fonts: [], createdAt: 1, updatedAt: 1 };

describe("role contract", () => {
  it("the built-in tree fulfils it", () => {
    expect(validateTree(raw as Tree)).toEqual({ missing: [], wrongType: [], unresolved: [] });
    expect(ROLE_SPECS.length).toBeGreaterThan(150);
  });

  it("completes a partial tree with literal built-in values", () => {
    const partial: Tree = { bg: { $type: "color", canvas: { $value: "#101010" } }, text: { primary: { $value: "{color.nope}" } } };
    const { tree, filled } = completeTree(partial);
    expect(isValid(validateTree(tree))).toBe(true);
    const ts = new TokenSet(tree);
    expect(ts.color("bg.canvas")).toBe("#101010");
    expect(filled).toContain("text.primary"); // dangling alias replaced
    expect(ts.color("text.primary")).toBe(BUILTIN.color("text.primary"));
    expect(ts.get("bg.brand")?.aliasOf).toBeUndefined(); // literal, not an alias into built-in primitives
  });

  it("upgrades a stored system that predates new components with references to its own roles", () => {
    const t = structuredClone(raw) as Tree;
    delete (t.component as Record<string, unknown>).tabs;
    setToken(t, "bg.brand-strong", { $type: "color", $value: "#123456" });
    const up = new TokenSet(upgradeTree(t));
    expect(isValid(validateTree(upgradeTree(t)))).toBe(true);
    expect(up.get("component.tabs.indicator")?.aliasOf).toBe("bg.brand-strong");
    expect(up.color("component.tabs.indicator")).toBe("#123456");
  });

  it("resolves aliases inside multi-layer shadows and gradients", () => {
    const ts = new TokenSet(altTree());
    expect(ts.shadowLayers("component.card.raised.shadow")).toHaveLength(2);
    expect(ts.shadowLayers("component.input.shadow")?.[0].kind).toBe("inner");
    expect(ts.paint("component.button.primary.fill")?.gradient?.stops[1].color).toBe("#DB2777");
    expect(ts.unresolved()).toEqual([]);
  });
});

describe("building with another system", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("changes the look without unknown tokens", () => {
    const ts = new TokenSet(altTree());
    const spec = DEMO_SCREENS[0];
    const a = layoutToNodes(buildScreen(spec), { dir: "ltr", lang: "en" }, { x: 0, y: 0 });
    const b = layoutToNodes(buildScreen(spec, ts), { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 });
    const flags = b.flatMap((n) => n.meta.flags ?? []).map((f) => f.rule);
    expect(flags).not.toContain("unknown-token");
    const content = (ns: SceneNode[]) => ns.find((n) => n.name === "Content")!;
    expect(content(b).x).toBe(0);
    const pad = (ns: SceneNode[]) => ns.find((n) => n.parentId === content(ns).id && n.meta.component !== "Map")!.x;
    // Phone screens take their side margins from the system's gutter (20px here, 16px built in)…
    expect(pad(b)).toBe(20);
    expect(pad(a)).toBe(16);
    // …null means the same default…
    const n = layoutToNodes(buildScreen({ ...spec, margin: null }, ts), { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 });
    expect(pad(n)).toBe(20);
    // …and a number means the brief asked for other margins.
    const c = layoutToNodes(buildScreen({ ...spec, margin: 24 }, ts), { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 });
    expect(pad(c)).toBe(24);
  });

  it("draws inner shadows on inputs and gradients on primary buttons", () => {
    const ts = new TokenSet(altTree());
    const box = buildScreen({ name: "Form", body: [{ component: "TextField", props: { label: "Email" } }], footer: [{ component: "Button", props: { label: "Continue", variant: "primary", size: "lg", fullWidth: true } }] }, ts);
    const nodes = layoutToNodes(box, { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 });
    const input = nodes.find((n) => n.name === "Input")!;
    expect(input.effects?.[0].kind).toBe("inner");
    const btn = nodes.find((n) => n.meta.component === "Button/Primary")!;
    expect(btn.fill?.gradient?.kind).toBe("linear");
    expect(btn.radius?.tl.rx).toBe(8);
    expect(btn.h).toBe(56);
    expect(btn.meta.specPath).toBe("footer.0");
  });
});

describe("screens bound to systems", () => {
  beforeAll(async () => {
    await ensureYoga();
    setAutoLayoutEnabled(true);
    useSystems.getState().add(ALT, false);
  });
  afterAll(() => void setAutoLayoutEnabled(false));

  it("lints each screen against its own system", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[0]], "ai", "alt");
    const doc = studio().doc;
    expect(doc.nodes[id].meta.designSystem).toBe("alt");
    expect(auditSubtree(doc, [id]).filter((f) => f.rule === "token-drift")).toEqual([]);
    // Against the built-in system the same nodes drift (e.g. the 20px gutter, the gradient CTA).
    const drift = [id, ...descendants(doc, id)].flatMap((n) => auditNode(doc, doc.nodes[n], BUILTIN)).filter((f) => f.rule === "token-drift");
    expect(drift.length).toBeGreaterThan(0);
  });

  it("rebuilds and reskins in one undo step each", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[1]], "ai", "builtin");
    const before = studio().doc;
    const past = studio().past.length;
    await applyDesignSystem([id], "alt", "rebuild");
    expect(studio().past.length).toBe(past + 1);
    expect(studio().doc.nodes[id].meta.designSystem).toBe("alt");
    expect(isEdited(studio().doc, id)).toBe(false);
    studio().undo();
    expect(studio().doc).toBe(before);

    await applyDesignSystem([id], "alt", "reskin");
    expect(studio().past.length).toBe(past + 1);
    const after = studio().doc;
    expect(auditSubtree(after, [id]).filter((f) => f.rule === "token-drift")).toEqual([]);
    studio().undo();
    expect(studio().doc).toBe(before);
  });

  it("notices hand edits to a built screen", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[0]], "ai", "builtin");
    // Moving an auto-layout child by hand snaps back, so it isn't an edit; changing its text is.
    const child = descendants(studio().doc, id)[3];
    studio().mutate((d) => void (d.nodes[child].x += 30));
    expect(isEdited(studio().doc, id)).toBe(false);
    const text = descendants(studio().doc, id).find((n) => studio().doc.nodes[n].type === "text")!;
    studio().mutate((d) => {
      const n = d.nodes[text];
      if (n.type === "text") n.text.content = "A different, longer label";
    });
    expect(isEdited(studio().doc, id)).toBe(true);
  });

  it("a reskin leaves a built screen unedited", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[2]], "ai", "builtin");
    await applyDesignSystem([id], "alt", "reskin");
    expect(isEdited(studio().doc, id)).toBe(false);
  });
});

describe("AI restyle scope", () => {
  it("keeps everything outside the targeted parts", async () => {
    const { spliceTargets } = await import("@/ui/systems");
    const original = { name: "S", body: [{ component: "Text", props: { text: "Keep" } }, { component: "Card", props: { tone: "surface" }, children: [{ component: "Text", props: { text: "Old" } }] }] };
    const revised = { name: "S", body: [{ component: "Text", props: { text: "Changed anyway" } }, { component: "Card", props: { tone: "raised" }, children: [{ component: "Text", props: { text: "New" } }] }] };
    const out = spliceTargets(original, revised, ["body.1"]);
    expect(out.body[0].props?.text).toBe("Keep");
    expect(out.body[1].props?.tone).toBe("raised");
    expect(spliceTargets(original, { name: "S", body: [] }, ["body.1"])).toEqual({ name: "S", body: [] });
  });
});
