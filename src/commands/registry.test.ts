import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commandsFor,
  dispatchKeyDown,
  formatKeys,
  kb,
  keysText,
  matchKey,
  onCommandRun,
  commandState,
  registerCommands,
  setCommandGuard,
  setPlatform,
  useLearned,
  type Command,
  type KeyLike,
} from "./registry";
import { onFeedback } from "./feedback";

/** A keydown as the browser would send it on a US keyboard. */
function key(k: string, mods: Partial<Pick<KeyLike, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}, code?: string, repeat = false) {
  const c = code ?? (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k);
  let prevented = false;
  const e = {
    key: k,
    code: c,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    repeat,
    preventDefault: () => void (prevented = true),
    get defaultPrevented() {
      return prevented;
    },
  };
  return e as unknown as KeyboardEvent & { defaultPrevented: boolean };
}

describe("kb", () => {
  it("reads modifier glyphs and picks key or code by the kind of key", () => {
    expect(kb("⌥⌘G")).toEqual({ alt: true, meta: true, key: "g" });
    expect(kb("⇧0")).toEqual({ shift: true, code: "Digit0" });
    expect(kb("⌃⇧/", "?")).toEqual({ ctrl: true, shift: true, code: "Slash", label: "?" });
    expect(kb("Esc")).toEqual({ key: "Escape" });
    expect(kb("⇧↵")).toEqual({ shift: true, key: "Enter" });
    expect(kb("F6")).toEqual({ code: "F6" });
    expect(() => kb("⌘Foo")).toThrow();
  });
});

describe("matchKey", () => {
  afterEach(() => setPlatform(null));

  it("needs exactly the modifiers of the binding", () => {
    expect(matchKey(key("h"), kb("h"), true)).toBe(true);
    expect(matchKey(key("H", { shiftKey: true }), kb("h"), true)).toBe(false);
    expect(matchKey(key("H", { shiftKey: true }), kb("⇧H"), true)).toBe(true);
    expect(matchKey(key("h", { altKey: true }), kb("h"), true)).toBe(false);
  });

  it("keeps ⌘ and ⌃ apart on a Mac and reads Ctrl as ⌘ elsewhere", () => {
    expect(matchKey(key("c", { ctrlKey: true }), kb("⌘C"), true)).toBe(false);
    expect(matchKey(key("c", { ctrlKey: true }), kb("⌃C"), true)).toBe(true);
    expect(matchKey(key("c", { metaKey: true }), kb("⌘C"), true)).toBe(true);
    expect(matchKey(key("c", { ctrlKey: true }), kb("⌘C"), false)).toBe(true);
    // The Windows key is never ⌘.
    expect(matchKey(key("c", { metaKey: true }), kb("⌘C"), false)).toBe(false);
  });

  it("falls back to the physical key for ⌥ letters, dead keys and other scripts", () => {
    expect(matchKey(key("å", { altKey: true }, "KeyA"), kb("⌥A"), true)).toBe(true);
    expect(matchKey(key("Dead", { altKey: true, shiftKey: true }, "KeyE"), kb("⌥⇧E"), true)).toBe(true);
    expect(matchKey(key("¬", { altKey: true, metaKey: true }, "KeyL"), kb("⌥⌘L"), true)).toBe(true);
    expect(matchKey(key("ش", {}, "KeyA"), kb("a"), true)).toBe(true);
  });

  it("follows the layout for letters (AZERTY's A sits on the Q key)", () => {
    expect(matchKey(key("a", {}, "KeyQ"), kb("a"), true)).toBe(true);
    expect(matchKey(key("a", {}, "KeyQ"), kb("q"), true)).toBe(false);
  });

  it("matches digits and punctuation by code, whatever ⇧ or ⌥ typed", () => {
    expect(matchKey(key(")", { shiftKey: true }, "Digit0"), kb("⇧0"), true)).toBe(true);
    expect(matchKey(key("¡", { altKey: true }, "Digit1"), kb("⌥1"), true)).toBe(true);
    expect(matchKey(key("?", { shiftKey: true }, "Slash"), kb("⇧/"), true)).toBe(true);
    expect(matchKey(key("?", { shiftKey: true }, "Slash"), kb("/"), true)).toBe(false);
    expect(matchKey(key("÷", { altKey: true }, "Slash"), kb("⌥/"), true)).toBe(true);
  });
});

