import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeFrame, makeShape } from "./factory";
import { DEFAULT_DELAY, MAX_STATES, emptyProto, normalizeProto } from "./proto";
import { registerProtoPass } from "./proto-pass";
import {
  addLink,
  addState,
  addTrack,
  clearStateProp,
  componentAt,
  componentPaths,
  componentsOf,
  editProto,
  linkProblem,
  linksFrom,
  newLink,
  newTrack,
  protoScope,
  removeLink,
  removeState,
  removeTrack,
  renameState,
  screenIds,
  setStart,
  setStateProp,
  stateChanges,
  stateNameError,
  statesOf,
  tracksOf,
  updateLink,
  updateTrack,
} from "./proto-edit";
import { emptyDoc, type Doc, type ProtoLink, type Prototype, type SceneNode } from "./schema";
import { studio, useStudio } from "./store";

/**
 * Three screens like the order-tracking demo: the map (a top bar, the map and the tracker in the
 * body, a sheet with a list item in the footer), the timeline and the compact card; plus a loose
 * rectangle and a group on the canvas, which aren't screens.
 */
function demoDoc() {
  const doc: Doc = emptyDoc();
  const add = <T extends SceneNode>(n: T, parent?: SceneNode): T => {
    doc.nodes[n.id] = n;
    if (parent) {
      n.parentId = parent.id;
      parent.children.push(n.id);
    } else doc.roots.push(n.id);
    return n;
  };
  const inst = (name: string, specPath: string, parent: SceneNode) => add(makeFrame({ name, meta: { source: "ai", component: name, specPath } }), parent);
  const map = add(makeFrame({ name: "Map first" }));
  const header = inst("TopBar", "header.0", map);
  const body = add(makeFrame({ name: "Body" }), map);
  const mapView = inst("MapPlaceholder", "body.0", body);
  const tracker = inst("ProgressTracker", "body.1", body);
  const bar = add(makeShape("rect", { name: "Bar" }), tracker);
  const sheet = inst("BottomSheet", "footer.0", map);
  const item = inst("ListItem", "footer.0.children.0", sheet);
  const timeline = add(makeFrame({ name: "Timeline" }));
  const card = inst("Card", "body.0", timeline);
  const compact = add(makeFrame({ name: "Compact" }));
  const loose = add(makeShape("rect", { name: "Loose" }));
  const group = add(makeFrame({ name: "Group", meta: { source: "user", group: true } }));
  const drawn = add(makeShape("rect", { name: "Drawn" }), compact);
  return { doc, map: map.id, header: header.id, body: body.id, mapView: mapView.id, tracker: tracker.id, bar: bar.id, sheet: sheet.id, item: item.id, timeline: timeline.id, card: card.id, compact: compact.id, loose: loose.id, group: group.id, drawn: drawn.id };
}

const tap = (screen: string, path: string | undefined, to: ProtoLink["to"]): ProtoLink => ({
  from: path === undefined ? { screen } : { screen, path },
  on: "tap",
  to,
  transition: { kind: "smart", motion: "native" },
});

describe("reading the document for the Prototype tab", () => {
  const d = demoDoc();

  it("lists screens, and the components on one in layer order", () => {
    expect(screenIds(d.doc)).toEqual([d.map, d.timeline, d.compact]);
    expect(componentPaths(d.doc, d.map)).toEqual(["header.0", "body.0", "body.1", "footer.0", "footer.0.children.0"]);
    expect(componentPaths(d.doc, d.compact)).toEqual([]);
    expect(componentsOf(d.doc, d.map).slice(2, 4)).toEqual([
      { path: "body.1", id: d.tracker },
      { path: "footer.0", id: d.sheet },
    ]);
    expect(componentAt(d.doc, d.map, "body.1")).toBe(d.tracker);
    expect(componentAt(d.doc, d.map, "footer.0.children.0")).toBe(d.item);
    expect(componentAt(d.doc, d.timeline, "body.1")).toBeUndefined();
  });

  it("scopes a selection to its screen and the component it is in", () => {
    expect(protoScope(d.doc, [d.map])).toEqual({ screen: d.map, node: d.map });
    expect(protoScope(d.doc, [d.tracker])).toEqual({ screen: d.map, path: "body.1", node: d.tracker });
    // A layer inside a component links from that component; a nested component from itself.
    expect(protoScope(d.doc, [d.bar])).toEqual({ screen: d.map, path: "body.1", node: d.tracker });
    expect(protoScope(d.doc, [d.item])).toEqual({ screen: d.map, path: "footer.0.children.0", node: d.item });
    // A layer that isn't in a component links from its screen.
    expect(protoScope(d.doc, [d.body])).toEqual({ screen: d.map, node: d.map });
    expect(protoScope(d.doc, [d.drawn])).toEqual({ screen: d.compact, node: d.compact });
  });

  it("has no scope off screens or for several layers", () => {
    expect(protoScope(d.doc, [])).toBeNull();
    expect(protoScope(d.doc, [d.map, d.timeline])).toBeNull();
    expect(protoScope(d.doc, [d.loose])).toBeNull();
    expect(protoScope(d.doc, [d.group])).toBeNull();
    expect(protoScope(d.doc, ["gone"])).toBeNull();
  });
});

