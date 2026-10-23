import { describe, expect, it } from "vitest";
import { FixBody, buildFixContent, type FixRequest } from "./critique-fix";
import { sampleFix } from "./fixtures-critique";
import { systemPayload } from "./ds-payload";
import { BUILTIN_SYSTEM } from "@/design-system/registry";
import { BUILTIN } from "@/design-system/resolve";
import { buildScreen, type Inst } from "@/design-system/builders";
import { DEMO_SCREENS } from "@/ui/demo";

const body = (p: Partial<FixRequest> = {}): FixRequest => ({
  spec: DEMO_SCREENS[0],
  designSystem: systemPayload(BUILTIN_SYSTEM),
  context: { summary: "", goal: "Know when the food arrives", firstNotice: "The arrival time", primaryAction: "" },
  findings: [{ severity: "major", heuristic: "visual-hierarchy", issue: "ETA is small", fix: "Make it display size", at: 'body.1 · "ProgressTracker"' }],
  mustChange: [],
  ...p,
});

describe("critique fix request", () => {
  it("accepts a spec-built screen and rejects an empty fix", () => {
    expect(FixBody.safeParse(body()).success).toBe(true);
    expect(FixBody.safeParse(body({ findings: [] })).success).toBe(false);
    expect(FixBody.safeParse(body({ spec: undefined })).success).toBe(false);
  });

  it("sends the goal, findings with their spec paths, and the current spec", () => {
    const [text] = buildFixContent(body()) as { type: string; text: string }[];
    expect(text.type).toBe("text");
    expect(text.text).toContain("Must be noticed first: The arrival time");
    expect(text.text).toContain('(at body.1 · "ProgressTracker")');
    expect(text.text).toContain("Current screen spec:");
  });

  it("rebuilds hand-drawn screens from the render and outline", () => {
    const blocks = buildFixContent(body({ spec: undefined, outline: "f1 · frame · \"Checkout\"", image: "iVBORw0KGgo=" }));
    expect(blocks.map((b) => b.type)).toEqual(["image", "text"]);
    expect((blocks[1] as { text: string }).text).toContain("drawn by hand");
  });

  it("recorded fix covers the Map first demo and builds cleanly", () => {
    expect(sampleFix(DEMO_SCREENS[1])).toBeNull();
    const r = sampleFix(DEMO_SCREENS[0])!;
    const find = (list: Inst[] | undefined, c: string): Inst[] => (list ?? []).flatMap((i) => [...(i.component === c ? [i] : []), ...find(i.children, c)]);
    expect(find(r.screen.body, "MapPlaceholder")[0].props?.height).toBe(180);
    expect(find(r.screen.footer, "Button").find((b) => b.props?.label === "Message")?.props?.variant).toBe("secondary");
    expect(r.screen.body[0]).toMatchObject({ component: "Text", props: { style: "display" } });
    expect(DEMO_SCREENS[0].body[0].component).toBe("MapPlaceholder"); // the demo itself is untouched
    expect(() => buildScreen(r.screen, BUILTIN)).not.toThrow();
  });

  it("recorded fix applies one issue at a time, and each step only once", () => {
    const status = sampleFix(DEMO_SCREENS[0], ["visibility-of-status"])!;
    expect(status.changes).toHaveLength(1);
    expect(status.screen.body[0]).toMatchObject({ component: "Text", props: { style: "caption" } });
    expect(status.screen.body[1].component).toBe("MapPlaceholder"); // hierarchy not touched

    // The ETA lands above the freshness line fixed before it.
    const hierarchy = sampleFix(status.screen, ["visual-hierarchy"])!;
    expect(hierarchy.screen.body.slice(0, 2).map((i) => i.props?.style)).toEqual(["display", "caption"]);
    expect(hierarchy.changes.map((c) => c.path)).toContain("body.0");

    const again = sampleFix(hierarchy.screen, ["visual-hierarchy", "visibility-of-status"])!;
    expect(again.changes).toEqual([]);
    expect(sampleFix(DEMO_SCREENS[0], ["accessibility"])!.changes).toEqual([]);
    expect(() => buildScreen(sampleFix(DEMO_SCREENS[0], ["user-control"])!.screen, BUILTIN)).not.toThrow();
  });
});
