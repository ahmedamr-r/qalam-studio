import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_ID, BUILTIN_SYSTEM, getSystem, tokenSetFor, useSystems } from "@/design-system/registry";
import { applyTune, proposal, undoTune } from "./tune";

afterEach(() => useSystems.setState({ systems: [BUILTIN_SYSTEM], activeId: BUILTIN_ID }));

const answer = {
  diagnosis: "Too boxy.",
  tokens: [
    { path: "bg.surface", value: "#F2F2F2", reason: "Lighter tiles." },
    { path: "radius.lg", value: "huge", reason: "Broken on purpose." },
  ],
  guidance: [{ target: "layout.rules", op: "add" as const, text: "Group rows in one Card", reason: "Fewer boxes." }],
  limitations: [],
};

describe("tune proposals", () => {
  it("checks every change against the system and shows colours before and after", () => {
    const o = proposal(BUILTIN_SYSTEM, answer);
    expect(o.changes.map((c) => c.picked)).toEqual([true, false, true]);
    expect(o.changes[1].problem).toMatch(/isn't a size/);
    expect(o.changes[0]).toMatchObject({ from: "{color.neutral.50}", toColor: "#F2F2F2" });
    expect(o.changes[0].fromColor).toMatch(/^#/);
  });

  it("applies the built-in system's changes to an active copy, and undo takes them out again", () => {
    const o = applyTune(proposal(BUILTIN_SYSTEM, answer));
    const a = o.applied!;
    expect(a.forked).toBe(true);
    expect(useSystems.getState().activeId).toBe(a.systemId);
    expect(tokenSetFor(a.systemId).color("bg.surface")).toBe("#F2F2F2");
    expect(getSystem(a.systemId)!.docs.layout.rules[0]).toBe("Group rows in one Card");
    expect(BUILTIN_SYSTEM.docs.layout.rules[0]).not.toBe("Group rows in one Card");
    const back = undoTune(o);
    expect(back.applied).toBeUndefined();
    // The copy stays (it may have later edits); the AI's changes are gone from it.
    expect(tokenSetFor(a.systemId).color("bg.surface")).toBe(tokenSetFor(BUILTIN_ID).color("bg.surface"));
    expect(getSystem(a.systemId)!.docs.layout.rules).toEqual(BUILTIN_SYSTEM.docs.layout.rules);
  });

  it("edits a copy in place and reverts it exactly", () => {
    const first = applyTune(proposal(BUILTIN_SYSTEM, answer)).applied!;
    const copy = getSystem(first.systemId)!;
    const o = applyTune(proposal(copy, { ...answer, tokens: [{ path: "bg.surface", value: "#EEEEEE", reason: "" }], guidance: [] }));
    expect(o.applied!.forked).toBe(false);
    expect(tokenSetFor(copy.id).color("bg.surface")).toBe("#EEEEEE");
    undoTune(o);
    expect(tokenSetFor(copy.id).color("bg.surface")).toBe("#F2F2F2");
  });
});
