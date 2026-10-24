"use client";

import type { RefObject } from "react";

import { useLocale } from "@/components/locale";
import { gsap, MOTION_OK, REDUCED, ScrollTrigger, useGSAP } from "@/lib/gsap";

export type SceneTools = {
  /** Scoped selector inside the scene. */
  q: (selector: string) => HTMLElement[];
  rtl: boolean;
  /** +1 in LTR, -1 in RTL: multiply any horizontal travel by it. */
  sx: 1 | -1;
};

/**
 * One scroll-scrubbed timeline per scene. The scene's section is tall and its stage is
 * `position: sticky`, so the stage holds while the captions scroll past it (no ScrollTrigger pin,
 * nothing re-parented). Build the timeline in normalised time: 0 is the stage arriving at the top,
 * 1 is the last caption leaving; `tl.set({}, {}, 1)` is added so the length is always exactly 1.
 *
 * Reduced motion gets the same timeline jumped to its end, so every scene is readable in its final
 * state. The scene rebuilds when the language flips, because horizontal moves change sign and split
 * text has to be split again.
 */
export function useScene(
  scope: RefObject<HTMLElement | null>,
  build: (tl: gsap.core.Timeline, tools: SceneTools) => void,
) {
  const { locale, rtl } = useLocale();
  useGSAP(
    () => {
      const el = scope.current;
      if (!el) return;
      const select = gsap.utils.selector(el);
      const tools: SceneTools = { q: (s) => select(s) as HTMLElement[], rtl, sx: rtl ? -1 : 1 };
      const mm = gsap.matchMedia(el);
      mm.add({ motion: MOTION_OK, reduce: REDUCED }, (ctx) => {
        const tl = gsap.timeline({ defaults: { ease: "none", duration: 0.1 }, paused: true });
        build(tl, tools);
        tl.set({}, {}, 1);
        if (ctx.conditions?.reduce) {
          tl.progress(1);
          return;
        }
        const st = ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.8,
          animation: tl,
        });
        // After a rebuild (language flip) jump straight to where the reader is; don't replay.
        tl.progress(st.progress);
      });
      return () => mm.revert();
    },
    { scope, dependencies: [locale], revertOnUpdate: true },
  );
}
