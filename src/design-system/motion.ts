import type { MotionRef, ProtoTransitionKind } from "@/doc/schema";
import { flattenTokens, px, type Tree } from "./resolve";

/**
 * Motion tokens: the small fixed table prototypes animate with. Written as a DTCG tree (duration
 * and cubicBezier are DTCG types; spring is Qalam's, in Motion's visualDuration/bounce terms) so it
 * can move into a design system's tree as motion.* and be read through its TokenSet later.
 *
 * A prototype names a motion by reference: "<duration>.<easing>" or "spring.<name>" — or "native",
 * which moves it as the platform does (native-motion.ts) and is the default.
 */
export const MOTION_TREE: Tree = {
  motion: {
    duration: {
      $type: "duration",
      fast: { $value: "150ms", $description: "Small state changes: a toggle, a pressed step." },
      medium: { $value: "250ms", $description: "Most transitions: sections entering, a sheet." },
      slow: { $value: "400ms", $description: "Large moves: a whole screen, a long path." },
    },
    easing: {
      $type: "cubicBezier",
      standard: { $value: [0.2, 0, 0, 1], $description: "Settles into place; for things that move." },
      emphasized: { $value: [0.05, 0.7, 0.1, 1], $description: "Fast start, long settle; for things that enter." },
    },
    spring: {
      $type: "spring",
      gentle: { $value: { visualDuration: 0.5, bounce: 0.15 }, $description: "Shared elements and screens." },
      snappy: { $value: { visualDuration: 0.3, bounce: 0.2 }, $description: "Small, direct feedback." },
    },
  },
};

/** Every motion reference but "native": the tokens this table holds. */
export type MotionToken = Exclude<MotionRef, "native">;

export const MOTION_TOKENS = [
  "fast.standard",
  "fast.emphasized",
  "medium.standard",
  "medium.emphasized",
  "slow.standard",
  "slow.emphasized",
  "spring.gentle",
  "spring.snappy",
] as const satisfies readonly MotionToken[];

export const MOTION_REFS = ["native", ...MOTION_TOKENS] as const satisfies readonly MotionRef[];

export const isMotionRef = (v: unknown): v is MotionRef => (MOTION_REFS as readonly unknown[]).includes(v);
export const isMotionToken = (v: unknown): v is MotionToken => (MOTION_TOKENS as readonly unknown[]).includes(v);

/**
 * Links written before native motion took the tokens Qalam wrote by default (a push on
 * medium.standard, a smart link on spring.gentle): those move natively now. Other tokens were picked
 * on purpose and stay.
 */
export const nativeDefault = (kind: ProtoTransitionKind, motion: MotionRef): MotionRef =>
  (kind === "smart" ? motion === "spring.gentle" : motion === "medium.standard") ? "native" : motion;

/** A Motion (motion.dev) transition, as plain data: a tween with a cubic-bezier, or a spring. */
export type MotionTransition = { duration: number; ease: [number, number, number, number] } | { type: "spring"; visualDuration: number; bounce: number };

const TOKENS = new Map(flattenTokens(MOTION_TREE).map((t) => [t.path, t.value]));

/** The transition a motion token stands for. */
export function motionTransition(ref: MotionToken): MotionTransition {
  const [a, b] = ref.split(".");
  if (a === "spring") {
    const s = TOKENS.get(`motion.spring.${b}`) as { visualDuration: number; bounce: number };
    return { type: "spring", visualDuration: s.visualDuration, bounce: s.bounce };
  }
  return { duration: px(TOKENS.get(`motion.duration.${a}`)) / 1000, ease: TOKENS.get(`motion.easing.${b}`) as [number, number, number, number] };
}

/** About how long a motion takes, in seconds (a spring's visual duration; native, about a page's). */
export const motionSeconds = (ref: MotionRef): number => {
  if (ref === "native") return 0.4;
  const t = motionTransition(ref);
  return "type" in t ? t.visualDuration : t.duration;
};
