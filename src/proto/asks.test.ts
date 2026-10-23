import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { studio, useStudio } from "@/doc/store";
import { normalizeProto } from "@/doc/proto";
import { registerProtoPass } from "@/doc/proto-pass";
import { fixture } from "./fixtures/build";
import { MENU_SCREEN } from "./fixtures/food-menu";
import { askText, asksOf, queueAsks, withoutAsks } from "./asks";
import { normalizeRoutes, pruneRoutes } from "./routes";

beforeAll(async () => {
  await ensureYoga();
  registerProtoPass();
});

function load() {
  const f = fixture({ screen: MENU_SCREEN, parts: {}, steps: [] });
  useStudio.setState({ doc: f.doc, past: [], future: [], txBase: null, selection: [] });
  return f.screen;
}

describe("what Generate leaves for the prototype", () => {
  it("waits on the screen's route in the designer's words, joining the undo step that placed the screen", () => {
    const screen = load();
    // The screen placed (one undo step), then what its brief asked to see happen on it.
    studio().mutate((d) => {
      d.nodes[screen].name = "Menu, placed";
    });
    const past = useStudio.getState().past.length;
    queueAsks([screen, "gone"], ["  The dish's options sheet   open ", "the dish's options sheet open", "The basket bar after adding"]);
    expect(asksOf(studio().doc.proto?.routes?.[screen])).toEqual(["The dish's options sheet open", "The basket bar after adding"]);
    expect(useStudio.getState().past.length).toBe(past);
    // Undoing the screen takes its asks; redoing brings both back.
    studio().undo();
    expect(studio().doc.nodes[screen].name).not.toBe("Menu, placed");
    expect(asksOf(studio().doc.proto?.routes?.[screen])).toEqual([]);
    studio().redo();
    expect(asksOf(studio().doc.proto?.routes?.[screen])).toHaveLength(2);
  });

  it("is an undo step of its own on a screen that was already there, after what already waits", () => {
    const screen = load();
    queueAsks([screen], ["The dish's options sheet open"], true);
    queueAsks([screen], ["A toast once it's added"], true);
    expect(asksOf(studio().doc.proto?.routes?.[screen])).toEqual(["The dish's options sheet open", "A toast once it's added"]);
    studio().undo();
    expect(asksOf(studio().doc.proto?.routes?.[screen])).toEqual(["The dish's options sheet open"]);
  });

  it("keeps a route that only has asks, through a file and when frames go", () => {
    const routes = normalizeRoutes({ s1: { overlays: {}, addOns: {}, rules: [], asks: ["A sheet to pick a pickup point", 4, ""] }, s2: { overlays: {}, addOns: {}, rules: [], asks: [] } });
    expect(routes).toEqual({ s1: { overlays: {}, addOns: {}, rules: [], asks: ["A sheet to pick a pickup point"] } });
    expect(pruneRoutes(routes!, ["s1"])).toBe(routes);
    const proto = { links: [], states: {}, tracks: [], routes };
    expect(normalizeProto(JSON.parse(JSON.stringify(proto)))).toEqual(proto);
  });

  it("is what Qalam AI is asked, before what the designer types; a build takes it", () => {
    const route = { overlays: {}, addOns: {}, rules: [], asks: ["The dish's options sheet open", "The basket bar after adding"] };
    expect(askText(route, "  and a toast  ")).toBe("The dish's options sheet open\nThe basket bar after adding\nand a toast");
    expect(askText(undefined, "")).toBe("");
    expect(withoutAsks(route)).toEqual({ overlays: {}, addOns: {}, rules: [] });
  });
});
