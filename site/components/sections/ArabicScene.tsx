"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { useLocale } from "@/components/locale";
import { Phone } from "@/components/mocks/Phone";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { Flip, gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { otherLocale } from "@/lib/i18n";

import { IconCheck } from "../mocks/icons";

/* Step 7. The screen switches direction in place. GSAP Flip records where every part sits, the
   phone's `dir` and language swap, and each part travels to its mirrored place while the copy
   re-sets in the other language. It plays forward as you pass a third of the scene and back if
   you scroll up. Then the checks tick. A button flips this whole page the same way. */
const PHONE = { x: 30, y: 30, s: 0.86 };

export function ArabicScene() {
  const { t, locale, switchTo } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.arabic;
  const other = otherLocale(locale);

  useGSAP(
    () => {
      const el = ref.current;
      const phone = el?.querySelector<HTMLElement>(".ar-phone .phone");
      if (!el || !phone) return;
      const setDir = (lang: string, animate: boolean) => {
        if (phone.dataset.lang === lang) return;
        const targets = phone.querySelectorAll("[data-flip], .ph-icon, .dir-icon");
        const state = animate ? Flip.getState(targets) : null;
        phone.dataset.lang = lang;
        phone.dir = lang === "ar" ? "rtl" : "ltr";
        el.querySelector(".ar-dir")?.setAttribute("data-dir", phone.dir);
        if (state) {
          Flip.from(state, { duration: 0.9, ease: "qalam", nested: true, prune: true });
          gsap.fromTo(
            phone.querySelectorAll(`[data-l="${lang}"]`),
            { opacity: 0, filter: "blur(6px)" },
            { opacity: 1, filter: "blur(0px)", duration: 0.6, delay: 0.15, stagger: 0.01, ease: "qalam" },
          );
        }
      };
      setDir(locale, false);
      const mm = gsap.matchMedia(el);
      mm.add({ motion: MOTION_OK }, (ctx) => {
        const animate = Boolean(ctx.conditions?.motion);
        ScrollTrigger.create({
          trigger: el,
          start: () => `top+=${window.innerHeight * 0.55} top`,
          onEnter: () => setDir(other, animate),
          onLeaveBack: () => setDir(locale, animate),
          invalidateOnRefresh: true,
        });
      });
      // Reduced motion: no scroll trigger above, so show the flipped screen as the scene's final state.
      if (!window.matchMedia(MOTION_OK).matches) setDir(other, false);
      return () => {
        mm.revert();
        setDir(locale, false);
      };
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  useScene(ref, (tl) => {
    tl.fromTo(".ar-check", { "--ok": 0, opacity: 0.45 }, { "--ok": 1, opacity: 1, stagger: 0.1, duration: 0.05 }, 0.42);
  });

  return (
    <Scene
      id="arabic"
      sceneRef={ref}
      beats={3}
      step={7}
      captions={[
        {
          title: c.title,
          body: c.body,
          extra: (
            <button type="button" className="btn btn-ghost caption-btn" lang={other} onClick={() => switchTo(other)}>
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
                <path d="M6 6h9l-3-3M14 14H5l3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {c.flipPage}
            </button>
          ),
        },
      ]}
    >
      <Artboard w={800} h={700} className="canvas-board studio-board">
        <div dir="ltr" lang="en" className="abs-fill">
          <div className="frame-label" style={{ left: PHONE.x, top: PHONE.y - 22 }}>
            Send money
          </div>
          <div className="ar-phone frame" style={{ left: PHONE.x, top: PHONE.y, width: 360 * PHONE.s, height: 760 * PHONE.s }}>
            <Phone lang={locale} bilingual style={{ scale: PHONE.s, transformOrigin: "0 0" }} />
          </div>
          <div className="panel ar-panel" style={{ left: 380, top: 170, width: 400 }}>
            <div className="ar-dir" data-dir={locale === "ar" ? "rtl" : "ltr"}>
              <span className="ar-dir-label">Direction</span>
              <span className="seg seg-static">
                <span data-v="ltr">LTR</span>
                <span data-v="rtl">RTL</span>
                <i className="seg-thumb" />
              </span>
            </div>
            <ul className="ar-checks" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
              {c.checks.map((check) => (
                <li key={check} className="ar-check">
                  <span className="ar-check-icon">
                    <IconCheck />
                  </span>
                  {check}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
