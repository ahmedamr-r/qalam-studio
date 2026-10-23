import { describe, expect, it } from "vitest";
import { lintSpec } from "./spec-lint";
import type { ScreenSpec } from "./builders";
import { DEMO_SCREENS } from "@/ui/demo";

const rules = (s: ScreenSpec) => lintSpec(s).map((i) => i.rule);
const screen = (p: Partial<ScreenSpec>): ScreenSpec => ({ name: "Test", body: [{ component: "Text", props: { text: "Your orders" } }], ...p });

describe("spec checks", () => {
  it("passes the hand-made demo screens", () => {
    for (const s of DEMO_SCREENS) expect(lintSpec(s)).toEqual([]);
  });

  it("reports builder problems at their spec path", () => {
    const issues = lintSpec(screen({ body: [{ component: "Stack", children: [{ component: "Button", props: { label: "Confirm your pickup location now", icon: "rocket-ship" } }] }] }));
    expect(issues.find((i) => i.rule === "char-limit")?.path).toBe("body.0.children.0");
    expect(issues.find((i) => i.rule === "unknown-icon")?.path).toBe("body.0.children.0");
  });

  it("catches placeholder and hype copy", () => {
    expect(rules(screen({ body: [{ component: "ListItem", props: { title: "Item 1", subtitle: "Lorem ipsum dolor" } }] }))).toContain("placeholder-copy");
    expect(rules(screen({ body: [{ component: "Text", props: { text: "Unlock amazing deals!" } }] }))).toContain("hype-copy");
  });

  it("allows one primary action", () => {
    const b = (label: string) => ({ component: "Button", props: { label, variant: "primary" } });
    expect(rules(screen({ body: [b("Pay now")], footer: [b("Continue")] }))).toContain("one-primary");
  });

  it("flags one Card per list row and crowded phone rows", () => {
    const card = (t: string) => ({ component: "Card", children: [{ component: "ListItem", props: { title: t } }] });
    expect(rules(screen({ body: [card("Home"), card("Work"), card("Gym")] }))).toContain("card-per-row");
    const row = { component: "Stack", props: { direction: "horizontal" }, children: ["A", "B", "C", "D"].map((t) => ({ component: "Avatar", props: { initials: t } })) };
    expect(rules(screen({ body: [row] }))).toContain("crowded-row");
  });

  it("flags phone chrome on web and a heading that repeats the top bar", () => {
    expect(rules(screen({ platform: "web", header: [{ component: "TopBar", props: { title: "Pricing" } }] }))).toContain("wrong-platform");
    expect(rules(screen({ header: [{ component: "TopBar", props: { title: "Your orders" } }] }))).toContain("repeated-title");
  });

  it("flags identical numbers, identical icons and inconsistent data", () => {
    const row = (t: string) => ({ component: "ListItem", props: { title: t, leadingIcon: "star", trailing: "text", trailingText: "AED 25.00" } });
    const r = rules(screen({ body: [row("Shawarma"), row("Falafel"), row("Hummus"), row("Fattoush")] }));
    expect(r).toContain("same-numbers");
    expect(r).toContain("same-icon");
    expect(rules(screen({ body: [{ component: "Chart", props: { labels: ["Mon", "Tue", "Wed"], values: [3, 4] } }] }))).toContain("chart-data");
  });

  it("lets desktop apps have a start panel, and checks their parts", () => {
    const side = [{ component: "Tabs", props: { tabs: ["Media", "Audio"], selected: 0 } }];
    expect(rules(screen({ platform: "app", sidebar: side }))).not.toContain("wrong-platform");
    expect(rules(screen({ platform: "web", sidebar: side }))).toContain("wrong-platform");
    expect(rules(screen({ platform: "app", hero: [{ component: "Text", props: { text: "Harbour promo" } }] }))).toContain("wrong-platform");
    const timeline = (clips: { start: number; end: number }[]) => screen({ platform: "app", footer: [{ component: "Timeline", props: { duration: 60, tracks: [{ label: "V1", kind: "video", clips: clips.map((c, i) => ({ label: `Shot ${i + 1}`, ...c })) }] } }] });
    expect(rules(timeline([{ start: 10, end: 5 }]))).toContain("timeline-data");
    expect(rules(timeline([{ start: 0, end: 90 }]))).toContain("timeline-data");
    expect(rules(timeline([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 30 }]))).toContain("same-numbers");
    expect(rules(timeline([{ start: 0, end: 12 }, { start: 12, end: 31 }, { start: 31, end: 38 }]))).toEqual([]);
    // "Text" names a track kind, a tab or a tool in an editor; it's only placeholder copy where it fills a slot.
    const named = screen({
      platform: "app",
      header: [{ component: "Toolbar", props: { tools: [{ icon: "type", label: "Text" }, { icon: "crop", label: "Crop" }], selected: 0 } }],
      sidebar: [{ component: "Tabs", props: { tabs: ["Media", "Audio", "Text"], selected: 0 } }],
      footer: [{ component: "Timeline", props: { duration: 60, tracks: [{ label: "Captions", kind: "text", clips: [{ label: "Opening title", start: 2, end: 9 }] }] } }],
    });
    expect(rules(named)).not.toContain("placeholder-copy");
    expect(rules(screen({ body: [{ component: "Text", props: { text: "Text" } }] }))).toContain("placeholder-copy");
    const panel = { component: "Panel", props: { title: "Clip" }, children: [{ component: "Slider", props: { label: "Speed", value: 50, valueText: "1.0×" } }] };
    expect(rules(screen({ platform: "app", body: [panel] }))).toContain("panel-placement");
    expect(rules(screen({ platform: "app", body: [{ component: "Stack", props: { direction: "horizontal" }, children: [{ component: "Player", props: { label: "Shot 2" } }, panel] }] }))).toEqual([]);
  });
});

describe("a system's own components", () => {
  const plan = {
    name: "PlanCard",
    purpose: "A subscription plan",
    composition: { component: "Card", children: [{ component: "Text", props: { text: "Pro", style: "headline" } }, { component: "Text", props: { text: "$12 / month" } }, { component: "Button", props: { label: "Choose", variant: "secondary" } }] },
  };
  const copy = (name: string, price: string) => ({ component: "Card", children: [{ component: "Text", props: { text: name, style: "headline" } }, { component: "Text", props: { text: price } }, { component: "Button", props: { label: "Choose", variant: "secondary" } }] });

  it("flags a copy of one built from its parts, at the copy, naming the props to fill", () => {
    const issues = lintSpec(screen({ body: [{ component: "Stack", props: { direction: "horizontal" }, children: [copy("Basic", "$0"), copy("Team", "$40 / month")] }] }), undefined, [plan]);
    const found = issues.filter((i) => i.rule === "rebuilt-component");
    expect(found.map((i) => i.path)).toEqual(["body.0.children.0", "body.0.children.1"]);
    expect(found[0].message).toContain('Custom (name "PlanCard")');
    expect(found[0].message).toContain("title, text, action");
  });

  it("leaves placed instances, and look-alikes with other parts, alone", () => {
    const placed = { component: "Custom", props: { name: "PlanCard", values: [{ prop: "title", value: "Basic" }] } };
    const other = { component: "Card", children: [{ component: "Text", props: { text: "Pro" } }, { component: "Text", props: { text: "$12" } }] };
    const issues = lintSpec(screen({ body: [placed, other] }), undefined, [plan]);
    expect(issues.some((i) => i.rule === "rebuilt-component")).toBe(false);
  });
});
