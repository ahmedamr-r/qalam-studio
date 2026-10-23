import { describe, expect, it } from "vitest";
import { isGlowFadeEnd } from "./AgentCursors";

describe("landing glow unmount", () => {
  const box = {};
  it("ends on the glow's own fade", () => {
    expect(isGlowFadeEnd({ animationName: "ds-glow", target: box, currentTarget: box })).toBe(true);
  });
  it("ignores animations bubbling up from the ring inside it", () => {
    expect(isGlowFadeEnd({ animationName: "ds-glow", target: {}, currentTarget: box })).toBe(false);
    expect(isGlowFadeEnd({ animationName: "q-orbit", target: box, currentTarget: box })).toBe(false);
  });
});
