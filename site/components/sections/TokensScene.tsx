"use client";

import { useRef, type CSSProperties } from "react";

import { Artboard } from "@/components/Artboard";
import { useLocale } from "@/components/locale";
import { Phone } from "@/components/mocks/Phone";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { gsap } from "@/lib/gsap";

/* Step 6. Two Tovi screens share one set of tokens. Scrolling drags the controls (softer corners,
   a new accent, compact density) and both screens follow. The controls are real: whatever the
   reader sets lands on an inner wrapper, so it wins over the scroll's values and stays. Then the
   screens give way to a screenshot that code measures, for extraction. */

const ACCENTS = ["#0a7570", "#3d4fd8", "#8a3fa0", "#1f2a37"];
const START = { r: 12, accent: 0, gap: 16 };
const END = { r: 22, accent: 1, gap: 10 };
const SHOT = { x: 340, y: 6, w: 300, h: 649 };
const k = SHOT.w / 1170; // screenshot px → artboard px (the sample is 1170 × 2532, 3×)

export function TokensScene() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const user = useRef<HTMLDivElement>(null);
  const touched = useRef<Set<string>>(new Set());
  const c = t.tokens;

  const setUser = (name: string, value: string) => {
    touched.current.add(name);
    user.current?.style.setProperty(name, value);
  };

  useScene(ref, (tl, { q }) => {
    const screens = q(".tk-screens")[0];
    const slider = q(".tk-radius")[0] as HTMLInputElement;
    const radios = q(".tk-accent input") as HTMLInputElement[];
    const dens = q(".tk-density input") as HTMLInputElement[];
    const mix = gsap.utils.interpolate(ACCENTS[START.accent], ACCENTS[END.accent]);
    const state = { ...START };
    const apply = () => {
      screens.style.setProperty("--t-r", `${state.r.toFixed(1)}px`);
      screens.style.setProperty("--t-accent", mix(state.accent));
      screens.style.setProperty("--t-gap", `${state.gap.toFixed(1)}px`);
      if (!touched.current.has("--t-r")) slider.value = String(Math.round(state.r));
      if (!touched.current.has("--t-accent")) radios.forEach((r, i) => (r.checked = i === (state.accent > 0.5 ? END.accent : START.accent)));
      if (!touched.current.has("--t-gap")) dens.forEach((d, i) => (d.checked = i === (state.gap < 13 ? 1 : 0)));
    };
    apply();
    tl.to(state, { r: END.r, duration: 0.12, ease: "power1.inOut", onUpdate: apply }, 0.1)
      .to(state, { accent: END.accent, duration: 0.1, ease: "power1.inOut", onUpdate: apply }, 0.26)
      .to(state, { gap: END.gap, duration: 0.1, ease: "power1.inOut", onUpdate: apply }, 0.4)
      .to(".tk-phones, .tk-panel", { opacity: 0, scale: 0.96, duration: 0.06 }, 0.6)
      .fromTo(".tk-shot", { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.06 }, 0.62)
      .fromTo(".tk-m", { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, stagger: 0.05, duration: 0.04 }, 0.7)
      .fromTo(".tk-m path, .tk-m line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.05, duration: 0.05 }, 0.7);
  });

  const m = (style: CSSProperties) => ({ position: "absolute" as const, ...style });

  return (
    <Scene
      id="tokens"
      sceneRef={ref}
      beats={3.5}
      step={6}
      wide
      interactive
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={980} h={660} className="canvas-board studio-board">
        <div className="abs-fill">
          <form className="panel tk-panel" style={{ left: 16, top: 150, width: 268 }} onSubmit={(e) => e.preventDefault()}>
            <p className="tk-try">{c.try}</p>
            <label className="tk-field">
              <span>{c.radius}</span>
              <input
                className="tk-radius"
                type="range"
                min={0}
                max={28}
                defaultValue={START.r}
                onChange={(e) => setUser("--t-r", `${e.currentTarget.value}px`)}
              />
            </label>
            <fieldset className="tk-field tk-accent">
              <legend>{c.accent}</legend>
              <div className="tk-swatches">
                {ACCENTS.map((hex, i) => (
                  <label key={hex} title={c.accents[i]}>
                    <input
                      type="radio"
                      name="tk-accent"
                      defaultChecked={i === START.accent}
                      onChange={() => setUser("--t-accent", hex)}
                      aria-label={c.accents[i]}
                    />
                    <i style={{ background: hex }} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="tk-field tk-density">
              <legend>{c.density}</legend>
              <div className="seg">
                {[c.comfortable, c.compact].map((label, i) => (
                  <label key={label}>
                    <input
                      type="radio"
                      name="tk-density"
                      defaultChecked={i === 0}
                      onChange={() => setUser("--t-gap", i === 0 ? "16px" : "10px")}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>

          <div className="tk-screens" dir="ltr">
            <div className="tk-phones" ref={user}>
              <div className="frame-label" style={{ left: 316, top: 2 }} lang="en">
                Send money
              </div>
              <div className="frame" style={{ left: 316, top: 24, width: 288, height: 608 }}>
                <Phone lang={locale} style={{ scale: 0.8, transformOrigin: "0 0" }} />
              </div>
              <div className="frame-label" style={{ left: 640, top: 2 }} lang="en">
                Sent
              </div>
              <div className="frame" style={{ left: 640, top: 24, width: 288, height: 608 }}>
                <Phone lang={locale} sentOnly style={{ scale: 0.8, transformOrigin: "0 0" }} />
              </div>
            </div>
          </div>

          <figure className="tk-shot" style={{ left: SHOT.x, top: SHOT.y, width: SHOT.w, height: SHOT.h }} dir="ltr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/samples/lumen-wallet.webp" alt={c.screenshotAlt} width={SHOT.w} height={SHOT.h} loading="lazy" decoding="async" />
            <span className="tk-m" style={m({ left: 1170 * k - 6, top: 2076 * k, height: 162 * k })}>
              <svg width="12" height={162 * k} viewBox={`0 0 12 ${162 * k}`} aria-hidden>
                <line x1="6" y1="0" x2="6" y2={162 * k} pathLength={1} />
                <line x1="0" y1="0.5" x2="12" y2="0.5" pathLength={1} />
                <line x1="0" y1={162 * k - 0.5} x2="12" y2={162 * k - 0.5} pathLength={1} />
              </svg>
              <b className="pill-measure" style={{ insetInlineStart: 18, top: (162 * k) / 2 - 11 }}>
                Height 54
              </b>
            </span>
            <span className="tk-m" style={m({ left: 60 * k, top: 340 * k })}>
              <svg width={72 * k + 2} height={72 * k + 2} viewBox={`-1 -1 ${72 * k + 2} ${72 * k + 2}`} aria-hidden>
                <path d={`M0 ${72 * k} A ${72 * k} ${72 * k} 0 0 1 ${72 * k} 0`} pathLength={1} />
              </svg>
              <b className="pill-measure" style={{ insetInlineEnd: 60 * k + 30, top: -11 }}>
                Radius 24
              </b>
            </span>
            <span className="tk-m" style={m({ left: 0, top: 1300 * k, width: 60 * k })}>
              <svg width={60 * k} height="12" viewBox={`0 0 ${60 * k} 12`} aria-hidden>
                <line x1="0" y1="6" x2={60 * k} y2="6" pathLength={1} />
              </svg>
              <b className="pill-measure" style={{ insetInlineEnd: 60 * k + 8, top: -5 }}>
                Gutter 20
              </b>
            </span>
          </figure>
        </div>
      </Artboard>
    </Scene>
  );
}
