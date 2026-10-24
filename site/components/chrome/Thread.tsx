"use client";

import { useRef, type ReactNode } from "react";

import { useLocale } from "@/components/locale";
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/lib/gsap";

/**
 * The thread: one line down the story, from the quote to the checked screen. Its nuqta head is
 * sticky at the viewport's centre, so the line looks drawn by a pen that stays put while the page
 * moves under it. Each scene's step marker fills as the head passes it.
 */
export function Story({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia(el);
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          ".thread-fill",
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top center", end: "bottom center", scrub: true },
          },
        );
      });
      // Captions are sticky, so measure from each scene instead of its marker: the marker is reached
      // as the scene's stage settles.
      gsap.utils.toArray<HTMLElement>(".scene", el).forEach((scene) => {
        const marker = scene.querySelector(".step");
        if (marker) ScrollTrigger.create({ trigger: scene, start: "top 35%", toggleClass: { targets: marker, className: "is-reached" } });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );
  return (
    <div className="story" id="story" ref={ref}>
      <div className="thread" aria-hidden>
        <div className="thread-line">
          <div className="thread-fill" />
        </div>
        <div className="thread-head">
          <span className="nuqta" />
        </div>
      </div>
      {children}
    </div>
  );
}
