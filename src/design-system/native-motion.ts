/**
 * Native motion: how iOS, Android and the web move things, as numbers a prototype plays. Each value
 * comes from where the platform's behaviour is written down, and says where:
 *
 * - React Native: React Navigation's stack transition configs (TransitionSpecs,
 *   CardStyleInterpolators, ported from UIKit's navigation and AOSP's activity animations),
 *   @gorhom/bottom-sheet's animation configs and gestures, React Navigation's PlatformPressable and
 *   React Native's touchables.
 * - Apple: SwiftUI's documented springs (Animation.default, Spring.snappy).
 * - Material 3: MDC Android's motion tokens and components, material-web's ripple and menu, Compose
 *   Navigation's defaults.
 * - The web: the View Transitions API's default cross-fade, Vaul, Sonner, shadcn/ui (Radix,
 *   tw-animate-css) and Tailwind's default transition.
 *
 * iOS publishes no toast and no numbers for its menus: Ionic's iOS toast and a SwiftUI spring stand
 * in, and say so. Phone screens move like iOS unless the designer picks Android; web, dashboard and
 * desktop-app screens move like the web.
 */

export type Feel = "ios" | "android" | "web";
/** What a designer picks for phone screens. */
export type PhoneFeel = Exclude<Feel, "web">;

export const PHONE_FEELS: PhoneFeel[] = ["ios", "android"];
export const FEEL_LABEL: Record<Feel, string> = { ios: "iOS", android: "Android", web: "Web" };
export const isPhoneFeel = (v: unknown): v is PhoneFeel => v === "ios" || v === "android";

