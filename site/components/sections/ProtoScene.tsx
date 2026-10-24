"use client";

import { useRef, useState } from "react";

import { Artboard } from "@/components/Artboard";
import { useLocale } from "@/components/locale";
import { Phone } from "@/components/mocks/Phone";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { CustomEase, gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/lib/gsap";

import { IconPause, IconPlay } from "../mocks/icons";

/* The prototype plays on its own, like Present does: tap Continue, the Sent screen pushes in the
   way UIKit's does, then an edge swipe takes it back. It plays only while on screen, has a pause
   button, and stays still under reduced motion. Beside it, the compiled file scrolls with the page. */

const CODE = `import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { SendMoney, Sent } from "./screens";

// iOS push: a critically damped spring, as UIKit uses.
const push = { type: "spring", stiffness: 420, damping: 42 };

export default function Prototype() {
  const [screen, setScreen] = useState<"send" | "sent">("send");

  return (
    <div className="device" data-platform="ios">
      <AnimatePresence initial={false}>
        {screen === "send" ? (
          <motion.main
            key="send"
            exit={{ x: "-30%", filter: "brightness(0.9)" }}
            transition={push}
          >
            <SendMoney onContinue={() => setScreen("sent")} />
          </motion.main>
        ) : (
          <motion.main
            key="sent"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={push}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 1 }}
            onDragEnd={(_, info) => {
              // Swipe back from the edge, as UIKit allows.
              if (info.offset.x > 120) setScreen("send");
            }}
          >
            <Sent onDone={() => setScreen("send")} />
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}`;

export function ProtoScene() {
  const { t, locale, rtl } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const loop = useRef<gsap.core.Timeline | null>(null);
  const [paused, setPaused] = useState(false);
  const c = t.proto;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia(el);
      mm.add(MOTION_OK, () => {
        const sx = rtl ? -1 : 1;
        const width = 360;
        CustomEase.create("ios-push", "M0,0 C0.2,0.9 0.32,1 1,1");
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true });
        tl.set(".pt-sent", { x: width * sx })
          .set(".pt-send", { x: 0, "--dim": 0 })
          .fromTo(".pt-tap", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.18, ease: "power2.out" }, 1)
          .to(".pt-send .ph-cta", { scale: 0.97, duration: 0.1 }, 1)
          .to(".pt-send .ph-cta", { scale: 1, duration: 0.18 }, 1.12)
          .to(".pt-tap", { opacity: 0, scale: 1.6, duration: 0.3 }, 1.15)
          .to(".pt-sent", { x: 0, duration: 0.55, ease: "ios-push" }, 1.2)
          .to(".pt-send", { x: -width * 0.3 * sx, "--dim": 1, duration: 0.55, ease: "ios-push" }, 1.2)
          // Edge swipe back: the finger lands at the leading edge and drags.
          .fromTo(".pt-finger", { opacity: 0, x: 8 * sx }, { opacity: 1, duration: 0.15 }, 3.2)
          .to(".pt-finger", { x: width * 0.55 * sx, duration: 0.5, ease: "power1.inOut" }, 3.35)
          .to(".pt-sent", { x: width * 0.55 * sx, duration: 0.5, ease: "power1.inOut" }, 3.35)
          .to(".pt-send", { x: -width * 0.3 * sx * 0.45, "--dim": 0.45, duration: 0.5, ease: "power1.inOut" }, 3.35)
          .to(".pt-finger", { opacity: 0, duration: 0.15 }, 3.85)
          .to(".pt-sent", { x: width * sx, duration: 0.35, ease: "power2.out" }, 3.85)
          .to(".pt-send", { x: 0, "--dim": 0, duration: 0.35, ease: "power2.out" }, 3.85)
          .set({}, {}, 5);
        loop.current = tl;
        ScrollTrigger.create({
          trigger: el,
          start: "top 60%",
          end: "bottom 40%",
          onToggle: (self) => (self.isActive && !el.dataset.paused ? tl.play() : tl.pause()),
        });
        return () => {
          loop.current = null;
        };
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  useScene(ref, (tl) => {
    tl.fromTo(".pt-code-inner", { y: 0 }, { y: -560, duration: 0.9, ease: "none" }, 0.05);
  });

  const toggle = () => {
    const el = ref.current;
    const tl = loop.current;
    if (!el) return;
    if (paused) {
      delete el.dataset.paused;
      tl?.play();
    } else {
      el.dataset.paused = "1";
      tl?.pause();
    }
    setPaused(!paused);
  };

  return (
    <Scene
      id="prototype"
      sceneRef={ref}
      beats={3}
      wide
      captions={[
        {
          title: c.title,
          body: c.body,
          extra: (
            <button type="button" className="btn btn-ghost caption-btn" onClick={toggle} aria-pressed={paused}>
              {paused ? <IconPlay /> : <IconPause />}
              {paused ? c.play : c.pause}
            </button>
          ),
        },
        { title: c.title2, body: c.body2 },
      ]}
    >
      <Artboard w={940} h={660} className="canvas-board studio-board">
        <div dir="ltr" lang="en" className="abs-fill">
          <div className="pt-device" style={{ left: 30, top: 20 }}>
            <div className="pt-screen" dir={rtl ? "rtl" : "ltr"}>
              <div className="pt-send">
                <Phone lang={locale} device />
              </div>
              <div className="pt-sent">
                <Phone lang={locale} device sentOnly />
              </div>
              <span className="pt-tap" aria-hidden />
              <span className="pt-finger" aria-hidden />
            </div>
          </div>
          <div className="panel pt-code" style={{ left: 370, top: 40, width: 540, height: 580 }}>
            <div className="pt-code-head">
              <span className="pt-file">Prototype.tsx</span>
              <span className="pt-meta">React + Motion</span>
            </div>
            <div className="pt-code-body">
              <pre className="pt-code-inner">
                <code>{CODE}</code>
              </pre>
            </div>
          </div>
        </div>
      </Artboard>
    </Scene>
  );
}
