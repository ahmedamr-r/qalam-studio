import { describe, expect, it } from "vitest";
import { CATALOG, ESSENTIAL, opacityStep } from "./catalog";
import { formatKeys, getCommand, keysOf, type Command } from "./registry";

/** Keys several commands share on purpose: the first enabled one wins (Enter edits text or selects children). */
const SHARED = new Set(["Enter"]);

function bindings(mac: boolean, pick: (c: Command) => boolean) {
  const seen = new Map<string, string[]>();
  for (const c of CATALOG) {
    if (c.gesture || c.unavailable || !pick(c)) continue;
    for (const k of keysOf(c, mac)) {
      // Identity, not looks: the keypad's "-" and the main row's "-" are different keys.
      const caps = [...formatKeys({ ...k, key: undefined, code: undefined, label: "" }, mac), k.key ?? k.code].join("");
      seen.set(caps, [...(seen.get(caps) ?? []), c.id]);
    }
  }
  return [...seen].filter(([caps, ids]) => ids.length > 1 && !SHARED.has(caps));
}

describe("the Figma catalogue", () => {
  it("covers the whole Figma list (≈170 entries) with unique ids", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(170);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const c of CATALOG) expect(c.label.trim()).not.toBe("");
  });

  it("binds every Tool key", () => {
    const tools = ["select", "hand", "scale", "frame", "rect", "ellipse", "line", "arrow", "pen", "pencil", "text"];
    for (const t of tools) expect(getCommand(`tool.${t}`)?.keys?.length, t).toBeGreaterThan(0);
  });

  it("never gives two working commands the same key in the same place", () => {
    for (const mac of [true, false]) {
      expect(bindings(mac, (c) => !c.context || c.context === "canvas" || c.context === "global"), mac ? "mac canvas" : "win canvas").toEqual([]);
      expect(bindings(mac, (c) => c.context === "text-edit" || !!c.inText || c.context === "global"), mac ? "mac text" : "win text").toEqual([]);
    }
  });

  it("keeps the Essential tab pointing at real commands", () => {
    for (const id of ESSENTIAL) expect(getCommand(id), id).toBeDefined();
  });
});

describe("opacity keys", () => {
  it("reads one digit as tens and two quick digits as an exact percentage", () => {
    let r = opacityStep({ digits: "", at: -Infinity }, "5", 1000);
    expect(r.value).toBe(0.5);
    r = opacityStep(r.buf, "4", 1300);
    expect(r.value).toBe(0.54);
    // The pair is used up: the next digit starts over.
    r = opacityStep(r.buf, "0", 1400);
    expect(r.value).toBe(1);
    r = opacityStep(r.buf, "0", 1500);
    expect(r.value).toBe(0);
    // Too slow: two separate presses.
    r = opacityStep({ digits: "", at: -Infinity }, "4", 0);
    expect(opacityStep(r.buf, "5", 450).value).toBe(0.5);
  });
});
