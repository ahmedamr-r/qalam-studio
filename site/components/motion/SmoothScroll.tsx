"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

import { gsap, MOTION_OK, ScrollTrigger } from "@/lib/gsap";

let current: Lenis | null = null;
/** The live Lenis instance, or null when smoothing is off (reduced motion, touch-only devices). */
export const getLenis = () => current;

/**
 * Wheel smoothing that moves the real scroll position, so `position: sticky` stages and ScrollTrigger
 * keep working. Touch keeps the platform's own momentum (Lenis leaves touch alone by default), and a
 * reader who asks for reduced motion gets the browser's scrolling back, live, through matchMedia.
 */
export function SmoothScroll() {
  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const lenis = new Lenis({ lerp: 0.11, anchors: { offset: -24 } });
      current = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      return () => {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33);
        lenis.destroy();
        current = null;
      };
    });
    return () => mm.revert();
  }, []);
  return null;
}
