import { beforeAll, describe, expect, it } from "vitest";
import { produce } from "immer";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import { isEdited } from "@/design-system/apply";
import { motionTransition } from "@/design-system/motion";
import { buildScreenNodes } from "@/design-system/place";
import type { Doc, FrameNode, TextNode } from "@/doc/schema";
import { DEMO_SCREENS } from "@/ui/demo";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { compilePrototype, type CompileOptions } from "./compile";
import { buildStateVariants } from "./variants";
import { orderTrackingDoc } from "./fixtures";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

/** Compile the order-tracking flow the way Prototype mode does. */
function compileFlow(doc: Doc, screens: string[], extra: Partial<CompileOptions> = {}) {
  const { variants, warnings } = buildStateVariants(doc, screens);
  const r = compilePrototype(doc, { screens, variants, typography, title: "Order tracking", ...extra });
  return { ...r, warnings: [...warnings, ...r.warnings] };
}

/** One screen's component, from `export function Name` to the next screen. */
const screenCode = (code: string, component: string) => {
  const start = code.indexOf(`export function ${component}(`);
  const end = code.indexOf("\nexport function ", start + 1);
  return code.slice(start, end < 0 ? undefined : end);
};

type ScreenVariant = (v: { kind: string; transition?: object; back?: boolean }) => Record<string, unknown>;

/** The compiled `screenVariants`, run: what a link of each kind does to the screen it enters and the one it leaves. */
/** The compiled screenVariants, run: the motion table, then how screens come and go. */
function screenVariantsOf(code: string) {
  const curves = code.indexOf("/** Material's emphasized easing");
  const motion = code.slice(curves >= 0 ? curves : code.indexOf("/**\n * How this prototype moves"), code.indexOf("\n", code.indexOf("const settled =")));
  const variants = code.slice(code.indexOf("/*\n * How screens come and go"), code.indexOf("\nconst calm ="));
  return evaluate(transpile(`import { cubicBezier } from "motion/react";\n${motion}\n${variants}\nexport { screenVariants, SETTLE };`)) as { screenVariants: Record<"enter" | "exit", ScreenVariant>; SETTLE: { page: number; morph: number } };
}

describe("prototype compiler: golden output", () => {
  it("compiles one demo screen on its own (Map first)", async () => {
    const doc: Doc = { nodes: {}, roots: [] };
    const nodes = buildScreenNodes(DEMO_SCREENS[0], "builtin", { x: 0, y: 0 }, "ai");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    const r = compilePrototype(doc, { typography });
    expect(r.warnings).toEqual([]);
    await expect(r.code).toMatchFileSnapshot("./__golden__/map-first.tsx");
  });

  it("compiles the order-tracking prototype: links, a state and a staggered track", async () => {
    const { doc, ids } = orderTrackingDoc();
    const r = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    expect(r.warnings).toEqual([]);
    expect(r.start).toBe(ids.compact);
    await expect(r.code).toMatchFileSnapshot("./__golden__/order-tracking.tsx");
  });

  it("is deterministic: no node ids, the same code for every build of the same screens", () => {
    const a = orderTrackingDoc();
    const b = orderTrackingDoc();
    const ca = compileFlow(a.doc, [a.ids.mapFirst, a.ids.timeline, a.ids.compact]).code;
    expect(compileFlow(b.doc, [b.ids.mapFirst, b.ids.timeline, b.ids.compact]).code).toBe(ca);
    for (const id of Object.keys(a.doc.nodes)) expect(ca).not.toContain(id);
  });
});