/** A spring as Motion takes one: mass on a spring, with damping. */
export interface Spring {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

/** Curves the compiled module defines as functions (a cubic Bézier can't draw them). */
export type CurveName = "emphasized" | "decelerate3" | "decelerate5" | "outExpo";
export type Ease = [number, number, number, number] | "linear" | CurveName;

/** A tween: seconds, an easing, and a delay. */
export interface Tween {
  duration: number;
  ease: Ease;
  delay?: number;
}

export type Timing = Spring | Tween;

export const isSpring = (t: Timing): t is Spring => "type" in t;

/** Down to two decimals, so a critically damped spring never tips into an overdamped one. */
const floor2 = (x: number) => Math.floor(x * 100) / 100;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * React Native's spring: stiffness, damping and mass, as Animated and Reanimated take them. Both
 * solvers play a damping ratio of 1 or more as critically damped, whatever the damping (Animated's
 * SpringAnimation and Reanimated's springUtils branch on zeta < 1), so it's written at critical
 * damping: Motion solves overdamped springs as they are, and React Navigation's iOS damping of 500
 * would crawl for nearly two seconds.
 */
export function rnSpring(stiffness: number, damping: number, mass: number): Spring {
  return { type: "spring", stiffness, damping: Math.min(damping, floor2(2 * Math.sqrt(stiffness * mass))), mass };
}

/**
 * Apple's spring (SwiftUI's Spring(duration:bounce:), or spring(response:dampingFraction:) with a
 * dampingFraction of 1 − bounce): mass 1, stiffness (2π / duration)², damping 4π(1 − bounce) / duration.
 */
export function appleSpring(duration: number, bounce = 0): Spring {
  const stiffness = round2(((2 * Math.PI) / duration) ** 2);
  return { type: "spring", stiffness, damping: floor2(2 * (1 - bounce) * Math.sqrt(stiffness)), mass: 1 };
}

/** Material's spring (Compose's spring(dampingRatio, stiffness), as the M3 motion scheme's tokens give it): mass 1. */
export function materialSpring(dampingRatio: number, stiffness: number): Spring {
  return { type: "spring", stiffness, damping: floor2(2 * dampingRatio * Math.sqrt(stiffness)), mass: 1 };
}

/** Where a spring is after `t` seconds of going from 0 to 1 at rest (simulated: any damping). */
export function springAt(s: Spring, t: number, step = 1e-4): number {
  let x = 0;
  let v = 0;
  for (let at = 0; at < t; at += step) {
    v += ((-s.stiffness * (x - 1) - s.damping * v) / s.mass) * step;
    x += v * step;
  }
  return x;
}

const settles = new Map<string, number>();

/** When a timing has visually arrived (a spring: within 0.5% of the way, for good), in seconds. */
export function settleTime(t: Timing, within = 0.005): number {
  if (!isSpring(t)) return t.duration + (t.delay ?? 0);
  const key = `${t.stiffness}/${t.damping}/${t.mass}/${within}`;
  const known = settles.get(key);
  if (known !== undefined) return known;
  const step = 1e-4;
  let x = 0;
  let v = 0;
  let last = 0;
  for (let at = 0; at < 10; at += step) {
    v += ((-t.stiffness * (x - 1) - t.damping * v) / t.mass) * step;
    x += v * step;
    if (Math.abs(1 - x) > within) last = at;
  }
  const out = Math.round((last + step) * 1000) / 1000;
  settles.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// iOS: UIKit and SwiftUI

const CSS_EASE_IN_OUT: Ease = [0.42, 0, 0.58, 1];

export const IOS = {
  /**
   * UINavigationController's push and pop, and UIKit's sheets: React Navigation's TransitionIOSSpec
   * ("an approximation of the standard iOS navigation transition", used for SlideFromRightIOS and
   * ModalPresentationIOS), and @gorhom/bottom-sheet's iOS animation config: stiffness 1000, damping
   * 500, mass 3, which React Native plays critically damped.
   */
  navigation: rnSpring(1000, 500, 3),
  /** forHorizontalIOS: the screen underneath moves a third of the way back, under a 10% black dim. */
  parallax: 0.3,
  pushDim: 0.1,
  /**
   * Swiping back (React Navigation's Card and gestureActivationCriteria, as UIKit's interactive pop):
   * a drag that starts within 50px of the leading edge (GESTURE_RESPONSE_DISTANCE_HORIZONTAL) takes
   * hold once it has gone 5px along (activeOffsetX), unless it went 20px up or down first
   * (failOffsetY). Let go, it closes when where it is plus 0.3 × its speed is past half the width
   * (GESTURE_VELOCITY_IMPACT), finishing on the navigation spring with that speed.
   */
  swipe: { edge: 50, start: 5, slack: 20, impact: 0.3 },
  /** SwiftUI's default animation since iOS 17: spring(response: 0.55, dampingFraction: 1). Changes in place, shared layers morphing, bars. */
  standard: appleSpring(0.55),
  /** SwiftUI's Spring.snappy: duration 0.5, bounce 0.15. */
  snappy: appleSpring(0.5, 0.15),
  sheet: {
    /** ModalPresentationIOS on iOS 26: the screen behind a sheet dims to 20% black, as the sheet comes. */
    dim: 0.2,
    /** @gorhom/bottom-sheet's snapPoint: let go, a sheet heads for where it would be 0.2s on at the speed it left with. */
    project: 0.2,
    /** …and the spring it settles on starts at half that speed (animateToPosition(…, velocityY / 2)). */
    carry: 0.5,
    /** Over-dragging past the top resists: √(1 + over) × 2.5 (DEFAULT_OVER_DRAG_RESISTANCE_FACTOR). */
    overDrag: 2.5,
  },
  /** Ionic's iOS alert (UIAlertController's look): in from 110% as it fades, out to 90% as it fades, 200ms ease-in-out over a 30% backdrop. */
  alert: { timing: { duration: 0.2, ease: CSS_EASE_IN_OUT } as Tween, from: 1.1, to: 0.9, dim: 0.3 },
  /** iOS has no system toast: Ionic's iOS toast slides it up from the edge with a slight overshoot (400ms) and back down (300ms). */
  toast: { in: { duration: 0.4, ease: [0.155, 1.105, 0.295, 1.12] } as Tween, out: { duration: 0.3, ease: [0.36, 0.66, 0.04, 1] } as Tween },
  /**
   * UIKit publishes no numbers for its pull-down menus, which grow out of what opened them with a
   * little bounce: SwiftUI's snappy spring from half size stands in, fading in over 100ms; they
   * leave faster, fading as they shrink to 90% (Spring.smooth at 0.3s).
   */
  menu: { from: 0.5, in: appleSpring(0.5, 0.15), fade: { duration: 0.1, ease: "linear" } as Tween, to: 0.9, out: appleSpring(0.3) },
  /**
   * Press feedback: React Navigation's PlatformPressable on iOS: down, at once to 30%; let go, back
   * over 200ms (Easing.inOut(Easing.quad)). Rows and cards highlight as TouchableHighlight does:
   * 15% black over them (an activeOpacity of 0.85 on a black underlay).
   */
  press: { opacity: 0.3, release: { duration: 0.2, ease: [0.45, 0, 0.55, 1] } as Tween, row: 0.15 },
};

// ---------------------------------------------------------------------------
// Android: AOSP and Material 3

export const ANDROID = {
  /**
   * Android 14's activity transition (React Navigation's FadeFromRightAndroid, from AOSP's
   * activity_open/close_enter/exit): 450ms on the emphasized curve; the new screen comes 96dp from
   * the side, fading in from 50ms to 133ms; the one under it moves 96dp the other way. Back: the top
   * screen fades out from 35ms to 118ms as it goes.
   */
  page: { duration: 0.45, ease: "emphasized" } as Tween,
  shift: 96,
  fadeIn: { duration: 0.083, delay: 0.05, ease: "linear" } as Tween,
  fadeOut: { duration: 0.083, delay: 0.035, ease: "linear" } as Tween,
  /** Compose Navigation's default (DefaultNavTransitions on Android): fadeIn and fadeOut over tween(700), FastOutSlowIn. */
  dissolve: { duration: 0.7, ease: [0.4, 0, 0.2, 1] } as Tween,
  /**
   * A Material 3 bottom sheet (MDC's m3_bottom_sheet_slide_in/out; React Navigation's
   * BottomSheetAndroid): it rises 20% of the screen as it fades in (400ms, emphasized) and leaves the
   * same way (350ms, fading over 300ms). The window dim behind is 32%, there in 128ms and gone in 112ms
   * (DimmerAnimationHelper). Dragged and let go, it settles where it was heading (gorhom's snapPoint)
   * over 250ms, easing out exponentially (gorhom's Android config).
   */
  sheet: {
    rise: 0.2,
    in: { duration: 0.4, ease: "emphasized" } as Tween,
    out: { duration: 0.35, ease: "emphasized" } as Tween,
    fadeOut: { duration: 0.3, ease: "emphasized" } as Tween,
    dim: 0.32,
    dimIn: { duration: 0.128, ease: "linear" } as Tween,
    dimOut: { duration: 0.112, ease: "linear" } as Tween,
    settle: { duration: 0.25, ease: "outExpo" } as Tween,
    project: 0.2,
  },
  /** AOSP's dialog window animation (React Navigation's DialogAndroid): 220ms, scaling from 90% (decelerate 5), fading in over 150ms (decelerate 3), the dim at 60% in 132ms. */
  dialog: { from: 0.9, scale: { duration: 0.22, ease: "decelerate5" } as Tween, fade: { duration: 0.15, ease: "decelerate3" } as Tween, dim: 0.6, dimTiming: { duration: 0.132, ease: "linear" } as Tween },
  /** A snackbar (MDC's BaseTransientBottomBar with M3's motionDurationLong2 and emphasized easing): slides up from below in 500ms, and back down. */
  toast: { duration: 0.5, ease: "emphasized" } as Tween,
  /** A Material 3 menu (material-web's md-menu): unfolds from its edge in 500ms (emphasized), its surface fading in over the first 50ms; closes in 150ms to 35% (emphasized accelerate), fading in the last 50ms. */
  menu: {
    in: { duration: 0.5, ease: "emphasized" } as Tween,
    fadeIn: { duration: 0.05, ease: "linear" } as Tween,
    out: { duration: 0.15, ease: [0.3, 0, 0.8, 0.15] } as Tween,
    fadeOut: { duration: 0.05, delay: 0.1, ease: "linear" } as Tween,
    closedTo: 0.35,
  },
  /** The M3 standard motion scheme's springs (MDC tokens): default spatial (0.9, 700) for what moves, default effects (1, 1600) for what fades or changes colour. */
  spatial: materialSpring(0.9, 700),
  effects: materialSpring(1, 1600),
  /** The ripple (material-web): grows from 20% at the touch over 450ms (standard easing) at 12%, fading in over 105ms; let go, it fades over 375ms once it has shown for 225ms. */
  press: { opacity: 0.12, grow: { duration: 0.45, ease: [0.2, 0, 0, 1] } as Tween, from: 0.2, fadeIn: 0.105, fadeOut: 0.375, minimum: 0.225 },
};

// ---------------------------------------------------------------------------
// The web

const CSS_EASE: Ease = [0.25, 0.1, 0.25, 1];

export const WEB = {
  /** The View Transitions API's default: the old page fades out as the new one fades in, 250ms ease, blended with plus-lighter so nothing dips. */
  page: { duration: 0.25, ease: CSS_EASE } as Tween,
  /** Vaul (shadcn/ui's Drawer): 500ms on cubic-bezier(0.32, 0.72, 0, 1); dragged, it closes past 25% of its height or faster than 0.4px/ms; shadcn's overlay is 50% black. */
  sheet: { timing: { duration: 0.5, ease: [0.32, 0.72, 0, 1] } as Tween, closeAt: 0.25, flick: 400, dim: 0.5 },
  /** shadcn/ui's Dialog (Radix): fades in from 95%, 200ms ease, over 50% black. */
  dialog: { from: 0.95, timing: { duration: 0.2, ease: CSS_EASE } as Tween, dim: 0.5 },
  /** Sonner: up from below as it fades in, 400ms ease, and back. */
  toast: { duration: 0.4, ease: CSS_EASE } as Tween,
  /** shadcn/ui's DropdownMenu (Radix, tw-animate-css): fades in from 95%, 8px from where it opens from, 150ms ease. */
  menu: { from: 0.95, slide: 8, timing: { duration: 0.15, ease: CSS_EASE } as Tween },
  /** Tailwind's default transition: 150ms cubic-bezier(0.4, 0, 0.2, 1). Changes in place, hover and press. */
  change: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } as Tween,
  /** Material's web state layers: 8% on hover, 12% pressed. */
  press: { hover: 0.08, pressed: 0.12 },
};

// ---------------------------------------------------------------------------
// One table per feel: what the compiled module's MOTION holds

export interface FeelMotion {
  /** Pages: pushing and popping, a full-screen sheet. */
  page: Timing;
  /** Layers two screens share, morphing (smart). */
  morph: Timing;
  /** What changes in place: a look, a colour, a count. */
  change: Timing;
  /** A bar showing (a basket bar). */
  bar: Timing;
}

export const FEEL_MOTION: Record<Feel, FeelMotion> = {
  ios: { page: IOS.navigation, morph: IOS.standard, change: IOS.standard, bar: IOS.standard },
  android: { page: ANDROID.page, morph: ANDROID.spatial, change: ANDROID.effects, bar: ANDROID.spatial },
  web: { page: WEB.page, morph: WEB.page, change: WEB.change, bar: WEB.page },
};

/** How long a feel's page change takes to look done: the old screen stays under the new one until then. */
export const pageSettle = (feel: Feel): number => {
  if (feel === "ios") return settleTime(IOS.navigation);
  if (feel === "android") return Math.max(ANDROID.page.duration, ANDROID.sheet.in.duration);
  return Math.max(WEB.page.duration, WEB.sheet.timing.duration);
};
