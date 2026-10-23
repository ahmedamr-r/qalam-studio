import { describe, expect, it } from "vitest";
import type { Inst } from "./builders";
import { buildInstance, type BuildCtx, type LBox } from "./builders";
import { componentLookup, fillComposition } from "./custom";
import { withPatternProps, withProps } from "./component-props";
import { BUILTIN_DOCS, type ComponentDef, type Pattern } from "./docs";

const texts = (b: LBox): string[] => [...(b.text ? [b.text.content] : []), ...(b.children ?? []).flatMap(texts)];
const use = (name: string, values: Record<string, string>): Inst => ({ component: "Custom", props: { name, values: Object.entries(values).map(([prop, value]) => ({ prop, value })) } });
const ctx = (defs: ComponentDef[]): BuildCtx => ({ dir: "ltr", lang: "en", components: componentLookup(defs, []) });

// Components from different kinds of product, as an extraction writes them: parts with sample content, no props.
const dishTile: ComponentDef = {
  name: "MenuItemTile",
  purpose: "A dish in a menu grid",
  composition: {
    component: "Stack",
    props: { gap: "200" },
    children: [
      { component: "Image", props: { alt: "Half grilled chicken meal", aspect: "1:1", src: "" } },
      { component: "Tag", props: { label: "Top rated", tone: "brand" } },
      { component: "Text", props: { text: "Half Grilled Chicken Meal", style: "body-strong", maxLines: 2 } },
      { component: "Text", props: { text: "EGP 299.00", style: "body" } },
    ],
  },
};
const transaction: ComponentDef = {
  name: "TransactionRow",
  purpose: "A card payment in the activity feed",
  composition: {
    component: "Stack",
    props: { direction: "horizontal", gap: "300", align: "center" },
    children: [
      { component: "Icon", props: { icon: "coffee", tone: "secondary" } },
      { component: "Stack", props: { gap: "100" }, children: [{ component: "Text", props: { text: "Blue Bottle Coffee", style: "body-strong" } }, { component: "Text", props: { text: "Today, 9:41", style: "caption" } }] },
      { component: "Text", props: { text: "-$4.50", style: "body-strong" } },
    ],
  },
};
const statCard: ComponentDef = {
  name: "KpiCard",
  purpose: "A dashboard metric",
  composition: { component: "Card", props: { title: "Revenue" }, children: [{ component: "Text", props: { text: "$48,210", style: "title-lg" } }, { component: "Text", props: { text: "+12% vs last month", style: "caption" } }] },
};

describe("component props", () => {
  it("reads props from the parts, named by the job each does, whatever the product", () => {
    expect(withProps(dishTile).props!.map((p) => p.name)).toEqual(["image", "tag", "title", "value"]);
    expect(withProps(transaction).props!.map((p) => [p.name, p.kind])).toEqual([
      ["icon", "icon"],
      ["title", "text"],
      ["caption", "text"],
      ["value", "text"],
    ]);
    expect(withProps(statCard).props!.map((p) => p.name)).toEqual(["title", "value", "caption"]);
  });

  it("keeps the sample content as each prop's example, and leaves room for longer values", () => {
    const d = withProps(dishTile);
    expect(d.props!.find((p) => p.name === "title")).toMatchObject({ example: "Half Grilled Chicken Meal", kind: "text" });
    expect(d.props!.find((p) => p.name === "title")!.maxChars).toBeGreaterThan("Half Grilled Chicken Meal".length);
    // Left out, a prop shows its example: the component looks as extracted.
    expect(JSON.stringify(fillComposition(d, {}))).toContain("{title}");
    expect(texts(buildInstance(use("MenuItemTile", {}), ctx([d])))).toEqual(["Top rated", "Half Grilled Chicken Meal", "EGP 299.00"]);
  });

  it("is placed by name with new values (a dish, a payment, a metric)", () => {
    const defs = [dishTile, transaction, statCard].map((d) => withProps(d));
    expect(texts(buildInstance(use("MenuItemTile", { title: "Spicy Hawawshi", value: "EGP 135.00", tag: "Popular" }), ctx(defs)))).toEqual(["Popular", "Spicy Hawawshi", "EGP 135.00"]);
    expect(texts(buildInstance(use("TransactionRow", { title: "Uber", caption: "Yesterday", value: "-$18.20" }), ctx(defs)))).toEqual(["Uber", "Yesterday", "-$18.20"]);
    expect(texts(buildInstance(use("KpiCard", { title: "Orders", value: "1,204" }), ctx(defs)))).toContain("1,204");
  });

  it("keeps declared props the composition shows, and is stable when run again", () => {
    const cash: ComponentDef = { name: "Cash Card", purpose: "", props: [{ name: "last4", kind: "text", maxChars: 4, example: "4821" }], composition: { component: "Text", props: { text: "•••• {last4}" } } };
    expect(withProps(cash)).toBe(cash);
    const once = withProps(dishTile);
    expect(withProps(once)).toBe(once);
  });

  it("replaces declared props the composition never shows with ones read from it", () => {
    const broken: ComponentDef = { ...dishTile, props: [{ name: "dish", kind: "text", maxChars: 30, example: "x" }] };
    expect(withProps(broken).props!.map((p) => p.name)).toEqual(["image", "tag", "title", "value"]);
  });

  it("leaves a component with no content alone", () => {
    const divider: ComponentDef = { name: "Rule", purpose: "", composition: { component: "Divider", props: {} } };
    expect(withProps(divider)).toBe(divider);
  });

  it("gives a saved system's patterns props, and leaves docs without patterns as they are", () => {
    const pattern: Pattern = { ...dishTile, guide: BUILTIN_DOCS.components[0] };
    const docs = withPatternProps({ ...BUILTIN_DOCS, patterns: [pattern] });
    expect(docs.patterns[0].props?.length).toBe(4);
    expect(withPatternProps(BUILTIN_DOCS)).toBe(BUILTIN_DOCS);
  });
});
