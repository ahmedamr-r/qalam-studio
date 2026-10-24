"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase, Flip, useGSAP);
  // ahmedamr.com's entrance curve: big objects that travel far start fast and settle.
  CustomEase.create("qalam", "M0,0 C0.16,1 0.3,1 1,1");
}

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export { CustomEase, Flip, gsap, ScrollTrigger, SplitText, useGSAP };
