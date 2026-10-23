import { afterEach, describe, expect, it } from "vitest";
import "@/commands/catalog";
import { commandsFor, setPlatform, type KeyLike, type KeySpec } from "@/commands/registry";
import { CHAT_KEYS } from "./chatKeys";

/** The keydown a chat key's spec describes, on a Mac (⌘) or elsewhere (Ctrl). */
function press(s: KeySpec, mac: boolean): KeyLike {
  return { key: s.key ?? "", code: s.code ?? "", metaKey: mac && !!s.meta, ctrlKey: mac ? !!s.ctrl : !!(s.meta || s.ctrl), altKey: !!s.alt, shiftKey: !!s.shift };
}

describe("the chat's own keys", () => {
  afterEach(() => setPlatform(null));

  it("never collide with an app-wide command, which the chat runs first", () => {
    for (const mac of [true, false]) {
      setPlatform(mac ? "mac" : "other");
      for (const [name, spec] of Object.entries(CHAT_KEYS)) {
        expect(commandsFor(press(spec, mac), "field", mac).map((c) => c.id), `${name} (${mac ? "mac" : "pc"})`).toEqual([]);
      }
    }
  });

  it("would catch a collision", () => {
    setPlatform("mac");
    expect(commandsFor(press({ key: "k", meta: true }, true), "field", true).map((c) => c.id)).toContain("essential.actions");
  });
});