describe("link edits", () => {
  const d = demoDoc();
  const base: Prototype = {
    links: [tap(d.map, "body.1", { screen: d.timeline }), tap(d.timeline, "header.0", "back"), tap(d.map, undefined, { state: "delivered" }), tap(d.map, "header.0", "back")],
    states: { [d.map]: { delivered: { "body.1.props.current": 3 } } },
    tracks: [],
  };

  it("lists a screen's links, or one component's, with their indices", () => {
    expect(linksFrom(base, d.map).map((x) => x.index)).toEqual([0, 2, 3]);
    expect(linksFrom(base, d.map, "header.0")).toEqual([{ link: base.links[3], index: 3 }]);
    expect(linksFrom(base, d.compact)).toEqual([]);
    expect(linksFrom(undefined, d.map)).toEqual([]);
  });

  it("starts a new link on tap to the next screen, else the first, else back", () => {
    expect(newLink(d.doc, { screen: d.map, path: "body.1" })).toEqual(tap(d.map, "body.1", { screen: d.timeline }));
    expect(newLink(d.doc, { screen: d.compact }).to).toEqual({ screen: d.map });
    const alone = { nodes: { s: makeFrame({ id: "s" }) }, roots: ["s"] } as Doc;
    expect(newLink(alone, { screen: "s" }).to).toBe("back");
  });

  it("adds, changes and removes links", () => {
    const added = addLink(base, tap(d.compact, "body.0", { screen: d.map }));
    expect(added.links).toHaveLength(5);
    expect(base.links).toHaveLength(4);
    expect(addLink(base, tap(d.map, "body.*", "back"))).toBe(base);

    const changed = updateLink(base, 0, { kind: "push", motion: "medium.standard", to: "back" });
    expect(changed.links[0]).toEqual({ ...base.links[0], to: "back", transition: { kind: "push", motion: "medium.standard" } });
    expect(changed.links.slice(1)).toEqual(base.links.slice(1));
    expect(updateLink(base, 0, { from: { screen: d.map, path: "footer.0" } }).links[0].from).toEqual({ screen: d.map, path: "footer.0" });
    expect(updateLink(base, 0, { from: { screen: d.map, path: "body.*" } })).toBe(base);

    expect(removeLink(base, 1).links).toEqual([base.links[0], base.links[2], base.links[3]]);
    expect(removeLink(base, 9)).toBe(base);
  });

  it("gives a delay link its delay and takes it away with the trigger", () => {
    const delayed = updateLink(base, 2, { on: "delay" });
    expect(delayed.links[2]).toMatchObject({ on: "delay", after: DEFAULT_DELAY });
    expect(updateLink(delayed, 2, { after: 2500 }).links[2].after).toBe(2500);
    expect(updateLink(delayed, 2, { after: -40 }).links[2].after).toBe(0);
    expect(updateLink(delayed, 2, { after: 1e9 }).links[2].after).toBe(60_000);
    expect(updateLink(delayed, 2, { on: "hover" }).links[2]).not.toHaveProperty("after");
    // A delay set on a tap link waits for the trigger to become a delay.
    expect(updateLink(base, 0, { after: 300 }).links[0]).not.toHaveProperty("after");
  });

  it("returns the prototype itself when an edit changes nothing", () => {
    expect(updateLink(base, 0, { on: "tap", kind: "smart", motion: "native", to: { screen: d.timeline } })).toBe(base);
    expect(updateLink(base, 7, { on: "press" })).toBe(base);
  });

  it("says why a link wouldn't play", () => {
    expect(linkProblem(d.doc, base, base.links[0])).toBeNull();
    expect(linkProblem(d.doc, base, base.links[2])).toBeNull();
    expect(linkProblem(d.doc, base, tap(d.map, "body.4", "back"))).toMatch(/body\.4/);
    expect(linkProblem(d.doc, base, tap(d.map, undefined, { state: "lost" }))).toMatch(/no state “lost”/);
    expect(linkProblem(d.doc, base, tap(d.map, undefined, { state: "default" }))).toBeNull();
    expect(linkProblem(d.doc, base, tap(d.map, undefined, { screen: d.loose }))).toMatch(/gone/);
  });

  it("sets and clears where the prototype starts", () => {
    const started = setStart(base, d.compact);
    expect(started.start).toBe(d.compact);
    expect(setStart(started, d.compact)).toBe(started);
    expect(setStart(started, undefined)).not.toHaveProperty("start");
  });
});

