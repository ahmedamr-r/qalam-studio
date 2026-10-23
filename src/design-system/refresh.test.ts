import { afterAll, beforeAll, describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { BUILTIN_DOCS } from "./docs";
import { setToken } from "./contract";
import { BUILTIN_ID, useSystems, type DesignSystem } from "./registry";
import type { Tree } from "./resolve";
import { insertComponent, insertScreens } from "./place";
import { refreshRoot, staleRoots } from "./refresh";
import { instancesOf, isOverridden } from "./instances";
import { isEdited } from "./apply";
import { ensureYoga } from "@/engine/layout";
import { setAutoLayoutEnabled } from "@/doc/autolayout";
import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import type { TextNode } from "@/doc/schema";
import { DEMO_SCREENS } from "@/ui/demo";

const MINE: DesignSystem = { id: "mine", name: "Mine", source: "imported", tree: structuredClone(raw) as Tree, docs: BUILTIN_DOCS, fonts: [], createdAt: 1, updatedAt: 1 };

/** Change the source: set tokens of the "mine" system (bumps its version). */
function editSource(values: Record<string, string>) {
  const ds = useSystems.getState().systems.find((s) => s.id === "mine")!;
  const tree = structuredClone(ds.tree);
  for (const [path, value] of Object.entries(values)) setToken(tree, path, value.startsWith("{") ? { $value: value } : { $type: "dimension", $value: value });
  useSystems.getState().update("mine", { tree, updatedAt: ds.updatedAt + 1 });
}

const refresh = () => studio().mutate((d) => staleRoots(d).forEach((id) => refreshRoot(d, id)), { history: false });
const buttons = (root: string) => instancesOf(studio().doc, "Button", [root]);
const label = (id: string) => [id, ...descendants(studio().doc, id)].map((k) => studio().doc.nodes[k]).find((n): n is TextNode => n.type === "text")!;

describe("instances follow their source", () => {
  beforeAll(async () => {
    await ensureYoga();
    setAutoLayoutEnabled(true);
    useSystems.getState().add(MINE, false);
  });
  afterAll(() => {
    setAutoLayoutEnabled(false);
    useSystems.setState({ activeId: BUILTIN_ID });
  });

  it("rebuilds an untouched screen when its system changes, outside undo history", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[0]], "ai", "mine");
    expect(staleRoots(studio().doc)).toEqual([]);
    expect(buttons(id)).toHaveLength(2);
    editSource({ "component.button.height-md": "60px" });
    expect(staleRoots(studio().doc)).toEqual([id]);
    const past = studio().past.length;
    refresh();
    expect(studio().past.length).toBe(past);
    expect(buttons(id).map((b) => studio().doc.nodes[b].h)).toEqual([60, 60]);
    expect(isEdited(studio().doc, id)).toBe(false);
    expect(staleRoots(studio().doc)).toEqual([]);
  });

  it("on an edited screen, rebuilds untouched instances and keeps overridden ones", async () => {
    const [id] = await insertScreens([DEMO_SCREENS[0]], "ai", "mine");
    const [call, message] = buttons(id);
    const callLabel = label(call).id;
    studio().mutate((d) => void ((d.nodes[callLabel] as TextNode).text.content = "Ring"));
    expect(isEdited(studio().doc, id)).toBe(true);
    expect(isOverridden(studio().doc, call)).toBe(true);
    expect(isOverridden(studio().doc, message)).toBe(false);
    const callH = studio().doc.nodes[call].h;

    editSource({ "component.button.height-md": "64px", "component.button.radius": "{radius.sm}" });
    refresh();
    const doc = studio().doc;
    // Untouched: rebuilt from the source, same ids.
    expect(doc.nodes[message].h).toBe(64);
    expect(doc.nodes[message].radius?.tl.rx).toBe(8);
    expect(isOverridden(doc, message)).toBe(false);
    // Overridden: keeps the designer's text and size, but token-bound style still follows.
    expect((doc.nodes[callLabel] as TextNode).text.content).toBe("Ring");
    expect(doc.nodes[call].h).toBe(callH);
    expect(doc.nodes[call].radius?.tl.rx).toBe(8);
  });

  it("refreshes a component placed on its own, and an undone snapshot is refreshed again", async () => {
    useSystems.getState().setActive("mine");
    studio().select([]);
    await insertComponent({ component: "Button", props: { label: "Go", variant: "primary", size: "md" } });
    const id = studio().doc.roots[studio().doc.roots.length - 1];
    expect(studio().doc.nodes[id].meta.inst?.component).toBe("Button");

    studio().mutate((d) => void (d.nodes[id].name = "Go button"));
    editSource({ "component.button.height-md": "40px" });
    refresh();
    expect(studio().doc.nodes[id].h).toBe(40);
    expect(studio().doc.nodes[id].meta.designSystem).toBe("mine");
    expect(studio().doc.nodes[id].name).toBe("Go button");

    // Undo the rename: the snapshot predates the change to the source, so it's stale again.
    studio().undo();
    expect(staleRoots(studio().doc)).toContain(id);
    refresh();
    expect(studio().doc.nodes[id].h).toBe(40);
  });
});
