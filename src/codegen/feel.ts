import type { Doc, SceneNode } from "@/doc/schema";
import { ANDROID, FEEL_LABEL, FEEL_MOTION, IOS, WEB, isSpring, pageSettle, settleTime, type CurveName, type Ease, type Feel, type PhoneFeel, type Timing } from "@/design-system/native-motion";

/*
 * How a compiled prototype moves, as the platform its screens are for does it (code as text, pure):
 * the MOTION table, how screens come and go, the overlay layer (sheets, dialogs, toasts, menus),
 * press feedback and what Reduce Motion changes. One feel per module: iOS or Android for phone
 * screens (the designer's pick), the web for the rest. The numbers are design-system/native-motion.ts.
 *
 * The emitted code joins strings rather than using template literals, so it can sit in these.
 */

const num = (x: number) => String(Math.round(x * 10000) / 10000);
const lines = (s: string) => s.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");

export const easeCode = (e: Ease): string => (Array.isArray(e) ? `[${e.map(num).join(", ")}]` : e === "linear" ? `"linear"` : e);

/** A timing as the module writes it: a spring in physical terms, or a tween. */
export function timingCode(t: Timing): string {
  if (isSpring(t)) return `{ type: "spring", stiffness: ${num(t.stiffness)}, damping: ${num(t.damping)}, mass: ${num(t.mass)} }`;
  return `{ duration: ${num(t.duration)}${t.delay ? `, delay: ${num(t.delay)}` : ""}, ease: ${easeCode(t.ease)} }`;
}

/** What the feel's code imports, gathered as it's written. */
export interface Imports {
  react: Set<string>;
  motion: Set<string>;
}

/** How a prototype moves: its first screen's platform decides; phone screens as their designer picked (iOS unless Android). */
export function feelFor(doc: Doc, startId: string | undefined, pick: PhoneFeel | undefined = doc.proto?.feel): Feel {
  const n = startId ? doc.nodes[startId] : undefined;
  const platform = n?.meta.spec?.platform ?? (n && n.w > 600 ? "web" : "mobile");
  return platform === "mobile" ? (pick ?? "ios") : "web";
}

// ---------------------------------------------------------------------------
// The motion table

const CURVES: Record<CurveName, string[]> = {
  emphasized: [
    "/** Material's emphasized easing, exactly: Android's fast_out_extra_slow_in path, two cubic Béziers meeting at (1/6, 0.4). */",
    "const emphasizedStart = cubicBezier(0.3, 0, 0.8, 0.15);",
    "const emphasizedEnd = cubicBezier(0.05, 0.7, 0.1, 1);",
    "const emphasized = (t: number) => (t < 1 / 6 ? 0.4 * emphasizedStart(t * 6) : 0.4 + 0.6 * emphasizedEnd((t - 1 / 6) * 1.2));",
  ],
  decelerate3: ["/** Android's DecelerateInterpolator, by a power. */", "const decelerate3 = (t: number) => 1 - (1 - t) ** 3;"],
  decelerate5: ["const decelerate5 = (t: number) => 1 - (1 - t) ** 5;"],
  outExpo: ["/** React Native's Easing.out(Easing.exp). */", "const outExpo = (t: number) => 1 - 2 ** (-10 * t);"],
};

const USES: Record<Feel, CurveName[]> = { ios: [], android: ["emphasized", "decelerate3", "decelerate5", "outExpo"], web: [] };

const ABOUT: Record<Feel, string[]> = {
  ios: [
    "/**",
    " * How this prototype moves: as iOS does. Pages and sheets ride UIKit's navigation spring (React",
    " * Navigation's TransitionIOSSpec: stiffness 1000, damping 500, mass 3, which React Native plays",
    " * critically damped, and so does this); what changes in place, shared layers and bars move on",
    " * SwiftUI's default spring (response 0.55, no bounce). A link with a motion token of its own keeps it.",
    " */",
  ],
  android: [
    "/**",
    " * How this prototype moves: as Android does (Material 3). Pages take 450ms on the emphasized curve,",
    " * as Android 14's activity transition does; what moves in place rides M3's standard spatial spring",
    " * (damping 0.9, stiffness 700), and what fades or changes colour its effects spring (1, 1600). A",
    " * link with a motion token of its own keeps it.",
    " */",
  ],
  web: [
    "/**",
    " * How this prototype moves: as the web does. Pages cross-fade over 250ms, as the View Transitions",
    " * API does by default; what changes in place takes Tailwind's default transition (150ms). A link",
    " * with a motion token of its own keeps it.",
    " */",
  ],
};