describe("state edits", () => {
  const d = demoDoc();
  const base: Prototype = {
    links: [tap(d.map, "body.0", { state: "delivered" }), tap(d.timeline, "body.0", { state: "delivered" }), tap(d.map, "header.0", "back")],
    states: { [d.map]: { delivered: { "body.1.props.current": 3 } }, [d.timeline]: { delivered: { "body.0.props.tone": "brand" } } },
    tracks: [],
  };

  it("adds states named State 1, State 2… or as asked", () => {
    const one = addState(base, d.map);
    expect(one.name).toBe("State 1");
    expect(statesOf(one.proto, d.map)).toEqual(["delivered", "State 1"]);
    expect(one.proto.states[d.map]["State 1"]).toEqual({});
    expect(addState(one.proto, d.map).name).toBe("State 2");
    expect(addState(base, d.compact)).toEqual({ proto: { ...base, states: { ...base.states, [d.compact]: { "State 1": {} } } }, name: "State 1" });
    expect(addState(base, d.map, "pressed").name).toBe("pressed");
    for (const bad of ["delivered", "default", "  ", "x".repeat(41)]) expect(addState(base, d.map, bad)).toEqual({ proto: base, name: "" });
  });

  it("stops at the most states a screen can have", () => {
    let p = base;
    while (statesOf(p, d.map).length < MAX_STATES) p = addState(p, d.map).proto;
    expect(addState(p, d.map)).toEqual({ proto: p, name: "" });
  });

  it("checks state names", () => {
    expect(stateNameError(base, d.map, "pressed")).toBeNull();
    expect(stateNameError(base, d.map, "delivered")).toMatch(/Another state/);
    expect(stateNameError(base, d.map, "delivered", "delivered")).toBeNull();
    expect(stateNameError(base, d.map, "default")).toMatch(/as it is/);
    expect(stateNameError(base, d.map, "")).toMatch(/Name/);
  });

  it("renames a state and the screen's links into it, not other screens'", () => {
    const p = renameState(base, d.map, "delivered", " arrived ");
    expect(statesOf(p, d.map)).toEqual(["arrived"]);
    expect(p.states[d.map].arrived).toEqual({ "body.1.props.current": 3 });
    expect(p.links[0].to).toEqual({ state: "arrived" });
    expect(p.links[1].to).toEqual({ state: "delivered" });
    expect(statesOf(p, d.timeline)).toEqual(["delivered"]);
    expect(renameState(base, d.map, "delivered", "default")).toBe(base);
    expect(renameState(base, d.map, "nope", "x")).toBe(base);
  });

  it("keeps the order of states through a rename", () => {
    const p = addState(addState(base, d.map, "a").proto, d.map, "b").proto;
    expect(statesOf(renameState(p, d.map, "a", "z"), d.map)).toEqual(["delivered", "z", "b"]);
  });

  it("removes a state with the screen's links into it", () => {
    const p = removeState(base, d.map, "delivered");
    expect(p.states[d.map]).toBeUndefined();
    expect(p.states[d.timeline]).toEqual(base.states[d.timeline]);
    expect(p.links).toEqual([base.links[1], base.links[2]]);
    expect(removeState(base, d.map, "nope")).toBe(base);
  });

  it("sets and clears a component's props in a state", () => {
    let p = setStateProp(base, d.map, "delivered", "body.1", "title", "Delivered");
    expect(stateChanges(p, d.map, "delivered")).toEqual([
      { path: "body.1", prop: "current", value: 3 },
      { path: "body.1", prop: "title", value: "Delivered" },
    ]);
    expect(setStateProp(p, d.map, "delivered", "body.1", "current", 3)).toBe(p);
    p = setStateProp(p, d.map, "delivered", "body.1", "current", 4);
    expect(p.states[d.map].delivered["body.1.props.current"]).toBe(4);
    p = clearStateProp(p, d.map, "delivered", "body.1", "current");
    expect(stateChanges(p, d.map, "delivered")).toEqual([{ path: "body.1", prop: "title", value: "Delivered" }]);
    expect(clearStateProp(p, d.map, "delivered", "body.1", "current")).toBe(p);
    // Only real states, real paths and real values.
    expect(setStateProp(base, d.map, "nope", "body.1", "current", 1)).toBe(base);
    expect(setStateProp(base, d.map, "delivered", "body.*", "current", 1)).toBe(base);
    expect(setStateProp(base, d.map, "delivered", "body.1", "current", undefined)).toBe(base);
  });
});

