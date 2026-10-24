"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { AIGlyph } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";

import { IconCheck } from "../mocks/icons";

/* Step 3. Plan first: Qalam AI reads back what it understood, asks three questions with a
   recommended answer each, and the answers tick in as you scroll. Then Generate. */
export function PlanScene() {
  const { t } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.plan;

  useScene(ref, (tl) => {
    tl.fromTo(".pl-understood", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.06 }, 0);
    c.questions.forEach((_, i) => {
      const at = 0.1 + i * 0.17;
      tl.fromTo(`.pl-q${i}`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.06 }, at).fromTo(
        `.pl-q${i} .pl-opt-rec`,
        { "--on": 0 },
        { "--on": 1, duration: 0.04 },
        at + 0.08,
      );
    });
    tl.fromTo(".pl-generate", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.05 }, 0.68)
      .to(".pl-generate", { scale: 0.96, duration: 0.02 }, 0.82)
      .to(".pl-generate", { scale: 1, duration: 0.03 }, 0.84)
      .fromTo(".pl-working", { opacity: 0 }, { opacity: 1, duration: 0.03 }, 0.85);
  });

  return (
    <Scene
      id="plan"
      sceneRef={ref}
      beats={3}
      step={3}
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={620} h={640} className="canvas-board">
        <div className="chat" style={{ insetInlineStart: 40, top: 20, width: 540 }}>
          <div className="chat-head">
            <AIGlyph size={16} />
            <b>{c.ai}</b>
          </div>
          <div className="pl-understood">
            <span className="chat-caption">{c.understoodLabel}</span>
            <p>{c.understood}</p>
          </div>
          {c.questions.map((item, i) => (
            <div key={i} className={`pl-q pl-q${i}`}>
              <p className="pl-question">{item.q}</p>
              <div className="pl-opts">
                {item.options.map((o, j) => (
                  <span key={j} className={`pl-opt ${j === 0 ? "pl-opt-rec" : ""}`}>
                    {j === 0 && (
                      <span className="pl-tick">
                        <IconCheck size={12} />
                      </span>
                    )}
                    {o}
                    {j === 0 && <span className="pl-rec">{c.recommended}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="pl-foot">
            <span className="pl-working" aria-hidden>
              <AIGlyph size={14} working />
            </span>
            <span className="btn-saffron pl-generate">
              <AIGlyph size={14} ink />
              {c.generate}
            </span>
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
