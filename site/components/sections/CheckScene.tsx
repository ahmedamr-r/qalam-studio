"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { AIGlyph } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { Phone } from "@/components/mocks/Phone";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";

import { IconCheck, IconRing } from "../mocks/icons";

/* Step 5. A scan line passes over the draft; the linter pins three findings on it (the screen was
   drawn with them on purpose: faint text, a small target, an off-system radius). The repair pass
   fixes each one and the count runs 3 → 0. The panel is studio chrome, so it is English. */

const PHONE = { x: 30, y: 30, s: 0.86 };
// In scan order (top to bottom), so the list fills in the order the scan line finds them.
const ISSUES = [
  { key: "close", text: "Tap target 28 pt, needs 44", rule: "WCAG 2.5.8", x: 78, y: 72 },
  { key: "lock", text: "Contrast 2.1:1, needs 4.5:1", rule: "WCAG 1.4.3", x: 304, y: 652 },
  { key: "cta", text: "Radius 4 is off-system, use md (12)", rule: "Tokens", x: 336, y: 676 },
];

export function CheckScene() {
  const { t, locale, rtl } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.check;
  const at = (x: number, y: number) => ({
    left: PHONE.x + (rtl ? 360 - x : x) * PHONE.s - 11,
    top: PHONE.y + y * PHONE.s - 11,
  });

  useScene(ref, (tl) => {
    tl.fromTo(".ck-scan", { y: 0, opacity: 1 }, { y: 760 * PHONE.s, duration: 0.26, ease: "none" }, 0.04).to(".ck-scan", { opacity: 0, duration: 0.02 }, 0.3);
    // Findings appear as the scan line passes them (sorted by y in the list above them).
    ISSUES.forEach((issue, i) => {
      const when = 0.04 + (issue.y / 760) * 0.26;
      tl.fromTo(`.ck-pin-${i}`, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: 0.03 }, when).fromTo(
        `.ck-row-${i}`,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.03 },
        when,
      );
    });
    tl.fromTo(".ck-count-3", { opacity: 0 }, { opacity: 1, duration: 0.02 }, 0.08)
      .fromTo(".ck-repair", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.04 }, 0.4);

    const fixes: Record<string, gsap.TweenVars> = {
      lock: { "--lint-lock": "#5a5e66" },
      close: { "--lint-close": "44px" },
      cta: { "--lint-cta-r": "12px" },
    };
    ISSUES.forEach((issue, i) => {
      const when = 0.48 + i * 0.1;
      tl.to(".ck-phone .phone", { ...fixes[issue.key], duration: 0.05 }, when)
        .to(`.ck-pin-${i}`, { "--ok": 1, duration: 0.03 }, when + 0.04)
        .to(`.ck-row-${i}`, { "--ok": 1, duration: 0.03 }, when + 0.04)
        .to(`.ck-count-${3 - i}`, { opacity: 0, duration: 0.015 }, when + 0.04)
        .fromTo(`.ck-count-${2 - i}`, { opacity: 0 }, { opacity: 1, duration: 0.015 }, when + 0.05);
    });
    tl.to(".ck-repair", { "--ok": 1, duration: 0.03 }, 0.8).fromTo(".ck-kept", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.04 }, 0.82);
  });

  return (
    <Scene
      id="check"
      sceneRef={ref}
      beats={3.5}
      step={5}
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={800} h={700} className="canvas-board studio-board">
        <div dir="ltr" lang="en" className="abs-fill">
          <div className="frame-label" style={{ left: PHONE.x, top: PHONE.y - 22 }}>
            Send money
          </div>
          <div className="ck-phone frame" style={{ left: PHONE.x, top: PHONE.y, width: 360 * PHONE.s, height: 760 * PHONE.s }}>
            <Phone lang={locale} className="is-lint" style={{ scale: PHONE.s, transformOrigin: "0 0" }} />
            <span className="ck-scan" aria-hidden />
          </div>
          {ISSUES.map((issue, i) => (
            <span key={issue.key} className={`ck-pin ck-pin-${i}`} style={at(issue.x, issue.y)} aria-hidden>
              {i + 1}
            </span>
          ))}

          <div className="panel ck-panel" style={{ left: 380, top: 150, width: 400 }}>
            <div className="ck-head">
              <b>Checks</b>
              <span className="ck-count">
                {[0, 1, 2, 3].map((n) => (
                  <span key={n} className={`ck-count-${n} ${n === 0 ? "is-zero" : ""}`}>
                    {n} {n === 1 ? "issue" : "issues"}
                  </span>
                ))}
              </span>
            </div>
            {ISSUES.map((issue, i) => (
              <div key={issue.key} className={`ck-row ck-row-${i}`}>
                <span className="ck-row-icon">
                  <span className="ck-ring">
                    <IconRing />
                  </span>
                  <span className="ck-ok">
                    <IconCheck />
                  </span>
                </span>
                <span className="ck-num">{i + 1}</span>
                <span className="ck-text">
                  {issue.text}
                  <small>{issue.rule}</small>
                </span>
                <span className="ck-fixed">Fixed</span>
              </div>
            ))}
            <div className="ck-repair">
              <span className="ck-repair-working">
                <AIGlyph size={14} working />
              </span>
              <span className="ck-repair-done">
                <AIGlyph size={14} />
              </span>
              Repair pass
            </div>
            <div className="ck-kept">
              <IconCheck />
              Repaired version kept: 0 issues, was 3
            </div>
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