describe("track edits", () => {
  const d = demoDoc();
  const base: Prototype = {
    links: [],
    states: {},
    tracks: [
      { target: { screen: d.map, path: "body.*" }, preset: "fade-up", stagger: 70, motion: "medium.emphasized" },
      { target: { screen: d.map, path: "body.1" }, preset: "pulse", motion: "slow.standard" },
      { target: { screen: d.timeline }, preset: "scale-in", motion: "fast.standard" },
    ],
  };

  it("lists a screen's tracks, or the ones that play on a component", () => {
    expect(tracksOf(base, d.map).map((x) => x.index)).toEqual([0, 1]);
    expect(tracksOf(base, d.map, "body.1").map((x) => x.index)).toEqual([0, 1]);
    expect(tracksOf(base, d.map, "body.0").map((x) => x.index)).toEqual([0]);
    expect(tracksOf(base, d.map, "header.0")).toEqual([]);
    expect(tracksOf(base, d.timeline, "body.0")).toEqual([]);
  });

  it("starts a component's track on it, and a screen's on its body sections in turn", () => {
    expect(newTrack(d.doc, d.map, "body.1")).toEqual({ target: { screen: d.map, path: "body.1" }, preset: "fade-up", motion: "medium.emphasized" });
    expect(newTrack(d.doc, d.map)).toEqual({ target: { screen: d.map, path: "body.*" }, preset: "fade-up", stagger: 60, motion: "medium.emphasized" });
    expect(newTrack(d.doc, d.timeline)).toEqual({ target: { screen: d.timeline }, preset: "fade-up", motion: "medium.emphasized" });
  });

  it("adds, changes and removes tracks", () => {
    expect(addTrack(base, newTrack(d.doc, d.compact)).tracks).toHaveLength(4);
    expect(addTrack(base, { target: { screen: d.map, path: "body.x" }, preset: "fade-up", motion: "fast.standard" })).toBe(base);
    expect(updateTrack(base, 1, { preset: "shimmer", motion: "spring.snappy" }).tracks[1]).toEqual({ target: { screen: d.map, path: "body.1" }, preset: "shimmer", motion: "spring.snappy" });
    expect(updateTrack(base, 0, { stagger: 120 }).tracks[0].stagger).toBe(120);
    expect(updateTrack(base, 0, { stagger: 0 }).tracks[0]).not.toHaveProperty("stagger");
    // One component has nothing to stagger.
    expect(updateTrack(base, 0, { target: { screen: d.map, path: "body.0" } }).tracks[0]).not.toHaveProperty("stagger");
    expect(updateTrack(base, 0, { preset: "fade-up" })).toBe(base);
    expect(updateTrack(base, 0, { target: { screen: d.map, path: "nowhere" } })).toBe(base);
    expect(removeTrack(base, 0).tracks).toEqual(base.tracks.slice(1));
    expect(removeTrack(base, 5)).toBe(base);
  });
});

