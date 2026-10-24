"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { useLocale } from "@/components/locale";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { SplitText } from "@/lib/gsap";
import { quoted } from "@/lib/i18n";

import { IconCheck, IconX } from "../mocks/icons";

/* Step 1. A quote's words light up as you scroll; the transcript lights the same sentence, so the
   quote is kept. A paraphrase gets searched for, isn't found, and is struck out. */
export function QuoteScene() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.quote;

  useScene(ref, (tl, { q }) => {
    const split = SplitText.create(q(".qs-quote-text"), { type: "words", aria: "auto" });
    tl.fromTo(split.words, { opacity: 0.16 }, { opacity: 1, stagger: 0.022, duration: 0.06 }, 0)
      .fromTo(".qs-hl", { scaleX: 0 }, { scaleX: 1, duration: 0.12 }, 0.24)
      .fromTo(".qs-link path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.08 }, 0.33)
      .fromTo(".qs-kept", { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.4)
      .fromTo(".qs-para", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.08 }, 0.52)
      .fromTo(".qs-search", { opacity: 0 }, { opacity: 1, duration: 0.02 }, 0.62)
      .fromTo(".qs-search", { y: 0 }, { y: () => (c.lines.length - 1) * 44, duration: 0.16, ease: "power1.inOut" }, 0.62)
      .to(".qs-search", { opacity: 0, duration: 0.02 }, 0.78)
      .fromTo(".qs-strike", { scaleX: 0 }, { scaleX: 1, duration: 0.07 }, 0.8)
      .to(".qs-para-text", { opacity: 0.4, duration: 0.05 }, 0.82)
      .fromTo(".qs-dropped", { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.86);
  });

  return (
    <Scene
      id="quote"
      sceneRef={ref}
      beats={3}
      step={1}
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={880} h={600} className="canvas-board">
        <div className="card qs-transcript" style={{ insetInlineStart: 0, top: 30, width: 450 }}>
          <div className="qs-source">
            <b>{c.source}</b>
            <span>{c.sourceMeta}</span>
          </div>
          <ol className="qs-lines">
            {c.lines.map(([who, line], i) => (
              <li key={i} className={i === c.matchLine ? "is-match" : undefined}>
                <span className="qs-who">{who}</span>
                <span className="qs-line">
                  {i === c.matchLine && <span className="qs-hl" aria-hidden />}
                  {line}
                </span>
              </li>
            ))}
            <span className="qs-search" aria-hidden />
          </ol>
        </div>

        <svg className="qs-link" viewBox="0 0 880 600" aria-hidden>
          <path d="M452 318 C 484 318, 468 160, 500 160" pathLength={1} />
        </svg>

        <div className="card qs-quote" style={{ insetInlineStart: 500, top: 60, width: 370 }}>
          <span className="tag">{c.quoteLabel}</span>
          <p className="qs-quote-text">{quoted(c.quote, locale)}</p>
          <div className="status status-ok qs-kept">
            <IconCheck />
            {c.kept}
          </div>
        </div>

        <div className="card qs-para" style={{ insetInlineStart: 500, top: 330, width: 370 }}>
          <span className="tag">{c.quoteLabel}</span>
          <p className="qs-para-text">
            {quoted(c.paraphrase, locale)}
            <span className="qs-strike" aria-hidden />
          </p>
          <div className="status status-bad qs-dropped">
            <IconX />
            {c.dropped}
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