/** The curves, MOTION (page, morph, change, bar), SETTLE and settled(): emitted once per prototype. */
export function motionCode(feel: Feel, im: Imports): string[] {
  im.motion.add("type Transition");
  const out: string[] = [];
  const curves = USES[feel];
  if (curves.length) {
    im.motion.add("cubicBezier");
    for (const k of curves) out.push(...CURVES[k]);
    out.push("");
  }
  const m = FEEL_MOTION[feel];
  out.push(
    ...ABOUT[feel],
    "const MOTION = {",
    `  page: ${timingCode(m.page)},`,
    `  morph: ${timingCode(m.morph)},`,
    `  change: ${timingCode(m.change)},`,
    `  bar: ${timingCode(m.bar)},`,
    "} satisfies Record<string, Transition>;",
    "",
    "/** When a change of screen looks done, in seconds: what it leaves stays under the new screen until then. */",
    `const SETTLE = { page: ${num(pageSettle(feel))}, morph: ${num(settleTime(m.morph))} };`,
    `const settled = (v?: Via) => (v?.transition ? (v.transition.visualDuration ?? v.transition.duration ?? 0.3) : v?.kind === "smart" ? SETTLE.morph : SETTLE.page);`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Screens coming and going

const SMART_NOTE = " * Smart: the new screen comes in on top, where the layers they share morph and the rest fades in.";

const VARIANTS: Record<Feel, () => string[]> = {
  ios: () => [
    "/*",
    " * How screens come and go, as UIKit's navigation does it (React Navigation's forHorizontalIOS): the",
    " * new screen slides in over the old one, which moves back under a dim; Back reverses it. A sheet link",
    " * covers the screen from below (forVerticalIOS); dissolve fades the new screen in as the old one",
    " * darkens, as UIKit's cross-dissolve does (forCrossDissolveIOS).",
    SMART_NOTE,
    " * What doesn't move stays under the new screen, as it is, until that has settled.",
    " */",
    "",
    "/** forHorizontalIOS: the screen under a pushed one moves a third of the way back (%), under a 10% dim. */",
    `const UNDER = { shift: ${num(-IOS.parallax * 100)}, dim: ${num(IOS.pushDim)} };`,
    `const dimmed = (by: number) => "brightness(" + (1 - by) + ")";`,
    "",
    ...lines(`
const screenVariants: Variants = {
  enter: (v?: Via) => {
    const s = v?.dir === "rtl" ? -1 : 1;
    switch (v?.kind) {
      case "push":
        return v.back ? { x: UNDER.shift * s + "%", filter: dimmed(UNDER.dim), zIndex: 0 } : { x: 100 * s + "%", zIndex: 1 };
      case "sheet":
        return v.back ? { zIndex: 0 } : { y: "100%", zIndex: 1 };
      case "dissolve":
        return v.back ? { filter: "brightness(0)", zIndex: 0 } : { opacity: 0, zIndex: 1 };
      default:
        return { zIndex: 0 };
    }
  },
  smart: { zIndex: 1 },
  center: (v?: Via) => ({ x: 0, y: 0, opacity: 1, filter: "brightness(1)", transition: v?.transition ?? (v?.kind === "smart" ? MOTION.morph : MOTION.page), transitionEnd: { filter: "none" } }),
  exit: (v?: Via) => {
    const s = v?.dir === "rtl" ? -1 : 1;
    const transition = { ...(v?.transition ?? MOTION.page), zIndex: { duration: 0 } };
    const stay = { opacity: 0, zIndex: 0, transition: { ...transition, opacity: { duration: 0, delay: settled(v) } } };
    switch (v?.kind) {
      case "push":
        return v.back ? { x: 100 * s + "%", zIndex: 1, transition } : { x: UNDER.shift * s + "%", filter: dimmed(UNDER.dim), zIndex: 0, transition };
      case "sheet":
        return v.back ? { y: "100%", zIndex: 1, transition } : stay;
      case "dissolve":
        return v.back ? { opacity: 0, zIndex: 1, transition } : { filter: "brightness(0)", zIndex: 0, transition };
      default:
        return stay;
    }
  },
};`),
  ],
  android: () => [
    "/*",
    " * How screens come and go, as Android 14 does it: the new screen comes in from the side as it fades",
    " * in, over the old one moving the other way, 450ms on the emphasized curve; Back reverses it.",
    SMART_NOTE,
    " * What doesn't move stays under the new screen, as it is, until that has settled.",
    " */",
    "",
    "/** Android 14's activity transition (React Navigation's FadeFromRightAndroid): screens slide 96dp; the new one fades in from 50 to 133ms, and going back the top one fades out from 35 to 118ms. */",
    `const SHIFT = ${num(ANDROID.shift)};`,
    `const FADE_IN = ${timingCode(ANDROID.fadeIn)} satisfies Transition;`,
    `const FADE_OUT = ${timingCode(ANDROID.fadeOut)} satisfies Transition;`,
    "/** A sheet link: Material 3's bottom sheet (React Navigation's BottomSheetAndroid), rising a fifth of the screen as it fades in; the screen under it dims to 32%. */",
    "const SHEET_PAGE = {",
    `  in: ${timingCode(ANDROID.sheet.in)},`,
    `  out: ${timingCode(ANDROID.sheet.out)},`,
    `  fadeOut: ${timingCode(ANDROID.sheet.fadeOut)},`,
    `  dimIn: ${timingCode(ANDROID.sheet.dimIn)},`,
    `  dimOut: ${timingCode(ANDROID.sheet.dimOut)},`,
    "} satisfies Record<string, Transition>;",
    `const SHEET_DIM = "brightness(${num(1 - ANDROID.sheet.dim)})";`,
    "/** Dissolve: Compose Navigation's default, both fading over 700ms (FastOutSlowIn), added together so nothing dips. */",
    `const DISSOLVE = ${timingCode(ANDROID.dissolve)} satisfies Transition;`,
    "",
    ...lines(`
const screenVariants: Variants = {
  enter: (v?: Via) => {
    const s = v?.dir === "rtl" ? -1 : 1;
    switch (v?.kind) {
      case "push":
        return v.back ? { x: -SHIFT * s, zIndex: 0 } : { x: SHIFT * s, opacity: 0, zIndex: 1 };
      case "sheet":
        return v.back ? { filter: SHEET_DIM, zIndex: 0 } : { y: "20%", opacity: 0, zIndex: 1 };
      case "dissolve":
        return { opacity: 0, mixBlendMode: "plus-lighter", zIndex: v.back ? 0 : 1 };
      default:
        return { zIndex: 0 };
    }
  },
  smart: { zIndex: 1 },
  center: (v?: Via) => {
    const native =
      v?.kind === "push" ? (v.back ? MOTION.page : { ...MOTION.page, opacity: FADE_IN }) : v?.kind === "sheet" ? (v.back ? { filter: SHEET_PAGE.dimOut } : SHEET_PAGE.in) : v?.kind === "dissolve" ? DISSOLVE : MOTION.morph;
    return { x: 0, y: 0, opacity: 1, filter: "brightness(1)", transition: v?.transition ?? native, transitionEnd: { filter: "none", mixBlendMode: "normal" } };
  },
  exit: (v?: Via) => {
    const s = v?.dir === "rtl" ? -1 : 1;
    const t = v?.transition;
    const now = { zIndex: { duration: 0 } };
    switch (v?.kind) {
      case "push":
        return v.back
          ? { x: SHIFT * s, opacity: 0, zIndex: 1, transition: { ...(t ?? { ...MOTION.page, opacity: FADE_OUT }), ...now } }
          : { x: -SHIFT * s, zIndex: 0, transition: { ...(t ?? MOTION.page), ...now } };
      case "sheet":
        return v.back
          ? { y: "20%", opacity: 0, zIndex: 1, transition: { ...(t ?? { ...SHEET_PAGE.out, opacity: SHEET_PAGE.fadeOut }), ...now } }
          : { filter: SHEET_DIM, opacity: 0, zIndex: 0, transition: { ...(t ?? { filter: SHEET_PAGE.dimIn }), opacity: { duration: 0, delay: settled(v) }, ...now } };
      case "dissolve":
        return { opacity: 0, mixBlendMode: "plus-lighter", zIndex: v.back ? 1 : 0, transition: { ...(t ?? DISSOLVE), ...now } };
      default:
        return { opacity: 0, zIndex: 0, transition: { ...(t ?? MOTION.morph), opacity: { duration: 0, delay: settled(v) }, ...now } };
    }
  },
};`),
  ],
  web: () => [
    "/*",
    " * How screens come and go, as the web's View Transitions do by default: the old page fades out as",
    " * the new one fades in, blended with plus-lighter so the two never dip. Push and dissolve both do that.",
    SMART_NOTE,
    " * What doesn't move stays under the new screen, as it is, until that has settled.",
    " */",
    "",
    "/** A sheet link rises as Vaul's drawers do (shadcn/ui's Drawer): 500ms on cubic-bezier(0.32, 0.72, 0, 1). */",
    `const SHEET_PAGE = ${timingCode(WEB.sheet.timing)} satisfies Transition;`,
    "",
    ...lines(`
const screenVariants: Variants = {
  enter: (v?: Via) => {
    switch (v?.kind) {
      case "sheet":
        return v.back ? { zIndex: 0 } : { y: "100%", zIndex: 1 };
      case "push":
      case "dissolve":
        return { opacity: 0, mixBlendMode: "plus-lighter", zIndex: v.back ? 0 : 1 };
      default:
        return { zIndex: 0 };
    }
  },
  smart: { zIndex: 1 },
  center: (v?: Via) => ({ y: 0, opacity: 1, transition: v?.transition ?? (v?.kind === "sheet" ? SHEET_PAGE : v?.kind === "smart" ? MOTION.morph : MOTION.page), transitionEnd: { mixBlendMode: "normal" } }),
  exit: (v?: Via) => {
    const t = v?.transition;
    const now = { zIndex: { duration: 0 } };
    switch (v?.kind) {
      case "sheet":
        return v.back
          ? { y: "100%", zIndex: 1, transition: { ...(t ?? SHEET_PAGE), ...now } }
          : { opacity: 0, zIndex: 0, transition: { opacity: { duration: 0, delay: settled(v) }, ...now } };
      case "push":
      case "dissolve":
        return { opacity: 0, mixBlendMode: "plus-lighter", zIndex: v.back ? 1 : 0, transition: { ...(t ?? MOTION.page), ...now } };
      default:
        return { opacity: 0, zIndex: 0, transition: { ...(t ?? MOTION.morph), opacity: { duration: 0, delay: settled(v) }, ...now } };
    }
  },
};`),
  ],
};

/** screenVariants for the feel. */
export const variantsCode = (feel: Feel): string[] => VARIANTS[feel]();

const CALM: Record<Feel, string[]> = {
  ios: ["/** With Reduce Motion on, pages cross-fade instead of moving, as iOS does (Prefer Cross-Fade Transitions). */", `const calm = (v: Via | undefined, reduced: boolean): Via | undefined => (reduced && v && v.kind !== "smart" && !v.transition ? { ...v, kind: "dissolve" } : v);`],
  android: ["/** With animations removed (Android's accessibility setting), pages change at once. */", `const calm = (v: Via | undefined, reduced: boolean): Via | undefined => (reduced && v ? { ...v, transition: { duration: 0 } } : v);`],
  web: ["/** With reduced motion asked for, pages cross-fade instead of moving. */", `const calm = (v: Via | undefined, reduced: boolean): Via | undefined => (reduced && v && v.kind !== "smart" && !v.transition ? { ...v, kind: "dissolve" } : v);`],
};

/** calm(): what Reduce Motion makes of a change of screen. */
export const calmCode = (feel: Feel): string[] => CALM[feel];

// ---------------------------------------------------------------------------
// Swiping back

/**
 * Whether a feel's screens swipe back. iOS: from the leading edge, as UIKit's navigation does.
 * Android's back gesture is the system's, which decides how far it has gone, whether it commits and
 * (for activities) draws the preview; React Navigation leaves its stack's gesture off there too.
 */
export const swipesBack = (feel: Feel) => feel === "ios";

/**
 * useSwipeBack, for a feel whose screens swipe back (else nothing). `press`: the module has press
 * feedback, which a swipe ends.
 */
export function swipeCode(feel: Feel, im: Imports, press: boolean): string[] {
  if (!swipesBack(feel)) return [];
  ["useRef", "useState", "type CSSProperties", "type PointerEvent as ReactPointerEvent"].forEach((x) => im.react.add(x));
  ["animate", "useMotionValue", "useTransform"].forEach((x) => im.motion.add(x));
  const sw = IOS.swipe;
  return [
    "/**",
    " * Swiping back, as UIKit's navigation does it (React Navigation's Card, with its gesture defaults): a",
    ` * drag that starts within ${num(sw.edge)}px of the leading edge takes hold once it has gone ${num(sw.start)}px along, unless it`,
    ` * went ${num(sw.slack)}px up or down first. The screen on top follows the finger and the one before it shows`,
    " * underneath, coming from −30% as its dim lifts (forHorizontalIOS, by how far the top one has gone).",
    ` * Let go, it closes when where it is plus ${num(sw.impact)}s at the speed it left with is past half the width,`,
    " * else springs back: either way on the navigation spring, carrying that speed. A screen swipes back",
    " * when it was pushed and has come in, with nothing open over it.",
    " */",
    `const SWIPE = { edge: ${num(sw.edge)}, start: ${num(sw.start)}, slack: ${num(sw.slack)}, impact: ${num(sw.impact)} };`,
    "",
    ...lines(`
/**
 * The swipe on a device \`width\` wide, toward the trailing edge of the screen it goes back to (\`rtl\`):
 * \`can\` says whether it may start now, \`pop\` goes back once it has closed. While \`on\`, the screen
 * on top moves by \`x\` and the one under it by \`under\`, dimmed by \`dim\`.
 */
function useSwipeBack(width: number, rtl: boolean, can: () => boolean, pop: () => void) {
  // How far the finger has pulled the screen on top, in px: what the spring finishes, carrying its speed.
  const pull = useMotionValue(0);
  const [on, setOn] = useState(false);
  // Its width and way, kept from when it takes hold: the screen it goes back to has its own, and moves nothing still leaving.
  const way = useRef({ width, s: 1 });
  // How much of the way it has gone, kept between rest and gone as React Navigation's interpolation is.
  const gone = useTransform(() => Math.min(1, Math.max(0, pull.get() / way.current.width)));
  const x = useTransform(() => gone.get() * 100 * way.current.s + "%");
  const under = useTransform(() => UNDER.shift * (1 - gone.get()) * way.current.s + "%");
  const dim = useTransform(() => dimmed(UNDER.dim * (1 - gone.get())));
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || on || !can()) return;
    const s = rtl ? -1 : 1;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    // The stage may show the device smaller (CSS zoom): the pointer moves in its pixels, the screen in the device's.
    const zoom = r.width / el.offsetWidth || 1;
    if ((rtl ? r.right - e.clientX : e.clientX - r.left) / zoom > SWIPE.edge) return;
    const from = { x: e.clientX, y: e.clientY };
    let held = false;
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    const move = (m: PointerEvent) => {
      const along = ((m.clientX - from.x) / zoom) * s;
      if (!held) {
        // Up or down first, it isn't a swipe; along, it takes hold.
        if (Math.abs(m.clientY - from.y) / zoom > SWIPE.slack) return stop();
        if (along < SWIPE.start) return;
        held = true;${press ? "\n        unpress?.();" : ""}
        getSelection()?.removeAllRanges();
        window.addEventListener("click", swallow, true);
        way.current = { width, s };
        pull.jump(along);
        setOn(true);
      }
      pull.set(along);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("dragstart", swallow, true);
    };
    const up = (u: PointerEvent) => {
      stop();
      if (!held) return;
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      const speed = pull.getVelocity();
      const closes = u.type === "pointerup" && pull.get() + SWIPE.impact * speed > width / 2;
      void animate(pull, closes ? width : 0, { ...MOTION.page, velocity: speed }).then(() => {
        if (closes) pop();
        setOn(false);
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // Dragging from the edge doesn't drag a picture away.
    window.addEventListener("dragstart", swallow, true);
  };
  return { on, x, under, dim, onPointerDown };
}

/** While a swipe holds the screens (and until it has finished), they take no taps and select no text. */
const SWIPING: CSSProperties = { pointerEvents: "none", userSelect: "none" };`),
  ];
}

// ---------------------------------------------------------------------------
// The overlay layer

const LAYER = lines(`
/** Above the screen and its pinned bars; only what's open takes taps. */
const LAYER: CSSProperties = { position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" };
/** Scrims dim with black, as the platform's do. */
const SCRIM: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "auto", backgroundColor: "#000" };
const CENTRE: CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" };

interface Size {
  width: number;
  height: number;
}

function Overlays({ s, size, act, reduced }: { s: State; size: Size; act: Act; reduced: boolean }) {
  const { screen, open, anchors } = s;
  const parts = PARTS[screen] ?? {};
  const shown = open.filter((p) => parts[p] && parts[p].kind !== "bar");
  return (
    <div style={LAYER}>
      <AnimatePresence>
        {shown.map((p) => (
          <Overlay key={screen + "/" + p} part={p} def={parts[p]} anchor={anchors[p]} size={size} act={act} s={s} reduced={reduced} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Overlay({ part, def, anchor, size, act, s, reduced }: { part: string; def: PartDef; anchor?: Box; size: Size; act: Act; s: State; reduced: boolean }) {
  const { Part, kind, dismiss } = def;
  const close = () => act({ do: "close", part });
  useEffect(() => {
    if (kind !== "toast" || !dismiss.includes("timer")) return;
    const t = setTimeout(() => act({ do: "close", part }), def.ms ?? 3000);
    return () => clearTimeout(t);
  }, [kind, dismiss, def.ms, act, part]);
  const body = <Part act={act} s={s} />;
  if (kind === "sheet")
    return (
      <Sheet def={def} size={size} close={close} reduced={reduced}>
        {body}
      </Sheet>
    );
  if (kind === "dialog")
    return (
      <Dialog def={def} close={close}>
        {body}
      </Dialog>
    );
  if (kind === "toast") return <Toast def={def}>{body}</Toast>;
  return (
    <Menu def={def} anchor={anchor} size={size} close={close}>
      {body}
    </Menu>
  );
}

/** Where a sheet sits: along the bottom, up to 48px from the top (a full one reaches it). */
const sheetBox = (def: PartDef): CSSProperties => ({ position: "absolute", insetInline: 0, bottom: 0, top: def.detent === "full" ? 48 : undefined, maxHeight: "calc(100% - 48px)", display: "flex", flexDirection: "column", pointerEvents: "auto" });

/**
 * Drags a sheet: it follows the pointer down and resists going up past where it rests
 * ((√(1 + over) − 1) × 2.5px, @gorhom/bottom-sheet's over-drag); let go, \`release\` gets where it is
 * and how fast it was going (px/s). A drag isn't a tap: what it began on stops looking pressed, and
 * the click it ends in is swallowed.
 */
function dragSheet(y: MotionValue<number>, on: { start?: () => void; release: (at: number, speed: number) => void }) {
  return (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    // The stage may show the device smaller (CSS zoom): the pointer moves in its pixels, the sheet in the device's.
    const zoom = el.getBoundingClientRect().height / el.offsetHeight || 1;
    const from = e.clientY;
    const start = y.get();
    let dragging = false;
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    const move = (m: PointerEvent) => {
      const d = (m.clientY - from) / zoom;
      if (!dragging && Math.abs(d) < 8) return;
      if (!dragging) {
        dragging = true;
        unpress?.();
        window.addEventListener("click", swallow, true);
        on.start?.();
      }
      const at = start + d;
      y.set(at >= 0 ? at : -(Math.sqrt(1 - at) - 1) * 2.5);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      on.release(y.get(), y.getVelocity());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
}

/** Where a menu goes: under what opened it (above when there's no room), on the side of the screen that is on, unfolding from that corner. */
function menuPlace(anchor: Box | undefined, size: Size, width: number) {
  const at = anchor ?? { x: size.width / 2, y: size.height / 3, w: 0, h: 0 };
  const start = at.x + at.w / 2 < size.width / 2;
  const below = at.y + at.h + 8 + 240 < size.height;
  const pos: CSSProperties = {
    position: "absolute",
    width,
    pointerEvents: "auto",
    ...(start ? { left: Math.max(8, at.x) } : { right: Math.max(8, size.width - at.x - at.w) }),
    ...(below ? { top: at.y + at.h + 8 } : { bottom: size.height - at.y + 8 }),
    transformOrigin: (below ? "top" : "bottom") + " " + (start ? "left" : "right"),
  };
  return { pos, below };
}

/** A menu's backdrop: nothing to see, it only takes the tap that closes the menu. */
const MENU_BACKDROP: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "auto" };

/** A toast's place: along the bottom, above the home indicator, sliding from below the screen's edge. */
const TOAST_BOX: CSSProperties = { position: "absolute", insetInline: 0, bottom: 0, paddingBottom: 58, display: "flex", justifyContent: "center", pointerEvents: "none" };`);

const SHEET_IOS = [
  "/** iOS sheets: the screen behind dims to 20% (ModalPresentationIOS, iOS 26); let go, a sheet heads for where it'd be 0.2s on, settling with half the speed it left with (@gorhom/bottom-sheet). */",
  `const SHEET = { dim: ${num(IOS.sheet.dim)}, project: ${num(IOS.sheet.project)}, carry: ${num(IOS.sheet.carry)} };`,
  "",
  ...lines(`
/**
 * A sheet, as iOS presents one (React Navigation's ModalPresentationIOS, @gorhom/bottom-sheet on
 * iOS): it rises on the navigation spring as the screen behind dims with it. It follows a drag down
 * and resists one up; let go, it closes when where it was heading is past halfway down, else
 * springs back up, carrying its speed into the spring. With Reduce Motion it fades instead.
 */
function Sheet({ def, size, close, reduced, children }: { def: PartDef; size: Size; close: () => void; reduced: boolean; children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const box = useRef<HTMLDivElement>(null);
  const height = useRef(size.height);
  const y = useMotionValue(reduced ? 0 : size.height);
  const shown = useMotionValue(reduced ? 0 : 1);
  const fling = useRef(0);
  const dim = useTransform(() => SHEET.dim * shown.get() * Math.min(1, Math.max(0, 1 - y.get() / height.current)));
  useLayoutEffect(() => {
    height.current = box.current?.offsetHeight || size.height;
    if (reduced) {
      const a = animate(shown, 1, MOTION.change);
      return () => a.stop();
    }
    y.set(height.current);
    const a = animate(y, 0, MOTION.page);
    return () => a.stop();
  }, [reduced, size.height, y, shown]);
  useEffect(() => {
    if (present) return;
    const a = reduced ? animate(shown, 0, MOTION.change) : animate(y, height.current, { ...MOTION.page, velocity: fling.current });
    void a.then(() => safeToRemove?.());
    return () => a.stop();
  }, [present, reduced, safeToRemove, y, shown]);
  const release = (at: number, speed: number) => {
    if (at + SHEET.project * speed > height.current / 2) {
      fling.current = speed * SHEET.carry;
      close();
    } else void animate(y, 0, { ...MOTION.page, velocity: speed * SHEET.carry });
  };
  const drag = def.dismiss.includes("drag");
  return (
    <>
      <motion.div style={{ ...SCRIM, opacity: dim }} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div ref={box} role="dialog" aria-modal onPointerDown={drag ? dragSheet(y, { release }) : undefined} style={{ ...sheetBox(def), y, opacity: shown, overflowY: drag ? "hidden" : "auto" }}>
        {children}
      </motion.div>
    </>
  );
}`),
];

const SHEET_ANDROID = [
  "/** Material 3 sheets on Android: MDC's m3_bottom_sheet_slide_in/out, the window dim (DimmerAnimationHelper), and @gorhom/bottom-sheet's Android settle. */",
  "const SHEET = {",
  `  rise: ${num(ANDROID.sheet.rise)},`,
  `  dim: ${num(ANDROID.sheet.dim)},`,
  `  project: ${num(ANDROID.sheet.project)},`,
  `  in: ${timingCode(ANDROID.sheet.in)} as Transition,`,
  `  out: ${timingCode(ANDROID.sheet.out)} as Transition,`,
  `  fadeOut: ${timingCode(ANDROID.sheet.fadeOut)} as Transition,`,
  `  dimIn: ${timingCode(ANDROID.sheet.dimIn)} as Transition,`,
  `  dimOut: ${timingCode(ANDROID.sheet.dimOut)} as Transition,`,
  `  settle: ${timingCode(ANDROID.sheet.settle)} as Transition,`,
  "};",
  "",
  ...lines(`
/**
 * A sheet, as Material 3 shows one on Android (React Navigation's BottomSheetAndroid): it rises a
 * fifth of the screen as it fades in, 400ms on the emphasized curve, as the screen behind dims to
 * 32% in 128ms; it leaves the same way in 350ms (fading over 300ms), the dim gone in 112ms. Dragged,
 * it follows and the dim with it; let go, it settles where it was heading (where it'd be 0.2s on:
 * gorhom's snapPoint) in 250ms, closing when that's past halfway down. With animations off it just
 * shows.
 */
function Sheet({ def, size, close, reduced, children }: { def: PartDef; size: Size; close: () => void; reduced: boolean; children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const box = useRef<HTMLDivElement>(null);
  const height = useRef(size.height);
  const rise = size.height * SHEET.rise;
  const y = useMotionValue(reduced ? 0 : rise);
  const shown = useMotionValue(reduced ? 1 : 0);
  const dim = useMotionValue(reduced ? SHEET.dim : 0);
  // Dragged (and until it has settled after), the dim follows the sheet.
  const dragged = useRef(false);
  useMotionValueEvent(y, "change", (at) => {
    if (dragged.current) dim.set(SHEET.dim * Math.min(1, Math.max(0, 1 - at / height.current)));
  });
  useLayoutEffect(() => {
    height.current = box.current?.offsetHeight || size.height;
    if (reduced) return;
    const all = [animate(y, 0, SHEET.in), animate(shown, 1, SHEET.in), animate(dim, SHEET.dim, SHEET.dimIn)];
    return () => all.forEach((a) => a.stop());
  }, [reduced, size.height, y, shown, dim]);
  useEffect(() => {
    if (present) return;
    if (reduced) return void safeToRemove?.();
    const all = dragged.current ? [animate(y, height.current, SHEET.settle)] : [animate(y, rise, SHEET.out), animate(shown, 0, SHEET.fadeOut), animate(dim, 0, SHEET.dimOut)];
    void Promise.all(all).then(() => safeToRemove?.());
    return () => all.forEach((a) => a.stop());
  }, [present, reduced, rise, safeToRemove, y, shown, dim]);
  const release = (at: number, speed: number) => {
    if (at + SHEET.project * speed > height.current / 2) close();
    else void animate(y, 0, SHEET.settle).then(() => (dragged.current = false));
  };
  const drag = def.dismiss.includes("drag");
  return (
    <>
      <motion.div style={{ ...SCRIM, opacity: dim }} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div
        ref={box}
        role="dialog"
        aria-modal
        onPointerDown={drag ? dragSheet(y, { start: () => (dragged.current = true), release }) : undefined}
        style={{ ...sheetBox(def), y, opacity: shown, overflowY: drag ? "hidden" : "auto" }}
      >
        {children}
      </motion.div>
    </>
  );
}`),
];

const SHEET_WEB = [
  "/** Web sheets, as Vaul draws them: 500ms on cubic-bezier(0.32, 0.72, 0, 1); dragged, they close past a quarter of their height or let go faster than 0.4px/ms. shadcn/ui's overlay: 50% black. */",
  `const SHEET = { timing: ${timingCode(WEB.sheet.timing)} as Transition, dim: ${num(WEB.sheet.dim)}, closeAt: ${num(WEB.sheet.closeAt)}, flick: ${num(WEB.sheet.flick)} };`,
  "",
  ...lines(`
/**
 * A sheet, as Vaul draws one (shadcn/ui's Drawer): up from the bottom over a dim that follows it.
 * Dragged down past a quarter of its height, or let go fast enough, it closes; otherwise it goes
 * back up. With reduced motion it fades instead.
 */
function Sheet({ def, size, close, reduced, children }: { def: PartDef; size: Size; close: () => void; reduced: boolean; children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const box = useRef<HTMLDivElement>(null);
  const height = useRef(size.height);
  const y = useMotionValue(reduced ? 0 : size.height);
  const shown = useMotionValue(reduced ? 0 : 1);
  const dim = useTransform(() => SHEET.dim * shown.get() * Math.min(1, Math.max(0, 1 - y.get() / height.current)));
  useLayoutEffect(() => {
    height.current = box.current?.offsetHeight || size.height;
    if (reduced) {
      const a = animate(shown, 1, MOTION.change);
      return () => a.stop();
    }
    y.set(height.current);
    const a = animate(y, 0, SHEET.timing);
    return () => a.stop();
  }, [reduced, size.height, y, shown]);
  useEffect(() => {
    if (present) return;
    const a = reduced ? animate(shown, 0, MOTION.change) : animate(y, height.current, SHEET.timing);
    void a.then(() => safeToRemove?.());
    return () => a.stop();
  }, [present, reduced, safeToRemove, y, shown]);
  const release = (at: number, speed: number) => {
    if (at > SHEET.closeAt * height.current || speed > SHEET.flick) close();
    else void animate(y, 0, SHEET.timing);
  };
  const drag = def.dismiss.includes("drag");
  return (
    <>
      <motion.div style={{ ...SCRIM, opacity: dim }} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div ref={box} role="dialog" aria-modal onPointerDown={drag ? dragSheet(y, { release }) : undefined} style={{ ...sheetBox(def), y, opacity: shown, overflowY: drag ? "hidden" : "auto" }}>
        {children}
      </motion.div>
    </>
  );
}`),
];

/** A dialog: its scrim and the box, scaling from `from` as it fades in and to `to` as it fades out. */
const dialog = (doc: string[], transition: string, scrim: string) =>
  lines(`
${doc.join("\n")}
function Dialog({ def, close, children }: { def: PartDef; close: () => void; children: ReactNode }) {
  return (
    <>
      <motion.div style={SCRIM} initial={{ opacity: 0 }} animate={{ opacity: DIALOG.dim }} exit={{ opacity: 0 }} transition={${scrim}} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <div style={CENTRE}>
        <motion.div role="alertdialog" aria-modal initial={{ opacity: 0, scale: DIALOG.from }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: DIALOG.to }} transition={${transition}} style={{ width: def.width, pointerEvents: "auto" }}>
          {children}
        </motion.div>
      </div>
    </>
  );
}`);

const DIALOGS: Record<Feel, () => string[]> = {
  ios: () => [
    "/** iOS alerts, as Ionic's iOS alert has them: 200ms ease-in-out over a 30% dim. */",
    `const DIALOG = { from: ${num(IOS.alert.from)}, to: ${num(IOS.alert.to)}, dim: ${num(IOS.alert.dim)}, timing: ${timingCode(IOS.alert.timing)} as Transition };`,
    "",
    ...dialog(["/** A dialog, as iOS alerts come and go: in from 110% as it fades in, out to 90% as it fades. */"], "DIALOG.timing", "DIALOG.timing"),
  ],
  android: () => [
    "/** AOSP's dialog window animation (React Navigation's DialogAndroid): scaling from 90% over 220ms (decelerating, power 5), fading over 150ms (power 3), the dim at 60% in 132ms. */",
    "const DIALOG = {",
    `  from: ${num(ANDROID.dialog.from)},`,
    `  to: ${num(ANDROID.dialog.from)},`,
    `  dim: ${num(ANDROID.dialog.dim)},`,
    `  timing: { scale: ${timingCode(ANDROID.dialog.scale)}, opacity: ${timingCode(ANDROID.dialog.fade)} } as Transition,`,
    `  dimTiming: ${timingCode(ANDROID.dialog.dimTiming)} as Transition,`,
    "};",
    "",
    ...dialog(["/** A dialog, as Android's come and go: from 90% as it fades in, back to 90% as it fades out. */"], "DIALOG.timing", "DIALOG.dimTiming"),
  ],
  web: () => [
    "/** shadcn/ui's Dialog (Radix): from 95%, 200ms ease, over 50% black. */",
    `const DIALOG = { from: ${num(WEB.dialog.from)}, to: ${num(WEB.dialog.from)}, dim: ${num(WEB.dialog.dim)}, timing: ${timingCode(WEB.dialog.timing)} as Transition };`,
    "",
    ...dialog(["/** A dialog, as the web's come and go: from 95% as it fades in, back as it fades out. */"], "DIALOG.timing", "DIALOG.timing"),
  ],
};

const TOASTS: Record<Feel, () => string[]> = {
  ios: () => [
    "/** iOS has no system toast: Ionic's iOS toast slides one up from the edge with a slight overshoot (400ms), and back down (300ms). */",
    `const TOAST = { in: ${timingCode(IOS.toast.in)} as Transition, out: ${timingCode(IOS.toast.out)} as Transition };`,
    "",
    ...lines(`
function Toast({ def, children }: { def: PartDef; children: ReactNode }) {
  return (
    <motion.div role="status" style={TOAST_BOX} initial={{ y: "100%" }} animate={{ y: 0, transition: TOAST.in }} exit={{ y: "100%", transition: TOAST.out }}>
      <div style={{ width: def.width, pointerEvents: "auto" }}>{children}</div>
    </motion.div>
  );
}`),
  ],
  android: () => [
    "/** A snackbar (MDC's BaseTransientBottomBar, with M3's motionDurationLong2 and emphasized easing): up from below in 500ms, and back down. */",
    `const TOAST = ${timingCode(ANDROID.toast)} satisfies Transition;`,
    "",
    ...lines(`
function Toast({ def, children }: { def: PartDef; children: ReactNode }) {
  return (
    <motion.div role="status" style={TOAST_BOX} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={TOAST}>
      <div style={{ width: def.width, pointerEvents: "auto" }}>{children}</div>
    </motion.div>
  );
}`),
  ],
  web: () => [
    "/** Sonner: up from below as it fades in, 400ms ease, and back. */",
    `const TOAST = ${timingCode(WEB.toast)} satisfies Transition;`,
    "",
    ...lines(`
function Toast({ def, children }: { def: PartDef; children: ReactNode }) {
  return (
    <motion.div role="status" style={TOAST_BOX} initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }} transition={TOAST}>
      <div style={{ width: def.width, pointerEvents: "auto" }}>{children}</div>
    </motion.div>
  );
}`),
  ],
};

const MENUS: Record<Feel, () => string[]> = {
  ios: () => [
    "/**",
    " * UIKit publishes no numbers for its pull-down menus, which grow out of what opened them with a",
    " * little bounce: SwiftUI's snappy spring from half size stands in, fading in over 100ms; they leave",
    " * faster, shrinking to 90% as they fade (Spring.smooth at 0.3s).",
    " */",
    `const MENU = { from: ${num(IOS.menu.from)}, to: ${num(IOS.menu.to)}, in: { scale: ${timingCode(IOS.menu.in)}, opacity: ${timingCode(IOS.menu.fade)} } as Transition, out: ${timingCode(IOS.menu.out)} as Transition };`,
    "",
    ...lines(`
function Menu({ def, anchor, size, close, children }: { def: PartDef; anchor?: Box; size: Size; close: () => void; children: ReactNode }) {
  const { pos } = menuPlace(anchor, size, def.width);
  return (
    <>
      <div style={MENU_BACKDROP} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div role="menu" style={pos} initial={{ opacity: 0, scale: MENU.from }} animate={{ opacity: 1, scale: 1, transition: MENU.in }} exit={{ opacity: 0, scale: MENU.to, transition: MENU.out }}>
        {children}
      </motion.div>
    </>
  );
}`),
  ],
  android: () => [
    "/** A Material 3 menu (material-web's md-menu): it unfolds from its edge in 500ms (emphasized), the surface fading in over 50ms; it folds to 35% in 150ms (emphasized accelerate), fading in the last 50ms. */",
    "const MENU = {",
    `  in: { clipPath: ${timingCode(ANDROID.menu.in)}, opacity: ${timingCode(ANDROID.menu.fadeIn)} } as Transition,`,
    `  out: { clipPath: ${timingCode(ANDROID.menu.out)}, opacity: ${timingCode(ANDROID.menu.fadeOut)} } as Transition,`,
    `  folded: ${num(Math.round((1 - ANDROID.menu.closedTo) * 100))},`,
    "};",
    "",
    ...lines(`
function Menu({ def, anchor, size, close, children }: { def: PartDef; anchor?: Box; size: Size; close: () => void; children: ReactNode }) {
  const { pos, below } = menuPlace(anchor, size, def.width);
  // Unfolding from the edge next to what opened it: the top when it opens below, the bottom above.
  const fold = (hidden: number) => (below ? "inset(0% 0% " + hidden + "% 0%)" : "inset(" + hidden + "% 0% 0% 0%)");
  return (
    <>
      <div style={MENU_BACKDROP} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div
        role="menu"
        style={pos}
        initial={{ clipPath: fold(100), opacity: 0 }}
        animate={{ clipPath: fold(0), opacity: 1, transition: MENU.in, transitionEnd: { clipPath: "none" } }}
        exit={{ clipPath: fold(MENU.folded), opacity: 0, transition: MENU.out }}
      >
        {children}
      </motion.div>
    </>
  );
}`),
  ],
  web: () => [
    "/** shadcn/ui's DropdownMenu (Radix, tw-animate-css): from 95% and 8px from where it opens from as it fades in, 150ms ease. */",
    `const MENU = { from: ${num(WEB.menu.from)}, slide: ${num(WEB.menu.slide)}, timing: ${timingCode(WEB.menu.timing)} as Transition };`,
    "",
    ...lines(`
function Menu({ def, anchor, size, close, children }: { def: PartDef; anchor?: Box; size: Size; close: () => void; children: ReactNode }) {
  const { pos, below } = menuPlace(anchor, size, def.width);
  return (
    <>
      <div style={MENU_BACKDROP} onClick={def.dismiss.includes("scrim") ? close : undefined} />
      <motion.div role="menu" style={pos} initial={{ opacity: 0, scale: MENU.from, y: below ? -MENU.slide : MENU.slide }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: MENU.from }} transition={MENU.timing}>
        {children}
      </motion.div>
    </>
  );
}`),
  ],
};

const SHEETS: Record<Feel, string[]> = { ios: SHEET_IOS, android: SHEET_ANDROID, web: SHEET_WEB };

/** The overlay layer for the feel: Overlays, and how each kind of part comes and goes. */
export function overlayCode(feel: Feel, im: Imports): string[] {
  ["useEffect", "useLayoutEffect", "useRef", "type CSSProperties", "type ReactNode", "type PointerEvent as ReactPointerEvent"].forEach((x) => im.react.add(x));
  ["AnimatePresence", "animate", "motion", "type MotionValue", "useMotionValue", "usePresence", "type Transition"].forEach((x) => im.motion.add(x));
  if (feel === "android") im.motion.add("useMotionValueEvent");
  else im.motion.add("useTransform");
  return [...LAYER, "", ...SHEETS[feel], "", ...DIALOGS[feel](), "", ...TOASTS[feel](), "", ...MENUS[feel]()];
}

// ---------------------------------------------------------------------------
// Press feedback

const INK = lines(`
/** What a press tints with: black over something light, white over something dark (the nearest painted background). */
function inkOver(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    const c = bg.match(/[\\d.]+/g)?.map(Number);
    if (!c || c.length < 3 || (c.length > 3 && c[3] < 0.5)) continue;
    const k = bg.startsWith("color(") ? 255 : 1;
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * k < 128 ? "#fff" : "#000";
  }
  return "#000";
}

/** The press showing, to end it (a drag that began on it takes over). */
let unpress: (() => void) | null = null;
/** Pointer events a tap target has taken: the innermost one only, as React Native's responder grants a touch to one view. */
const pressed = new WeakSet<Event>();`);

const PRESS: Record<Feel, string[]> = {
  ios: lines(`
/** Pressed: from the pointer going down on a tap target until it lets go or slips off. The look is in qalamCSS. */
function press(e: ReactPointerEvent<HTMLElement>) {
  if (e.button !== 0 || pressed.has(e.nativeEvent)) return;
  pressed.add(e.nativeEvent);
  unpress?.();
  const el = e.currentTarget;
  el.style.setProperty("--q-ink", inkOver(el));
  el.dataset.pressed = "";
  const off = () => {
    delete el.dataset.pressed;
    for (const t of ["pointerup", "pointercancel"]) window.removeEventListener(t, off);
    el.removeEventListener("pointerleave", off);
    if (unpress === off) unpress = null;
  };
  unpress = off;
  for (const t of ["pointerup", "pointercancel"]) window.addEventListener(t, off);
  el.addEventListener("pointerleave", off);
}`),
  android: [
    `/** The ripple (material-web): it grows from ${num(ANDROID.press.from * 100)}% of its reach at the touch; let go, it fades once it has shown ${num(ANDROID.press.minimum * 1000)}ms, over ${num(ANDROID.press.fadeOut * 1000)}ms. */`,
    `const RIPPLE = { from: ${num(ANDROID.press.from)}, minimum: ${num(ANDROID.press.minimum * 1000)}, fade: ${num(ANDROID.press.fadeOut * 1000)} };`,
    "",
    ...lines(`
/** Pressed: a ripple from where the pointer went down, until it lets go or slips off. The look is in qalamCSS. */
function press(e: ReactPointerEvent<HTMLElement>) {
  if (e.button !== 0 || pressed.has(e.nativeEvent)) return;
  pressed.add(e.nativeEvent);
  unpress?.();
  const el = e.currentTarget;
  // The stage may show the device smaller (CSS zoom): the pointer is in its pixels, the ripple in the element's.
  const r = el.getBoundingClientRect();
  const zoom = r.width / el.offsetWidth || 1;
  const x = (e.clientX - r.left) / zoom;
  const y = (e.clientY - r.top) / zoom;
  const reach = Math.hypot(Math.max(x, el.offsetWidth - x), Math.max(y, el.offsetHeight - y));
  el.style.setProperty("--q-ink", inkOver(el));
  el.style.setProperty("--q-x", x + "px");
  el.style.setProperty("--q-y", y + "px");
  el.style.setProperty("--q-from", reach * RIPPLE.from + "px");
  el.style.setProperty("--q-reach", reach + "px");
  // It grows from here, this time: the style is read before it's held.
  delete el.dataset.held;
  void getComputedStyle(el, "::after").getPropertyValue("--q-ripple");
  el.dataset.held = "";
  el.dataset.pressed = "";
  const t0 = performance.now();
  const off = () => {
    for (const t of ["pointerup", "pointercancel"]) window.removeEventListener(t, off);
    el.removeEventListener("pointerleave", off);
    if (unpress === off) unpress = null;
    setTimeout(() => {
      delete el.dataset.pressed;
      setTimeout(() => {
        if (el.dataset.pressed === undefined) delete el.dataset.held;
      }, RIPPLE.fade);
    }, Math.max(0, RIPPLE.minimum - (performance.now() - t0)));
  };
  unpress = off;
  for (const t of ["pointerup", "pointercancel"]) window.addEventListener(t, off);
  el.addEventListener("pointerleave", off);
}`),
  ],
  web: lines(`
/** Hovered: the state layer takes the ink of what's under it. */
const hover = (e: ReactPointerEvent<HTMLElement>) => e.currentTarget.style.setProperty("--q-ink", inkOver(e.currentTarget));

/** Pressed: from the pointer going down on a tap target until it lets go or slips off. The look is in qalamCSS. */
function press(e: ReactPointerEvent<HTMLElement>) {
  if (e.button !== 0 || pressed.has(e.nativeEvent)) return;
  pressed.add(e.nativeEvent);
  unpress?.();
  const el = e.currentTarget;
  el.style.setProperty("--q-ink", inkOver(el));
  el.dataset.pressed = "";
  const off = () => {
    delete el.dataset.pressed;
    for (const t of ["pointerup", "pointercancel"]) window.removeEventListener(t, off);
    el.removeEventListener("pointerleave", off);
    if (unpress === off) unpress = null;
  };
  unpress = off;
  for (const t of ["pointerup", "pointercancel"]) window.addEventListener(t, off);
  el.addEventListener("pointerleave", off);
}`),
};

/** inkOver, press (and hover on the web): what a tap target does while it's pressed. */
export function pressCode(feel: Feel, im: Imports): string[] {
  im.react.add("type PointerEvent as ReactPointerEvent");
  return [...INK, "", ...PRESS[feel]];
}

/** The props tap() adds for press feedback (and hover on the web). */
export const pressProps = (feel: Feel): string[] => (feel === "web" ? [`"data-press": look,`, "onPointerDown: press,", "onPointerEnter: hover,"] : [`"data-press": look,`, "onPointerDown: press,"]);

const css = (t: { duration: number; ease: Ease }) => `${Math.round(t.duration * 1000)}ms cubic-bezier(${(t.ease as number[]).join(", ")})`;

/** The look of a press, as CSS for qalamCSS: tap targets carry data-press ("dim": a control, "fill": a row, a card, a filled button) and data-pressed while pressed. */
export function pressCss(feel: Feel): string {
  if (feel === "ios") {
    const out = css(IOS.press.release);
    return [
      `/* Pressed, as iOS has it: React Navigation's PlatformPressable (at once to ${num(IOS.press.opacity * 100)}%, back over ${num(IOS.press.release.duration * 1000)}ms); rows, cards and filled buttons darken ${num(IOS.press.row * 100)}%, as TouchableHighlight does. */`,
      `.q-screen [data-press] { cursor: pointer; -webkit-tap-highlight-color: transparent; transition: filter ${out}; }`,
      `.q-screen [data-press="dim"][data-pressed] { filter: opacity(${num(IOS.press.opacity)}); transition-duration: 0s; }`,
      `.q-screen [data-press="fill"]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--q-ink, #000); opacity: 0; pointer-events: none; transition: opacity ${out}; }`,
      `.q-screen [data-press="fill"][data-pressed]::after { opacity: ${num(IOS.press.row)}; transition-duration: 0s; }`,
    ].join("\n");
  }
  if (feel === "android") {
    const p = ANDROID.press;
    const grow = `--q-ripple ${css(p.grow)}`;
    return [
      `/* Pressed, as Android has it: Material's ripple from the touch, growing over ${num(p.grow.duration * 1000)}ms at ${num(p.opacity * 100)}%, fading over ${num(p.fadeOut * 1000)}ms once let go. */`,
      `@property --q-ripple { syntax: "<length>"; inherits: false; initial-value: 0px; }`,
      `.q-screen [data-press] { cursor: pointer; -webkit-tap-highlight-color: transparent; }`,
      `.q-screen [data-press]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; --q-ripple: var(--q-from, 0px); background: radial-gradient(circle at var(--q-x, 50%) var(--q-y, 50%), var(--q-ink, #000) var(--q-ripple), transparent calc(var(--q-ripple) + 1px)); transition: opacity ${num(p.fadeOut * 1000)}ms linear; }`,
      `.q-screen [data-press][data-held]::after { --q-ripple: var(--q-reach, 0px); transition: ${grow}, opacity ${num(p.fadeOut * 1000)}ms linear; }`,
      `.q-screen [data-press][data-pressed]::after { opacity: ${num(p.opacity)}; transition: ${grow}, opacity ${num(p.fadeIn * 1000)}ms linear; }`,
    ].join("\n");
  }
  const t = css(WEB.change as { duration: number; ease: Ease });
  return [
    `/* Hovered and pressed, as the web has it: a state layer, ${num(WEB.press.hover * 100)}% on hover and ${num(WEB.press.pressed * 100)}% pressed (Material's), over Tailwind's default transition. */`,
    `.q-screen [data-press] { cursor: pointer; }`,
    `.q-screen [data-press]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--q-ink, #000); opacity: 0; pointer-events: none; transition: opacity ${t}; }`,
    `.q-screen [data-press]:hover::after { opacity: ${num(WEB.press.hover)}; }`,
    `.q-screen [data-press][data-pressed]::after { opacity: ${num(WEB.press.pressed)}; }`,
  ].join("\n");
}

/** Components that press like controls (they dim); the rest press like rows and cards (they darken). */
const DIMS = new Set(["IconButton", "Icon", "Text", "Tag", "Tabs", "Tab", "SegmentedControl", "Segment", "Toggle", "Checkbox", "Radio", "Stepper", "Slider", "Scrubber", "Rating", "Avatar", "TextField", "SearchBar", "BottomNav", "Toolbar", "TopBar", "ChipGroup", "Chip"]);

/** How a tap target presses: "dim" for controls (icons, chips, tabs, text), "fill" for rows, cards and buttons wide enough to hold a label. */
export function pressLook(doc: Doc, id: string): "dim" | "fill" {
  const n = doc.nodes[id];
  if (!n || n.type === "text" || n.type === "icon") return "dim";
  for (let m: SceneNode | undefined = n; m; m = m.parentId ? doc.nodes[m.parentId] : undefined) {
    const comp = m.meta.component?.split("/")[0];
    if (comp) return DIMS.has(comp) ? "dim" : n.w >= 120 || m === n ? "fill" : "dim";
  }
  return n.w >= 120 ? "fill" : "dim";
}

/** The label a feel goes by ("Moves like iOS"). */
export const feelLabel = (feel: Feel) => FEEL_LABEL[feel];