describe("editing the document's prototype", () => {
  // The studio registers it as a project opens; it drops links to screens an edit removed.
  beforeAll(() => registerProtoPass());
  let d: ReturnType<typeof demoDoc>;
  beforeEach(() => {
    d = demoDoc();
    useStudio.setState({ doc: d.doc, past: [], future: [], txBase: null, selection: [] });
  });

  it("makes each edit one undo step", () => {
    editProto((p) => addLink(p, newLink(studio().doc, { screen: d.compact })));
    editProto((p) => updateLink(p, 0, { kind: "push" }));
    expect(studio().doc.proto?.links[0]).toMatchObject({ from: { screen: d.compact }, transition: { kind: "push" } });
    expect(studio().past).toHaveLength(2);
    studio().undo();
    expect(studio().doc.proto?.links[0].transition.kind).toBe("smart");
    studio().undo();
    expect(studio().doc.proto).toBeUndefined();
    studio().redo();
    expect(studio().doc.proto?.links).toHaveLength(1);
  });

  it("adds no history for an edit that changes nothing", () => {
    editProto((p) => removeLink(p, 0));
    expect(studio().past).toHaveLength(0);
    editProto((p) => addLink(p, tap(d.map, undefined, "back")));
    editProto((p) => updateLink(p, 0, { on: "tap" }));
    expect(studio().past).toHaveLength(1);
  });

  it("removes a prototype left with nothing in it", () => {
    editProto((p) => addLink(p, tap(d.map, undefined, "back")));
    editProto((p) => removeLink(p, 0));
    expect(studio().doc.proto).toBeUndefined();
  });

  it("joins live edits into one transaction", () => {
    editProto((p) => addLink(p, { ...tap(d.map, undefined, "back"), on: "delay", after: 800 }));
    for (const after of [900, 1000, 1100]) editProto((p) => updateLink(p, 0, { after }), { live: true });
    studio().commitTx();
    expect(studio().doc.proto?.links[0].after).toBe(1100);
    expect(studio().past).toHaveLength(2);
    studio().undo();
    expect(studio().doc.proto?.links[0].after).toBe(800);
  });

  it("drops links from the screen when the screen is deleted, in the same step", () => {
    editProto((p) => addLink(addLink(p, tap(d.map, "body.1", { screen: d.timeline })), tap(d.timeline, undefined, "back")));
    studio().mutate((doc) => {
      doc.roots = doc.roots.filter((id) => id !== d.timeline);
    });
    expect(studio().doc.proto?.links).toEqual([]);
    studio().undo();
    expect(studio().doc.proto?.links).toHaveLength(2);
  });

  it("wires the order-tracking flow the way the demo writes it, and it survives a file", () => {
    const { doc } = studio();
    editProto((p) => setStart(p, d.compact));
    editProto((p) => addLink(p, { ...newLink(doc, { screen: d.compact }), to: { screen: d.map }, transition: { kind: "push", motion: "native" } }));
    editProto((p) => addLink(p, newLink(doc, { screen: d.map, path: "body.1" })));
    let state = "";
    editProto((p) => {
      const added = addState(p, d.map, "delivered");
      state = added.name;
      return added.proto;
    });
    editProto((p) => setStateProp(p, d.map, state, "body.1", "current", 3));
    editProto((p) => addLink(p, { ...newLink(doc, { screen: d.map, path: "body.0" }), to: { state }, transition: { kind: "smart", motion: "spring.snappy" } }));
    editProto((p) => addTrack(p, { ...newTrack(doc, d.timeline, "body.0"), target: { screen: d.timeline, path: "body.*" }, stagger: 70 }));

    const proto = studio().doc.proto!;
    expect(proto.start).toBe(d.compact);
    expect(linksFrom(proto, d.map).map(({ link }) => link.to)).toEqual([{ screen: d.timeline }, { state: "delivered" }]);
    expect(stateChanges(proto, d.map, "delivered")).toEqual([{ path: "body.1", prop: "current", value: 3 }]);
    expect(normalizeProto(JSON.parse(JSON.stringify(proto)))).toEqual(proto);
    expect(normalizeProto(JSON.parse(JSON.stringify(emptyProto())))).toBeUndefined();
  });
});
