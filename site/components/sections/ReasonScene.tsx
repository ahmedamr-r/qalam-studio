"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { AIGlyph } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { Phone } from "@/components/mocks/Phone";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { quoted } from "@/lib/i18n";

import { IconCheck } from "../mocks/icons";

/* Step 8, where the thread closes. The critic's comment pins to the fees row and its checks tick;
   then "Why this design?" traces the screen back up, node by node, to the interview quote the
   page started from, and that quote's nuqta fills. */
const PHONE = { x: 40, y: 30, s: 0.8 };
const ROW = { y: 470, h: 66 };

export function ReasonScene() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.reason;
  const trace = [...c.trace].reverse(); // drawn top → bottom: quote … screen
  const dir = locale === "ar" ? "rtl" : "ltr";

  useScene(ref, (tl) => {
    tl.fromTo(".rs-row", { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.02)
      .fromTo(".rs-link path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.06 }, 0.06)
      .fromTo(".rs-comment", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.1)
      .fromTo(".rs-check", { "--ok": 0, opacity: 0.4 }, { "--ok": 1, opacity: 1, stagger: 0.05, duration: 0.04 }, 0.18)
      .fromTo(".rs-trace", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.05 }, 0.4);
    // Up the chain: screen first, then each reason above it.
    for (let i = trace.length - 1; i >= 0; i--) {
      const at = 0.46 + (trace.length - 1 - i) * 0.1;
      tl.fromTo(`.rs-node-${i}`, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.04 }, at);
      if (i > 0) tl.fromTo(`.rs-edge-${i - 1}`, { scaleY: 0 }, { scaleY: 1, duration: 0.06 }, at + 0.04);
    }
    tl.fromTo(".rs-node-0 .rs-dot", { "--fill": 0 }, { "--fill": 1, duration: 0.04 }, 0.88);
  });

  return (
    <Scene
      id="reason"
      sceneRef={ref}
      beats={3.5}
      step={8}
      wide
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={980} h={660} className="canvas-board studio-board">
        <div dir="ltr" lang="en" className="abs-fill">
          <div className="frame-label" style={{ left: PHONE.x, top: PHONE.y - 22 }}>
            Send money
          </div>
          <div className="frame" style={{ left: PHONE.x, top: PHONE.y, width: 360 * PHONE.s, height: 760 * PHONE.s }}>
            <Phone lang={locale} style={{ scale: PHONE.s, transformOrigin: "0 0" }} />
          </div>
          <span
            className="rs-row"
            style={{ left: PHONE.x + 10 * PHONE.s, top: PHONE.y + ROW.y * PHONE.s, width: 340 * PHONE.s, height: ROW.h * PHONE.s }}
          />
          <svg className="rs-link" viewBox="0 0 980 660" aria-hidden>
            <path
              d={`M${PHONE.x + 350 * PHONE.s} ${PHONE.y + (ROW.y + ROW.h / 2) * PHONE.s} C 360 ${PHONE.y + (ROW.y + ROW.h / 2) * PHONE.s}, 350 420, 380 420`}
              pathLength={1}
            />
          </svg>

          <div className="comment-card rs-comment" style={{ left: 380, top: 372, width: 268 }} lang={locale} dir={dir}>
            <div className="comment-head">
              <i style={{ background: "var(--agent-4)" }}>C</i>
              <b>Critic</b>
              <span>now</span>
            </div>
            <p>{c.critic}</p>
            <p className="rs-quote">{quoted(t.quote.quote, locale)}</p>
            <ul>
              {c.checks.map((check) => (
                <li key={check} className="rs-check">
                  <span className="rs-check-icon">
                    <IconCheck size={12} />
                  </span>
                  {check}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel rs-trace" style={{ left: 680, top: 30, width: 280 }} lang={locale} dir={dir}>
            <div className="rs-trace-head">
              <AIGlyph size={14} />
              <b>{c.traceTitle}</b>
            </div>
            <ol className="rs-nodes">
              {trace.map(([kind, text], i) => (
                <li key={kind} className={`rs-node rs-node-${i}`}>
                  <span className="rs-dot" />
                  {i < trace.length - 1 && <span className={`rs-edge rs-edge-${i}`} />}
                  <span className="rs-kind">{kind}</span>
                  <span className="rs-text">{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
