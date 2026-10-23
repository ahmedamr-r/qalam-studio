import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { insertScreens } from "@/design-system/place";
import { studio } from "@/doc/store";
import { DEMO_SCREENS } from "@/ui/demo";
import { chatContext, selectionContext } from "./chatContext";
import type { ChatTurn } from "./chatTypes";

const turn = (p: Partial<ChatTurn>): ChatTurn => ({ id: Math.random().toString(36), tool: "generate", at: 1, request: { text: "" }, status: "done", started: 1, tokens: 0, ...p });

describe("chat context", () => {
  let ids: string[] = [];
  beforeAll(async () => {
    await ensureYoga();
    ids = await insertScreens([DEMO_SCREENS[0], DEMO_SCREENS[1]], "ai", "builtin");
  });

  const generated = () =>
    turn({
      request: { text: "Food order tracking", lang: "en", system: { id: "builtin", name: "Qalam" } },
      outcome: { kind: "generate", variants: [DEMO_SCREENS[0], DEMO_SCREENS[1]], offSystem: [], frameIds: ids },
    });

  it("is empty for the first request", () => {
    expect(chatContext(studio().doc, [])).toBe("");
    expect(chatContext(studio().doc, [turn({ status: "error" })])).toBe("");
  });

  it("numbers screens and sends their current specs", () => {
    const ctx = chatContext(studio().doc, [generated()]);
    expect(ctx).toContain('Turn 1 [c1] · Generate: "Food order tracking"');
    expect(ctx).toContain(`Screen 1.2 "${studio().doc.nodes[ids[1]].name}"`);
    expect(ctx).toMatch(/Screen 1\.1 spec: \{/);
  });

  it("describes hand-edited screens by their layers, not the outdated spec", () => {
    const text = Object.values(studio().doc.nodes).find((n) => n.type === "text" && ids.includes(topOf(n.id)))!;
    studio().mutate((d) => {
      const n = d.nodes[text.id];
      if (n.type === "text") n.text.content = "Edited by hand";
    });
    const ctx = chatContext(studio().doc, [generated()]);
    expect(ctx).toContain("edited by hand since");
    expect(selectionContext(studio().doc, [topOf(text.id)])).toContain("Edited by hand");
  });

  it("drops older specs first when over budget, but keeps every turn's summary", () => {
    const turns = [generated(), turn({ tool: "audit", request: { text: "contrast only" }, outcome: { kind: "audit", scope: ids, findings: [] } }), generated()];
    const ctx = chatContext(studio().doc, turns, 9000);
    expect(ctx).toContain("Turn 1 [c1] · Generate");
    expect(ctx).toContain('Turn 2 [c2] · Audit: "contrast only"');
    expect(ctx).toContain("Screen 3.1 ");
    expect(ctx).not.toContain("Screen 1.1 spec");
    expect(ctx.length).toBeLessThan(9000 + 2000);
  });
});

function topOf(id: string): string {
  const { doc } = studio();
  let n = doc.nodes[id];
  while (n.parentId) n = doc.nodes[n.parentId];
  return n.id;
}
