import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { Feel } from "@/design-system/native-motion";
import { evaluate, loadPrototype, transpile } from "@/ui/prototype/runtime";
import { rideFixture } from "@/proto/fixtures/ride";
import { dashboardFixture } from "@/proto/fixtures/dashboard";
import { foodMenuDoc } from "@/proto/fixtures/food-menu";
import { scanFrame } from "@/proto/scan";
import { compilePrototype } from "./compile";
import { motionCode, pressLook, swipeCode, swipesBack, variantsCode } from "./feel";
import { orderTrackingDoc } from "./fixtures";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

type Variant = (v?: { kind: string; back?: boolean; dir?: string; transition?: object }) => Record<string, unknown>;

/** A feel's screenVariants, run. */
function variants(feel: Feel) {
  const im = { react: new Set<string>(), motion: new Set<string>() };
  const code = [`import { cubicBezier, type Transition, type Variants } from "motion/react";`, "type Via = { kind: string; back?: boolean; dir?: string; transition?: Transition };", ...motionCode(feel, im), ...variantsCode(feel), "export { screenVariants, MOTION };"].join("\n");
  return evaluate(transpile(code)) as { screenVariants: Record<"enter" | "center" | "exit", Variant>; MOTION: Record<string, Record<string, unknown>> };
}