describe("formatKeys", () => {
  it("draws Mac glyphs in ⌃ ⌥ ⇧ ⌘ order", () => {
    expect(formatKeys(kb("⌘⌥G"), true)).toEqual(["⌥", "⌘", "G"]);
    expect(formatKeys(kb("⇧⌃/", "?"), true)).toEqual(["⌃", "⇧", "?"]);
    expect(formatKeys(kb("⇧↵"), true)).toEqual(["⇧", "↵"]);
    expect(formatKeys(kb("⌥1"), true)).toEqual(["⌥", "1"]);
    expect(formatKeys(kb("⌘\\"), true)).toEqual(["⌘", "\\"]);
  });

  it("spells modifiers out elsewhere", () => {
    expect(formatKeys(kb("⇧⌘Z"), false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(formatKeys(kb("⌫"), false)).toEqual(["Backspace"]);
  });
});

describe("dispatchKeyDown", () => {
  const ran: string[] = [];
  let enabled = true;
  const cmd = (c: Partial<Command> & Pick<Command, "id">): Command => ({ label: c.id, category: "edit", run: () => void ran.push(c.id), ...c });

  beforeEach(() => {
    setPlatform("mac");
    ran.length = 0;
    enabled = true;
    registerCommands([
      cmd({ id: "t.enter-a", keys: [kb("↵")], enabled: () => (enabled ? true : "no") }),
      cmd({ id: "t.enter-b", keys: [kb("↵")] }),
      cmd({ id: "t.enter-na", keys: [kb("↵")], unavailable: "Coming soon" }),
      cmd({ id: "t.nudge", keys: [kb("→")], repeat: true }),
      cmd({ id: "t.toggle", keys: [kb("⇧R")] }),
      cmd({ id: "t.copy", keys: [kb("⌘C")], native: true }),
      cmd({ id: "t.global", keys: [kb("⌘K")], context: "global" }),
      cmd({ id: "t.bold", keys: [kb("⌘B")], inText: true }),
      cmd({ id: "t.exit", keys: [kb("Esc")], context: "text-edit" }),
      cmd({ id: "t.gesture", keys: [kb("⌥⌘J")], gesture: ["⌥", "Drag"] }),
      cmd({ id: "t.soon", keys: [kb("⌥⌘J")], unavailable: "Coming soon" }),
      cmd({ id: "t.zoom", keys: [kb("=", "+"), { ...kb("⌘="), inText: true }] }),
    ]);
  });
  afterEach(() => setPlatform(null));

  it("runs the first enabled command bound to the key, unavailable ones last", () => {
    expect(commandsFor(key("Enter"), "canvas").map((c) => c.id)).toEqual(["t.enter-a", "t.enter-b", "t.enter-na"]);
    dispatchKeyDown(key("Enter"), "canvas");
    enabled = false;
    dispatchKeyDown(key("Enter"), "canvas");
    expect(ran).toEqual(["t.enter-a", "t.enter-b"]);
  });

  it("tries higher-priority commands first, falling through when they're disabled", () => {
    let onCard = true;
    registerCommands([cmd({ id: "t.tab-figma", keys: [kb("⇥")] }), cmd({ id: "t.tab-board", keys: [kb("⇥")], priority: 1, enabled: () => (onCard ? true : "Select a card") })]);
    expect(commandsFor(key("Tab"), "canvas").map((c) => c.id)).toEqual(["t.tab-board", "t.tab-figma"]);
    dispatchKeyDown(key("Tab"), "canvas");
    onCard = false;
    dispatchKeyDown(key("Tab"), "canvas");
    expect(ran).toEqual(["t.tab-board", "t.tab-figma"]);
  });

  it("lets a guard disable commands with its reason, before their own check", () => {
    setCommandGuard((c) => (c.id === "t.toggle" ? "Tree cards keep their place in the tree" : null));
    try {
      expect(commandState({ id: "t.toggle", label: "", category: "edit", run: () => {} })).toBe("Tree cards keep their place in the tree");
      dispatchKeyDown(key("R", { shiftKey: true }), "canvas");
      expect(ran).toEqual([]);
      dispatchKeyDown(key("ArrowRight"), "canvas");
      expect(ran).toEqual(["t.nudge"]);
    } finally {
      setCommandGuard(null);
    }
  });

  it("says why on a key press only when the guard announces", () => {
    const said: string[] = [];
    const off = onFeedback((f) => said.push(f.message));
    try {
      setCommandGuard((c) => (c.id === "t.toggle" ? "Read-only page" : null));
      dispatchKeyDown(key("R", { shiftKey: true }), "canvas");
      expect(said).toEqual([]);
      setCommandGuard((c) => (c.id === "t.toggle" ? "Read-only page" : null), { announce: true });
      dispatchKeyDown(key("R", { shiftKey: true }), "canvas");
      expect(said).toEqual(["Read-only page"]);
      expect(ran).toEqual([]);
    } finally {
      off();
      setCommandGuard(null);
    }
  });

  it("keeps a native key from the browser when its command is blocked", () => {
    setCommandGuard((c) => (c.id === "t.copy" ? "Not on this page" : null));
    try {
      const c = key("c", { metaKey: true });
      dispatchKeyDown(c, "canvas");
      expect(c.defaultPrevented).toBe(true);
      expect(ran).toEqual([]);
    } finally {
      setCommandGuard(null);
    }
  });

  it("keeps matched keys from the browser, except native clipboard keys", () => {
    const e = key("R", { shiftKey: true });
    expect(dispatchKeyDown(e, "canvas")).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    const c = key("c", { metaKey: true });
    dispatchKeyDown(c, "canvas");
    expect(c.defaultPrevented).toBe(false);
    expect(ran).toEqual(["t.toggle", "t.copy"]);
    const free = key("y");
    expect(dispatchKeyDown(free, "canvas")).toBe(false);
    expect(free.defaultPrevented).toBe(false);
  });

  it("ignores auto-repeat unless the command repeats", () => {
    dispatchKeyDown(key("R", { shiftKey: true }, "KeyR", true), "canvas");
    dispatchKeyDown(key("ArrowRight", {}, "ArrowRight", true), "canvas");
    expect(ran).toEqual(["t.nudge"]);
  });

  it("runs only global commands from fields, and text commands while editing text", () => {
    dispatchKeyDown(key("R", { shiftKey: true }), "field");
    dispatchKeyDown(key("k", { metaKey: true }), "field");
    dispatchKeyDown(key("Escape"), "canvas");
    dispatchKeyDown(key("Escape"), "text-edit");
    dispatchKeyDown(key("b", { metaKey: true }), "text-edit");
    dispatchKeyDown(key("R", { shiftKey: true }), "text-edit");
    expect(ran).toEqual(["t.global", "t.exit", "t.bold"]);
  });

  it("runs single bindings marked inText while editing text, not the command's other keys", () => {
    const typed = key("=", {}, "Equal");
    expect(dispatchKeyDown(typed, "text-edit")).toBe(false);
    expect(typed.defaultPrevented).toBe(false);
    const zoom = key("=", { metaKey: true }, "Equal");
    expect(dispatchKeyDown(zoom, "text-edit")).toBe(true);
    expect(zoom.defaultPrevented).toBe(true);
    expect(ran).toEqual(["t.zoom"]);
  });

  it("keeps the browser's reload, bookmark, back and page zoom from fields and the text editor", () => {
    for (const mode of ["field", "text-edit"] as const) {
      for (const [k, code] of [["r", "KeyR"], ["d", "KeyD"], ["[", "BracketLeft"], ["0", "Digit0"], ["-", "Minus"]]) {
        const e = key(k, { metaKey: true }, code);
        expect(dispatchKeyDown(e, mode)).toBe(false);
        expect(e.defaultPrevented).toBe(true);
      }
      // Typing and the clipboard stay the field's.
      for (const e of [key("a"), key("c", { metaKey: true })]) {
        dispatchKeyDown(e, mode);
        expect(e.defaultPrevented).toBe(false);
      }
    }
    expect(ran).toEqual([]);
  });

  it("writes a command's first binding for messages", () => {
    expect(keysText("t.global")).toBe("⌘K");
    setPlatform("other");
    expect(keysText("t.global")).toBe("Ctrl+K");
    expect(keysText("t.nope")).toBe("");
  });

  it("never dispatches gestures, and says why an unavailable command won't run", () => {
    const said: string[] = [];
    const off = onFeedback((f) => said.push(f.message));
    dispatchKeyDown(key("∆", { altKey: true, metaKey: true }, "KeyJ"), "canvas");
    off();
    expect(ran).toEqual([]);
    expect(said).toEqual(["t.soon: Coming soon"]);
  });

  it("learns shortcuts used from the keyboard and announces every run", () => {
    const seen: string[] = [];
    const off = onCommandRun((id, source) => seen.push(`${id}:${source}`));
    dispatchKeyDown(key("ArrowRight"), "canvas");
    off();
    expect(seen).toEqual(["t.nudge:keyboard"]);
    expect(useLearned.getState().learned.has("t.nudge")).toBe(true);
  });
});