describe("prototype compiler: smart transitions", () => {
  it("gives the ProgressTracker one layoutId on both screens, though its spec path differs", () => {
    const { doc, ids } = orderTrackingDoc();
    const pt = (root: string) => Object.values(doc.nodes).find((n) => n.meta.component?.startsWith("ProgressTracker") && n.meta.specPath !== undefined && isIn(doc, n.id, root))!;
    expect(pt(ids.mapFirst).meta.specPath).toBe("body.1");
    expect(pt(ids.timeline).meta.specPath).toBe("body.1.children.0");
    const { code } = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    expect(screenCode(code, "MapFirst")).toContain(`layoutId="ProgressTracker-0"`);
    expect(screenCode(code, "Timeline")).toContain(`layoutId="ProgressTracker-0"`);
    // Compact is only reached by push: nothing on it morphs.
    expect(screenCode(code, "Compact")).not.toContain("layoutId");
    // Shared layers are scoped by flow, so only smart transitions morph them.
    expect(code).toContain("<LayoutGroup id={`flow-${nav.group}`}>");
    expect(code).toContain(`group: via.kind === "smart" ? n.group : n.group + 1`);
  });

  it("brings the new screen in on top: shared layers morph, what holds them keeps its opacity, the rest fades in", () => {
    const { doc, ids } = orderTrackingDoc();
    const { code } = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    const tl = screenCode(code, "Timeline");
    // The card holds the ProgressTracker: its fill, border and shadow fade on a layer of their own.
    expect(tl).toContain(`<motion.div variants={fade} style={timelineStyles.cardPaint} />`);
    expect(tl).toMatch(/cardPaint: \{\s+position: "absolute",\s+inset: 0,\s+backgroundColor: "var\(--bg-surface-raised\)",\s+borderRadius/);
    expect(tl).toContain(`rootPaint: { position: "absolute", inset: 0, backgroundColor: "var(--bg-canvas)" }`);
    // What holds no shared layer fades in; inside a shared layer it also goes at once when its screen leaves.
    expect(tl).toContain(`<motion.div variants={fade} style={timelineStyles.statusBar}>`);
    expect(tl).toContain(`<motion.div layout variants={fadeInShared} style={timelineStyles.close}>`);
    expect(code).toContain(`exit: (v?: Via) => (v?.kind === "smart" ? { opacity: 0, transition: { duration: 0 } } : {})`);
    expect(tl).toContain(`<motion.div layoutId="ProgressTracker-0" style={timelineStyles.progressTracker}>`);
    // Compact shares nothing.
    expect(screenCode(code, "Compact")).not.toContain("variants={fade");
    // The old screen stays underneath until the transition has settled.
    expect(code).toContain(`initial={via?.kind === "smart" ? "smart" : "enter"}`);
    expect(code).toContain("smart: { zIndex: 1 },");
    expect(code).toContain("opacity: { duration: 0, delay: settled(v) }");
  });

  it("keeps the old screen under a dissolve too, so the device never shows through halfway", () => {
    const { doc, ids } = orderTrackingDoc();
    const { screenVariants, SETTLE } = screenVariantsOf(compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]).code);
    const { enter, exit } = screenVariants;
    const via = (kind: string) => ({ kind, transition: motionTransition("slow.standard") });
    // The new screen fades in on top; the old one stays, opaque, darkening as UIKit's cross-dissolve does.
    expect(enter(via("dissolve"))).toEqual({ opacity: 0, zIndex: 1 });
    expect(exit(via("dissolve"))).toMatchObject({ filter: "brightness(0)", zIndex: 0 });
    expect(exit(via("dissolve"))).not.toHaveProperty("opacity");
    // Smart: as it is, until its own timing has settled; with none, until the platform's morph has.
    expect(exit(via("smart"))).toMatchObject({ opacity: 0, zIndex: 0, transition: { opacity: { duration: 0, delay: 0.4 } } });
    expect(exit({ kind: "smart" })).toMatchObject({ opacity: 0, zIndex: 0, transition: { opacity: { duration: 0, delay: SETTLE.morph } } });
  });

  it("fades a translucent layer in to its own opacity, and leaves a clipping holder its shadow", () => {
    const { doc, ids } = orderTrackingDoc();
    const inTimeline = (test: (n: Doc["nodes"][string]) => boolean) => Object.values(doc.nodes).find((n) => test(n) && isIn(doc, n.id, ids.timeline))!;
    const statusBar = inTimeline((n) => n.name === "Status bar");
    const card = inTimeline((n) => n.meta.specPath === "body.1");
    const edited = produce(doc, (d) => {
      d.nodes[statusBar.id].opacity = 0.5;
      (d.nodes[card.id] as FrameNode).clip = true;
    });
    const tl = screenCode(compileFlow(edited, [ids.mapFirst, ids.timeline, ids.compact]).code, "Timeline");
    expect(tl).toContain(`<motion.div variants={{ ...fade, center: { opacity: 0.5 } }} style={timelineStyles.statusBar}>`);
    // Its paint layer would be clipped: the card keeps its shadow and corners, the paint layer gets the rest.
    expect(tl).toMatch(/ {2}card: \{[^}]*overflow: "hidden",\s+borderRadius: "var\(--component-card-radius\)",\s+boxShadow: "var\(--component-card-raised-shadow\)",\s+\},/);
    expect(tl).toMatch(/cardPaint: \{[^}]*outline: "1px solid var\(--component-card-raised-border\)",\s+outlineOffset: -1,\s+\},/);
  });

  it("matches by explicit key when the prototype gives one", () => {
    const { doc, ids } = orderTrackingDoc();
    // Map first's Call button (in the sheet) and Timeline's footer button become one element.
    doc.proto!.keys = { [ids.mapFirst]: { "footer.0.children.1.children.0": "support" }, [ids.timeline]: { "footer.0": "support" } };
    const { code } = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    expect(screenCode(code, "MapFirst")).toContain(`layoutId="support"`);
    expect(screenCode(code, "Timeline")).toContain(`layoutId="support"`);
  });
});

function isIn(doc: Doc, id: string, root: string): boolean {
  let n = doc.nodes[id];
  while (n?.parentId) n = doc.nodes[n.parentId];
  return n?.id === root;
}

