"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { useLocale } from "@/components/locale";
import { Cursor } from "@/components/mocks/StudioWindow";
import { Phone } from "@/components/mocks/Phone";
import { TokenSheet, TOVI_SWATCHES } from "@/components/mocks/TokenSheet";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";

import { IconPin } from "../mocks/icons";

/* Step 4. The studio canvas with four agents, each doing its own job: the Researcher pins
   references, the System builder lays out Tovi's tokens, the Designer draws the screen region by
   region as tokens travel into it, and the Critic leaves a comment. The canvas is studio chrome,
   so it stays left-to-right; the screen on it follows the page's language. */

const PHONE = { x: 600, y: 44, s: 0.8 };
const SHEET = { x: 30, y: 318, s: 0.82 };
const swatchAt = (i: number) => ({ x: SHEET.x + (18 + 30 + i * 72) * SHEET.s, y: SHEET.y + (18 + 30) * SHEET.s });
const regionAt = (cy: number) => ({ x: PHONE.x + 180 * PHONE.s, y: PHONE.y + cy * PHONE.s });

// Which swatch feeds which region, and the region's centre in phone coordinates.
const FEEDS: { region: string; swatch: number; cy: number }[] = [
  { region: "header", swatch: 0, cy: 72 },
  { region: "amount", swatch: 1, cy: 206 },
  { region: "details", swatch: 3, cy: 418 },
  { region: "footer", swatch: 2, cy: 684 },
];

export function BuildScene() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.build;

  useScene(ref, (tl) => {
    const move = (name: string, from: [number, number], to: [number, number], at: number, d = 0.08) =>
      tl.fromTo(`[data-cursor="${name}"]`, { x: from[0], y: from[1], opacity: 1 }, { x: to[0], y: to[1], duration: d, ease: "power2.inOut" }, at);

    move("Researcher", [-80, 140], [300, 210], 0);
    tl.fromTo(".bd-ref", { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, stagger: 0.03, duration: 0.05 }, 0.04)
      .fromTo(".bd-ref-pin", { opacity: 0, y: -12 }, { opacity: 1, y: 0, stagger: 0.03, duration: 0.03 }, 0.09);

    move("System builder", [-80, 640], [280, 470], 0.1);
    tl.fromTo(".bd-sheet .ts-swatch", { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, stagger: 0.02, duration: 0.04 }, 0.14)
      .fromTo(".bd-sheet [data-ts]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, stagger: 0.02, duration: 0.04 }, 0.22);

    move("Designer", [1060, 260], [830, 70], 0.2);
    tl.fromTo(".bd-frame", { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.25);

    FEEDS.forEach(({ region, swatch, cy }, k) => {
      const at = 0.34 + k * 0.1;
      const from = swatchAt(swatch);
      const to = regionAt(cy);
      tl.to('[data-cursor="Designer"]', { x: to.x + 70, y: to.y + 6, duration: 0.06, ease: "power2.inOut" }, at - 0.02);
      tl.fromTo(`.bd-dot-${k}`, { opacity: 0, x: 0, y: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: 0.015 }, at)
        .to(`.bd-dot-${k}`, { x: to.x - from.x, y: to.y - from.y, duration: 0.05, ease: "power2.inOut" }, at + 0.012)
        .to(`.bd-dot-${k}`, { opacity: 0, scale: 3, duration: 0.02 }, at + 0.06)
        .to(`.bd-frame [data-region="${region}"] [data-skel]`, { opacity: 0, duration: 0.025 }, at + 0.06)
        .fromTo(
          `.bd-frame [data-region="${region}"] > :not([data-skel])`,
          { opacity: 0 },
          { opacity: 1, duration: 0.03 },
          at + 0.065,
        );
    });

    move("Critic", [1060, 720], [560, 560], 0.76);
    tl.fromTo(".bd-comment", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.83);
  });

  return (
    <Scene
      id="build"
      sceneRef={ref}
      beats={3.5}
      step={4}
      wide
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={1000} h={680} className="canvas-board studio-board">
        <div dir="ltr" lang="en" className="abs-fill">
          <div className="frame-label" style={{ left: 30, top: 28 }}>
            References
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="bd-ref" style={{ left: 30 + i * 118, top: 52 }}>
              <span className="bd-ref-pin">
                <IconPin size={12} />
              </span>
              <i style={{ height: 22, width: "56%" }} />
              <i style={{ height: 50 }} />
              <i style={{ height: 10, width: "40%" }} />
              <i style={{ height: 50 }} />
              <i style={{ height: 34, marginTop: "auto" }} />
            </div>
          ))}

          <div className="frame-label" style={{ left: SHEET.x, top: SHEET.y - 24 }}>
            Design tokens
          </div>
          <div className="bd-sheet" style={{ position: "absolute", left: SHEET.x, top: SHEET.y }}>
            <TokenSheet scale={SHEET.s} />
          </div>

          <div className="frame-label" style={{ left: PHONE.x, top: PHONE.y - 24 }}>
            Send money
          </div>
          <div className="bd-frame frame" style={{ left: PHONE.x, top: PHONE.y, width: 360 * PHONE.s, height: 760 * PHONE.s }}>
            <Phone lang={locale} skeleton style={{ scale: PHONE.s, transformOrigin: "0 0" }} />
          </div>

          {FEEDS.map(({ swatch }, k) => {
            const p = swatchAt(swatch);
            return <span key={k} className={`bd-dot bd-dot-${k}`} style={{ left: p.x - 7, top: p.y - 7, background: TOVI_SWATCHES[swatch] }} />;
          })}

          <div className="comment-card bd-comment" style={{ left: 360, top: 548 }} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
            <div className="comment-head">
              <i style={{ background: "var(--agent-4)" }}>C</i>
              <b>Critic</b>
              <span>now</span>
            </div>
            <p>{c.critic}</p>
          </div>

          <Cursor name="Researcher" n={1} x={0} y={0} />
          <Cursor name="System builder" n={2} x={0} y={0} />
          <Cursor name="Designer" n={3} x={0} y={0} />
          <Cursor name="Critic" n={4} x={0} y={0} />
        </div>
      </Artboard>
    </Scene>
  );
}
