import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "@/commands/catalog";
import { allCommands, commandState, commandsFor, formatKeys, keysOf, type Command, type KeySpec } from "@/commands/registry";
import { useStudio } from "@/doc/store";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { registerDiscoveryCommands } from "./commands";

/** A key's identity: its modifiers and the key or physical code. */
const capsOf = (k: KeySpec, mac: boolean) => [...formatKeys({ ...k, key: undefined, code: undefined, label: "" }, mac), k.key ?? k.code].join("");
const isBoard = (c: Command) => c.category === "discovery" || c.id === "tool.card" || c.id === "tool.sticky";

/** Every key bound by more than one command that can run, with the commands on it. */
function shared(mac: boolean) {
  const on = new Map<string, Command[]>();
  for (const c of allCommands()) {
    if (c.gesture || c.unavailable) continue;
    for (const k of keysOf(c, mac)) on.set(capsOf(k, mac), [...(on.get(capsOf(k, mac)) ?? []), c]);
  }
  return [...on].filter(([, list]) => list.length > 1);
}

beforeAll(() => registerDiscoveryCommands());
beforeEach(() => useStudio.setState({ doc: emptyDoc(), selection: [], past: [], future: [], txBase: null }));

describe("Discovery's keys", () => {
  it("share a key with each other only where one works on cards and the other on stickies", () => {
    for (const mac of [true, false]) {
      const within = shared(mac).filter(([, list]) => list.filter(isBoard).length > 1);
      expect(within.map(([caps, list]) => `${caps}: ${list.filter(isBoard).map((c) => c.id).join(", ")}`)).toEqual(["Enter: discovery.add-sibling, discovery.edit-sticky"]);
    }
  });

  it("go before the Figma command on the same key, and leave it alone when no card is selected", () => {
    const keys = new Set<string>();
    for (const mac of [true, false]) {
      for (const [caps, list] of shared(mac)) {
        const board = list.filter(isBoard);
        if (!board.length || board.length === list.length) continue;
        keys.add(caps);
        for (const c of board) {
          expect(c.priority ?? 0, `${c.id} on ${caps}`).toBeGreaterThan(0);
          expect(commandState(c), `${c.id} on ${caps}`).not.toBe(true);
        }
      }
    }
    // ⇥ ↵ the arrows ⌫ ⌦ and their ⌥ / ⇧ forms, ⌘R, F2…
    expect(keys.size).toBeGreaterThanOrEqual(8);
  });

  it("take ⇥ for a new card under the selected one", () => {
    const n = makeCardNode(newCard("outcome", { title: "More weekly reorders" }));
    const doc = emptyDoc();
    addCardIn(doc, n, null);
    useStudio.setState({ doc, selection: [n.id] });
    const tab = { key: "Tab", code: "Tab", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent;
    const first = commandsFor(tab, "canvas").find((c) => commandState(c) === true);
    expect(first?.id).toBe("discovery.add-child");
  });
});
