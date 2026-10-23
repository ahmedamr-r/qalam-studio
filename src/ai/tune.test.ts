import { describe, expect, it } from "vitest";
import { TUNE_SCHEMA, TuneBody, buildTuneContent, type TuneRequest } from "./tune";
import { SAMPLE_TUNE } from "./fixtures-tune";
import { systemPayload } from "./ds-payload";
import { blockFor } from "./prompts";
import { BUILTIN_SYSTEM } from "@/design-system/registry";
import { applyChanges } from "@/design-system/tune";
import { tunePayload } from "@/ui/ai/tune";
import { DEMO_SCREENS } from "@/ui/demo";

const body = (p: Partial<TuneRequest> = {}): TuneRequest => ({ feedback: "Cards feel heavy and everything is boxed", system: tunePayload(BUILTIN_SYSTEM), screens: [], ...p });

describe("tune system request", () => {
  it("accepts the whole contract as editable tokens and rejects empty feedback", () => {
    expect(TuneBody.safeParse(body()).success).toBe(true);
    expect(TuneBody.safeParse(body({ feedback: " " })).success).toBe(false);
    expect(body().system.tokens.length).toBeGreaterThan(200);
  });

  it("shows tokens as authored and resolved, the guidance lists, and the feedback", () => {
    const [text] = buildTuneContent(body()) as { type: string; text: string }[];
    expect(text.text).toContain("component.card.radius (dimension) = {radius.sm} → 8px");
    expect(text.text).toContain("layout.rules (Layout rules):");
    expect(text.text).toContain("- Lorem ipsum");
    expect(text.text).toContain("The designer's request for the design system:\nCards feel heavy");
  });

  it("puts each screen's render before the text, with its brief and spec", () => {
    const blocks = buildTuneContent(body({ screens: [{ name: "Tracking", spec: DEMO_SCREENS[0], image: "iVBORw0KGgo=", brief: "Track my food order" }] }));
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text"]);
    const text = (blocks[2] as { text: string }).text;
    expect(text).toContain('Screen 1, "Tracking", generated from the brief "Track my food order"');
    expect(text).toContain("The designer's feedback on this screen");
  });

  it("puts tuned rules in the prompt the generator reads", () => {
    const r = applyChanges(BUILTIN_SYSTEM.tree, BUILTIN_SYSTEM.docs, [
      { kind: "guidance", target: "Card.donts", op: "add", text: "One Card per list row", reason: "" },
      { kind: "guidance", target: "layout.rules", op: "add", text: "Lead with the arrival time", reason: "" },
    ]);
    const block = blockFor(systemPayload({ ...BUILTIN_SYSTEM, id: "tuned-x", name: "Qalam (tuned)", source: "imported", tree: r.tree, docs: r.docs }));
    // Each fact carries the id the model cites it by.
    expect(block).toMatch(/Rules: \[d\d+\] Lead with the arrival time;/);
    expect(block).toMatch(/- \[d\d+\] Card: .* Don't: One Card per list row\./);
    // The built-in prompt is unchanged (no component rules to print).
    expect(blockFor(systemPayload(BUILTIN_SYSTEM))).not.toContain("Component guides");
  });

  it("constrains paths and guidance targets in the schema, and the sample applies cleanly", () => {
    const props = TUNE_SCHEMA.properties as Record<string, { items: { properties: Record<string, { enum?: string[] }> } }>;
    expect(props.tokens.items.properties.path.enum).toContain("component.button.radius");
    expect(props.guidance.items.properties.target.enum).toContain("ListItem.dos");
    const changes = [...SAMPLE_TUNE.tokens.map((t) => ({ kind: "token" as const, ...t })), ...SAMPLE_TUNE.guidance.map((g) => ({ kind: "guidance" as const, ...g }))];
    expect(applyChanges(BUILTIN_SYSTEM.tree, BUILTIN_SYSTEM.docs, changes).problems.every((p) => p === null)).toBe(true);
  });
});

describe("component structure in prompts and Tune", () => {
  it("prints a system's structure for the generator, and nothing for the built-in look", () => {
    const r = applyChanges(BUILTIN_SYSTEM.tree, BUILTIN_SYSTEM.docs, [
      { kind: "token", path: "component.nav-bar.style.placement", value: "floating", reason: "the product's tab bar floats" },
      { kind: "token", path: "component.nav-bar.style.labels", value: "none", reason: "icons only" },
    ]);
    expect(r.problems).toEqual([null, null]);
    const block = blockFor(systemPayload({ ...BUILTIN_SYSTEM, id: "cash-x", name: "Cash", source: "imported", tree: r.tree, docs: { ...r.docs, gaps: [{ element: "Balance hero photo", workaround: "MediaPlaceholder" }] } }));
    expect(block).toMatch(/Component structure[^\n]*\n- BottomNav: placement: a rounded pill[^\n]*labels: icons only/);
    expect(block).toContain("Known catalog gaps");
    expect(block).not.toContain("component.nav-bar.style.placement =");
    expect(blockFor(systemPayload(BUILTIN_SYSTEM))).not.toContain("Component structure");
  });

  it("lets Tune pick a structure option, only from its listed values", () => {
    const table = buildTuneContent(body())
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");
    expect(table).toContain("component.nav-bar.style.placement (option: docked | floating) = docked");
    const r = applyChanges(BUILTIN_SYSTEM.tree, BUILTIN_SYSTEM.docs, [
      { kind: "token", path: "component.top-bar.style.title", value: "large", reason: "" },
      { kind: "token", path: "component.tabs.style.indicator", value: "{component.top-bar.style.title}", reason: "" },
      { kind: "token", path: "component.list-item.style.leading", value: "tinted", reason: "" },
    ]);
    expect(r.problems[0]).toBeNull();
    expect(r.problems[1]).toMatch(/one of underline, pill/);
    expect(r.problems[2]).toMatch(/one of contained, bare/);
  });
});