describe("prototype compiler: states, tracks and links", () => {
  it("compiles a state to a state variable that switches what changes", () => {
    const { doc, ids } = orderTrackingDoc();
    const map = screenCode(compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]).code, "MapFirst");
    expect(map).toContain(`useState<{ name: "default" | "delivered"; t?: Transition }>({ name: "default" })`);
    // current 2 → 3: the bar fills, and "Delivered" becomes the current step.
    expect(map).toContain(`flexGrow: st.name === "delivered" ? 1 : 0.6667`);
    expect(map).toContain(`className={st.name === "delivered" ? "type-caption-strong" : "type-caption"}`);
    expect(map).toContain(`animate={{ color: st.name === "delivered" ? "var(--text-primary)" : "var(--text-secondary)" }}`);
    expect(map).toContain(`setSt({ name: "delivered", t: MOTION.change })`);
  });

  it("staggers a track over every section a wildcard matches, and lets shared layers morph instead", () => {
    const { doc, ids } = orderTrackingDoc();
    const tl = screenCode(compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]).code, "Timeline");
    expect(tl).toContain(`initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={motionTokens["medium.emphasized"]}`);
    expect(tl).toContain(`initial={via?.kind === "smart" ? false : { opacity: 0, y: 16 }}`);
    expect(tl).toContain(`delay: 0.07`);
    expect(tl).toContain(`delay: 0.14`);
  });

  it("wires taps, back and delays; press and hover too", () => {
    const { doc, ids } = orderTrackingDoc();
    doc.proto!.links.push(
      { from: { screen: ids.compact }, on: "delay", after: 3000, to: { screen: ids.mapFirst }, transition: { kind: "dissolve", motion: "slow.standard" } },
      { from: { screen: ids.timeline, path: "body.2" }, on: "press", to: { screen: ids.compact }, transition: { kind: "sheet", motion: "medium.standard" } },
      { from: { screen: ids.timeline, path: "footer.0" }, on: "hover", to: { screen: ids.compact }, transition: { kind: "dissolve", motion: "fast.standard" } },
    );
    const { code } = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    // The demo's links move natively; a whole section presses like a card, the back arrow like a control.
    expect(code).toContain(`{...tap(() => go("timeline", { kind: "smart" }), "fill")}`);
    expect(code).toContain(`{...tap(() => go("back", { kind: "smart" }))}`);
    expect(code).toContain(`setTimeout(() => go("mapFirst", { kind: "dissolve", transition: motionTokens["slow.standard"] }), 3000)`);
    expect(code).toContain("const present = useIsPresent();");
    expect(code).toContain(`onPointerDown={() => go("compact", { kind: "sheet", transition: motionTokens["medium.standard"] })}`);
    expect(code).toContain(`onPointerEnter={() => go("compact", { kind: "dissolve", transition: motionTokens["fast.standard"] })}`);
  });

  it("leaves out links it can't follow, and says why", () => {
    const { doc, ids } = orderTrackingDoc();
    doc.proto!.links.push(
      { from: { screen: ids.mapFirst, path: "body.9" }, on: "tap", to: { screen: ids.timeline }, transition: { kind: "push", motion: "fast.standard" } },
      { from: { screen: ids.mapFirst }, on: "tap", to: { screen: "gone" }, transition: { kind: "push", motion: "fast.standard" } },
      { from: { screen: ids.mapFirst }, on: "tap", to: { state: "lost" }, transition: { kind: "push", motion: "fast.standard" } },
    );
    const r = compileFlow(doc, [ids.mapFirst, ids.timeline, ids.compact]);
    expect(r.warnings).toHaveLength(3);
    expect(r.code).not.toContain("body.9");
  });
});

describe("prototype compiler: screens as they are", () => {
  it("compiles a screen edited by hand from its nodes", () => {
    const { doc, ids } = orderTrackingDoc();
    const title = Object.values(doc.nodes).find((n) => n.type === "text" && n.text.content === "Order #4821" && isIn(doc, n.id, ids.timeline))!;
    const edited = produce(doc, (d) => {
      (d.nodes[title.id] as TextNode).text.content = "Order #9000";
      d.nodes[title.id].fill = { color: "#B5480A" };
    });
    expect(isEdited(edited, ids.timeline)).toBe(true);
    const tl = screenCode(compileFlow(edited, [ids.mapFirst, ids.timeline, ids.compact]).code, "Timeline");
    expect(tl).toContain(">Order #9000<");
    expect(tl).toContain(`color: "#B5480A"`);
  });

  it("compiles right-to-left screens with their own direction and Arabic type", () => {
    const doc: Doc = { nodes: {}, roots: [] };
    const nodes = buildScreenNodes(DEMO_SCREENS[3], "builtin", { x: 0, y: 0 }, "ai");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    const { code } = compilePrototype(doc, { typography });
    expect(code).toContain(`direction: "rtl"`);
    expect(code).toContain(`fontFamily: "'IBM Plex Sans Arabic', sans-serif"`);
    expect(code).toContain(`dir: "rtl"`);
  });
});
