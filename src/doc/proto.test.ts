import { describe, expect, it } from "vitest";
import { MOTION_REFS, MOTION_TOKENS, motionTransition } from "@/design-system/motion";
import { DEFAULT_DELAY, normalizeProto, parseStateKey, pathMatches, protoScreens, pruneProto, startScreen } from "./proto";
import type { Doc, Prototype } from "./schema";

const valid: Prototype = {
  start: "c",
  links: [
    { from: { screen: "a", path: "body.1" }, on: "tap", to: { screen: "b" }, transition: { kind: "smart", motion: "native" } },
    { from: { screen: "b", path: "header.0" }, on: "tap", to: "back", transition: { kind: "smart", motion: "spring.snappy" } },
    { from: { screen: "a" }, on: "delay", after: 2500, to: { state: "delivered" }, transition: { kind: "smart", motion: "spring.snappy" } },
  ],
  states: { a: { delivered: { "body.1.props.current": 3 } } },
  tracks: [{ target: { screen: "b", path: "body.*" }, preset: "fade-up", stagger: 70, motion: "medium.emphasized" }],
  keys: { a: { "body.1": "tracker" } },
};

describe("prototype validation", () => {
  it("keeps a valid prototype as it is, through JSON", () => {
    expect(normalizeProto(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it("moves what Qalam timed by default before native motion natively; tokens picked on purpose stay", () => {
    const old = (kind: string, motion: string) => ({ from: { screen: "a" }, on: "tap", to: { screen: "b" }, transition: { kind, motion } });
    const p = normalizeProto({ links: [old("push", "medium.standard"), old("smart", "spring.gentle"), old("push", "slow.standard"), old("dissolve", "spring.gentle")] });
    expect(p?.links.map((l) => l.transition.motion)).toEqual(["native", "native", "slow.standard", "spring.gentle"]);
  });

  it("keeps the feel a designer picked for phone screens (iOS when there's none)", () => {
    expect(normalizeProto({ ...valid, feel: "android" })?.feel).toBe("android");
    expect(normalizeProto({ ...valid, feel: "windows" })).not.toHaveProperty("feel");
    expect(pruneProto({ ...valid, feel: "android" }, ["a"]).feel).toBe("android");
  });

  it("drops what isn't a link, track, state or key, and garbage altogether", () => {
    const p = normalizeProto({
      links: [
        ...valid.links,
        { from: { screen: "a" }, on: "swipe", to: { screen: "b" }, transition: { kind: "smart", motion: "spring.gentle" } },
        { from: { screen: "a" }, on: "tap", to: { screen: "b" }, transition: { kind: "magic", motion: "spring.gentle" } },
        { from: { screen: "a" }, on: "tap", to: { screen: "b" }, transition: { kind: "push", motion: "spring.wobbly" } },
        { from: { screen: "a", path: "body.*" }, on: "tap", to: { screen: "b" }, transition: { kind: "push", motion: "fast.standard" } },
        { from: { screen: "a" }, on: "tap", to: { nowhere: true }, transition: { kind: "push", motion: "fast.standard" } },
      ],
      tracks: [...valid.tracks, { target: { screen: "b", path: "body.x" }, preset: "fade-up", motion: "fast.standard" }, { target: { screen: "b" }, preset: "spin", motion: "fast.standard" }],
      states: { a: { default: { "body.1.props.current": 1 }, delivered: { "body.1.props.current": 3, "body.1.current": 4 } }, b: "nope" },
    });
    expect(p?.links).toEqual(valid.links);
    expect(p?.tracks).toEqual(valid.tracks);
    expect(p?.states).toEqual(valid.states);
    for (const junk of [null, 3, "x", [], {}, { links: "no" }]) expect(normalizeProto(junk)).toBeUndefined();
  });

  it("keeps a prototype that only says where it starts", () => {
    expect(normalizeProto({ start: "c", links: [], states: {}, tracks: [] })).toEqual({ start: "c", links: [], states: {}, tracks: [] });
  });

  it("gives a delay link a delay, kept in range", () => {
    const link = (after?: unknown) => normalizeProto({ links: [{ from: { screen: "a" }, on: "delay", after, to: { screen: "b" }, transition: { kind: "dissolve", motion: "fast.standard" } }] })!.links[0];
    expect(link().after).toBe(DEFAULT_DELAY);
    expect(link(-5).after).toBe(0);
    expect(link(1e9).after).toBe(60_000);
  });
});

describe("prototype references", () => {
  it("reads state keys as an instance path and a prop", () => {
    expect(parseStateKey("body.1.props.current")).toEqual({ path: "body.1", prop: "current" });
    expect(parseStateKey("footer.0.children.1.props.label")).toEqual({ path: "footer.0.children.1", prop: "label" });
    expect(parseStateKey("body.1.current")).toBeNull();
    expect(parseStateKey("nowhere.1.props.x")).toBeNull();
  });

  it("matches one-segment wildcards", () => {
    expect(pathMatches("body.*", "body.2")).toBe(true);
    expect(pathMatches("body.*", "body.2.children.0")).toBe(false);
    expect(pathMatches("body.*", "header.0")).toBe(false);
    expect(pathMatches("body.1.children.*", "body.1.children.3")).toBe(true);
    expect(pathMatches("body.1", "body.1")).toBe(true);
  });

  it("drops what points at screens that are gone, and nothing else", () => {
    expect(pruneProto(valid, ["a", "b", "c"])).toBe(valid);
    const p = pruneProto(valid, ["a", "c"]);
    expect(p.links).toEqual([valid.links[2]]);
    expect(p.tracks).toEqual([]);
    expect(p.states).toEqual(valid.states);
    expect(p.keys).toEqual(valid.keys);
    expect(p.start).toBe("c");
    expect(pruneProto(valid, ["b"]).start).toBeUndefined();
  });

  it("lists the screens it uses in document order and where it starts", () => {
    const doc = { nodes: {}, roots: ["c", "b", "a", "z"], proto: valid } as unknown as Doc;
    expect(protoScreens(doc)).toEqual(["c", "b", "a"]);
    expect(startScreen(valid, ["a", "b", "c"])).toBe("c");
    expect(startScreen({ ...valid, start: undefined }, ["a", "b"])).toBe("a");
    expect(startScreen(undefined, ["q"])).toBe("q");
  });
});

describe("motion tokens", () => {
  it("resolves every reference to a Motion transition", () => {
    expect(motionTransition("medium.standard")).toEqual({ duration: 0.25, ease: [0.2, 0, 0, 1] });
    expect(motionTransition("spring.gentle")).toEqual({ type: "spring", visualDuration: 0.5, bounce: 0.15 });
    for (const ref of MOTION_TOKENS) expect(motionTransition(ref)).toBeTruthy();
    // "native" isn't a token: it's the platform's own motion, and comes first.
    expect(MOTION_REFS[0]).toBe("native");
  });
});
