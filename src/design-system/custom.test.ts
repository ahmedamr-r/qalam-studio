import { afterAll, beforeAll, describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { BUILTIN_DOCS, type ComponentDef, type Pattern } from "./docs";
import { BUILTIN_ID, useSystems, type DesignSystem } from "./registry";
import type { Tree } from "./resolve";
import { buildInstance, type BuildCtx, type Inst, type LBox, type ScreenSpec } from "./builders";
import { componentLookup, customNames, fillComposition, mergeDefs, usedDefs } from "./custom";
import { insertScreens } from "./place";
import { refreshRoot, staleRoots } from "./refresh";
import { isOverridden } from "./instances";
import { ensureYoga } from "@/engine/layout";
import { setAutoLayoutEnabled } from "@/doc/autolayout";
import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import type { TextNode } from "@/doc/schema";

const cashCard: ComponentDef = {
  name: "Cash Card",
  purpose: "The member's debit card, on the Money tab and in Pay",
  props: [
    { name: "last4", kind: "text", maxChars: 4, example: "4821" },
    { name: "holder", kind: "text", maxChars: 24, example: "Sara Ahmed" },
  ],
  composition: {
    component: "Graphic",
    props: {
      label: "Cash Card",
      width: 240,
      height: 150,
      shapes: [
        { kind: "rect", x: 0, y: 0, w: 240, h: 150, fill: "bg.brand-strong", radius: "xl" },
        { kind: "text", x: 20, y: 18, w: 160, text: "{holder}", style: "body-strong", fill: "text.on-brand-strong" },
        { kind: "text", x: 20, y: 110, w: 160, text: "•••• {last4}", style: "body", fill: "text.on-brand-strong" },
      ],
    },
  },
};

const use = (values: Record<string, string> = {}, name = "Cash Card"): Inst => ({ component: "Custom", props: { name, values: Object.entries(values).map(([prop, value]) => ({ prop, value })) } });
const ctxWith = (system: ComponentDef[] = [], local: ComponentDef[] = []): BuildCtx => ({ dir: "ltr", lang: "en", components: componentLookup(system, local) });
const texts = (b: LBox): string[] => [...(b.text ? [b.text.content] : []), ...(b.children ?? []).flatMap(texts)];
const rules = (b: LBox) => (b.flags ?? []).map((f) => f.rule);

describe("Custom components", () => {
  it("finds a component by a loose name, the system's before the screen's", () => {
    const local = { ...cashCard, purpose: "local" };
    const sys = { ...cashCard, purpose: "system" };
    expect(componentLookup([sys], [local])("cash-card")).toMatchObject({ from: "system", def: { purpose: "system" } });
    expect(componentLookup([], [local])("CashCard")).toMatchObject({ from: "local" });
    expect(componentLookup([], [])("Cash Card")).toBeUndefined();
  });

  it("fills declared props, with each prop's example when it's left out", () => {
    const filled = fillComposition(cashCard, { last4: "9012", holder: "Omar", other: "x" });
    expect(JSON.stringify(filled)).toContain("•••• 9012");
    expect(JSON.stringify(filled)).toContain('"Omar"');
    const box = buildInstance(use({ last4: "9012" }), ctxWith([cashCard]));
    expect(texts(box)).toEqual(["Sara Ahmed", "•••• 9012"]);
    expect(box.name).toBe("Cash Card");
    expect(box.component).toBe("Custom/Cash Card");
  });

  it("checks values against the component's props", () => {
    const box = buildInstance(use({ last4: "901234", pin: "1" }), ctxWith([cashCard]));
    expect(rules(box)).toEqual(expect.arrayContaining(["char-limit", "unknown-prop"]));
  });

  it("marks a component made for the screen until it's in the system", () => {
    expect(rules(buildInstance(use(), ctxWith([], [cashCard])))).toContain("local-component");
    expect(rules(buildInstance(use(), ctxWith([cashCard])))).not.toContain("local-component");
  });

  it("shows an error box for an unknown component, and doesn't nest made components", () => {
    const missing = buildInstance(use({}, "Gift Card"), ctxWith([cashCard]));
    expect(rules(missing)).toContain("not-in-system");
    const wrapper: ComponentDef = { name: "Wallet", purpose: "", composition: { component: "Stack", children: [use()] } };
    const box = buildInstance(use({}, "Wallet"), ctxWith([cashCard, wrapper]));
    const nested = (b: LBox): string[] => [...rules(b), ...(b.children ?? []).flatMap(nested)];
    expect(nested(box)).toContain("nested-custom");
  });

  it("builds its parts as one instance: only the top has a spec path", () => {
    const box = buildInstance(use(), ctxWith([cashCard]), "body.0");
    expect(box.specPath).toBe("body.0");
    const paths = (b: LBox): (string | undefined)[] => (b.children ?? []).flatMap((c) => [c.specPath, ...paths(c)]);
    expect(paths(box).filter(Boolean)).toEqual([]);
  });

  it("lists and merges the components a screen places", () => {
    const list: Inst[] = [{ component: "Stack", children: [use(), use({}, "Gift Card")] }];
    expect(customNames(list)).toEqual(["Cash Card", "Gift Card"]);
    expect(usedDefs(list, [cashCard, { ...cashCard, name: "Other" }]).map((d) => d.name)).toEqual(["Cash Card"]);
    expect(mergeDefs([cashCard], [{ ...cashCard, purpose: "new" }])).toEqual([{ ...cashCard, purpose: "new" }]);
  });
});

describe("linked instances follow their component", () => {
  const pattern: Pattern = { ...cashCard, origin: "ai", guide: { ...BUILTIN_DOCS.components[0], component: "Cash Card" } };
  const MINE: DesignSystem = { id: "mine-custom", name: "Mine", source: "imported", tree: structuredClone(raw) as Tree, docs: { ...BUILTIN_DOCS, patterns: [pattern] }, fonts: [], createdAt: 1, updatedAt: 1 };
  const refresh = () => studio().mutate((d) => staleRoots(d).forEach((id) => refreshRoot(d, id)), { history: false });
  const textsIn = (id: string) =>
    descendants(studio().doc, id)
      .map((k) => studio().doc.nodes[k])
      .filter((n): n is TextNode => n.type === "text")
      .map((n) => n.text.content);

  beforeAll(async () => {
    await ensureYoga();
    setAutoLayoutEnabled(true);
    useSystems.getState().add(MINE, false);
  });
  afterAll(() => {
    setAutoLayoutEnabled(false);
    useSystems.setState({ activeId: BUILTIN_ID });
  });

  it("rebuilds every untouched instance when the component changes in the system", async () => {
    const spec: ScreenSpec = { name: "Money", body: [use({ last4: "1111" }), use({ last4: "2222" })] };
    const [id] = await insertScreens([spec], "ai", MINE.id);
    expect(textsIn(id)).toEqual(expect.arrayContaining(["•••• 1111", "•••• 2222"]));
    const cards = descendants(studio().doc, id).filter((k) => studio().doc.nodes[k].meta.component === "Custom/Cash Card");
    expect(cards).toHaveLength(2);

    // Change one instance by hand: it's an override and keeps its change.
    const holder = descendants(studio().doc, cards[1]).find((k) => (studio().doc.nodes[k] as TextNode).text?.content === "Sara Ahmed")!;
    studio().mutate((d) => void ((d.nodes[holder] as TextNode).text.content = "Mine"));
    expect(isOverridden(studio().doc, cards[1])).toBe(true);

    // The component changes in the system: the card number now reads "Card ending …".
    const ds = useSystems.getState().systems.find((s) => s.id === MINE.id)!;
    const next = structuredClone(pattern);
    ((next.composition.props!.shapes as { text?: string }[])[2]).text = "Card ending {last4}";
    useSystems.getState().update(MINE.id, { docs: { ...ds.docs, patterns: [next] }, updatedAt: ds.updatedAt + 1 });
    expect(staleRoots(studio().doc)).toContain(id);
    refresh();
    const after = textsIn(id);
    expect(after).toContain("Card ending 1111");
    // The edited screen is reskinned instance by instance: the overridden card keeps its text.
    expect(after).toContain("Mine");
  });
});