describe("native motion in the compiled prototype", () => {
  it("moves phone screens as iOS does unless the designer picks Android; web screens as the web does", () => {
    const ride = rideFixture();
    expect(compilePrototype(ride.doc, { typography }).feel).toBe("ios");
    ride.doc.proto!.feel = "android";
    expect(compilePrototype(ride.doc, { typography }).feel).toBe("android");
    const dash = dashboardFixture();
    dash.doc.proto!.feel = "android";
    expect(compilePrototype(dash.doc, { typography }).feel).toBe("web");
  });

  it("compiles an Android prototype: Material's emphasized curve, its springs, the ripple", async () => {
    const f = rideFixture();
    f.doc.proto!.feel = "android";
    const r = compilePrototype(f.doc, { typography, title: "Ride" });
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain("const emphasized = (t: number) =>");
    expect(r.code).toContain("@property --q-ripple");
    expect(r.code).toContain(`page: { duration: 0.45, ease: emphasized },`);
    expect(r.code).not.toContain("motionTokens");
    await expect(r.code).toMatchFileSnapshot("./__golden__/ride-android.tsx");
    const html = renderToString(createElement(loadPrototype(r.code)));
    expect(html).toContain("Choose a ride");
  });

  it("compiles a web prototype: pages cross-fade, presses are state layers", async () => {
    const f = dashboardFixture();
    const r = compilePrototype(f.doc, { typography, title: "Accounts" });
    expect(r.warnings).toEqual([]);
    expect(r.feel).toBe("web");
    expect(r.code).toContain(`[data-press]:hover::after`);
    expect(r.code).not.toContain("cubicBezier");
    await expect(r.code).toMatchFileSnapshot("./__golden__/dashboard-web.tsx");
    expect(renderToString(createElement(loadPrototype(r.code)))).toContain("q-screen");
  });

  it("pushes on iOS as UIKit does: in from the edge, the screen under moving back 30% under a 10% dim", () => {
    const { screenVariants: v, MOTION } = variants("ios");
    expect(v.enter({ kind: "push" })).toEqual({ x: "100%", zIndex: 1 });
    expect(v.exit({ kind: "push" })).toMatchObject({ x: "-30%", filter: "brightness(0.9)", zIndex: 0 });
    expect(v.enter({ kind: "push", back: true })).toEqual({ x: "-30%", filter: "brightness(0.9)", zIndex: 0 });
    expect(v.exit({ kind: "push", back: true })).toMatchObject({ x: "100%", zIndex: 1 });
    // Right to left, mirrored.
    expect(v.enter({ kind: "push", dir: "rtl" })).toEqual({ x: "-100%", zIndex: 1 });
    // On UIKit's navigation spring, unless the link has a timing of its own.
    expect(v.center({ kind: "push" }).transition).toEqual(MOTION.page);
    expect(MOTION.page).toEqual({ type: "spring", stiffness: 1000, damping: 109.54, mass: 3 });
    const own = { duration: 0.25, ease: [0.2, 0, 0, 1] };
    expect(v.center({ kind: "push", transition: own }).transition).toEqual(own);
  });

  it("pushes on Android as Android 14 does: 96dp in as it fades in from 50ms; back fades the top screen out from 35ms", () => {
    const { screenVariants: v } = variants("android");
    expect(v.enter({ kind: "push" })).toEqual({ x: 96, opacity: 0, zIndex: 1 });
    expect(v.center({ kind: "push" }).transition).toMatchObject({ duration: 0.45, opacity: { duration: 0.083, delay: 0.05, ease: "linear" } });
    expect(v.exit({ kind: "push" })).toMatchObject({ x: -96, zIndex: 0 });
    expect(v.exit({ kind: "push", back: true })).toMatchObject({ x: 96, opacity: 0, zIndex: 1, transition: { duration: 0.45, opacity: { duration: 0.083, delay: 0.035 } } });
    // A sheet link: Material's bottom sheet, a fifth of the screen as it fades in; the screen under it dims to 32%.
    expect(v.enter({ kind: "sheet" })).toEqual({ y: "20%", opacity: 0, zIndex: 1 });
    expect(v.exit({ kind: "sheet" })).toMatchObject({ filter: "brightness(0.68)", zIndex: 0 });
  });

  it("changes pages on the web as View Transitions do: both at once, added together so nothing dips", () => {
    const { screenVariants: v, MOTION } = variants("web");
    expect(v.enter({ kind: "push" })).toEqual({ opacity: 0, mixBlendMode: "plus-lighter", zIndex: 1 });
    expect(v.exit({ kind: "push" })).toMatchObject({ opacity: 0, mixBlendMode: "plus-lighter", zIndex: 0 });
    expect(MOTION.page).toEqual({ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] });
  });

  it("swipes back from the edge where the platform does: on iOS, in a prototype that can go somewhere", () => {
    expect([swipesBack("ios"), swipesBack("android"), swipesBack("web")]).toEqual([true, false, false]);
    const im = { react: new Set<string>(), motion: new Set<string>() };
    expect(swipeCode("android", im, true)).toEqual([]);
    expect(im.react.size + im.motion.size).toBe(0);
    // Screens linked without routes swipe back too: Nav keeps how each was gone to.
    const { doc, ids } = orderTrackingDoc();
    const flow = [ids.mapFirst, ids.timeline, ids.compact];
    const ios = compilePrototype(doc, { screens: flow, typography }).code;
    expect(ios).toContain("const SWIPE = { edge: 50, start: 5, slack: 20, impact: 0.3 };");
    expect(ios).toContain(`() => !!back && nav.came === "push" && arrived.current === nav.visit,`);
    expect(ios).toContain("history: back ? n.history.slice(0, -1) : [...n.history, { screen: n.screen, came: n.came }],");
    // The screen under is the visit Back makes, so closing the swipe keeps it where it is.
    expect(ios).toContain("<motion.div key={under.visit} initial={false} layoutScroll style={{ ...VISIT, x: swipe.under, filter: swipe.dim }}>");
    doc.proto!.feel = "android";
    expect(compilePrototype(doc, { screens: flow, typography }).code).not.toContain("useSwipeBack");
    // One screen goes nowhere: nothing to swipe back to.
    expect(compilePrototype(rideFixture().doc, { typography }).code).not.toContain("useSwipeBack");
  });

  it("presses controls by dimming them and rows, cards and buttons by darkening them", () => {
    const { doc, ids } = foodMenuDoc();
    const scan = scanFrame(doc, ids.menu);
    const at = (path: string) => Object.values(doc.nodes).find((n) => n.meta.specPath === path && n.parentId && doc.nodes[n.parentId])!;
    const col = scan.collections[0];
    const plus = at(`${col.items[0]}.${col.action}`);
    expect(plus.meta.component?.split("/")[0]).toBe("IconButton");
    expect(pressLook(doc, plus.id)).toBe("dim");
    const card = Object.values(doc.nodes).find((n) => n.meta.component?.startsWith("Card"));
    if (card) expect(pressLook(doc, card.id)).toBe("fill");
    // A tab, a chip: controls, whatever their component's own name.
    const dash = dashboardFixture();
    const tab = Object.values(dash.doc.nodes).find((n) => n.meta.component === "Tab" || n.meta.component === "Tab/Selected")!;
    expect(pressLook(dash.doc, tab.id)).toBe("dim");
  });
});
