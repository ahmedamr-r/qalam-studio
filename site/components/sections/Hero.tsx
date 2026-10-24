"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { GitHubIcon } from "@/components/brand";
import { CopyCommand } from "@/components/chrome/CopyCommand";
import { DotField } from "@/components/chrome/DotField";
import { useLocale } from "@/components/locale";
import { StudioWindow } from "@/components/mocks/StudioWindow";
import { gsap, MOTION_OK, SplitText, useGSAP } from "@/lib/gsap";
import { CLONE, REPO } from "@/lib/i18n";

/* The front door. On load: the nuqta ruler measures the headline (a calligrapher sizes letters in
   rhombus dots), the headline's words rise out of their clips, the rest blur-rises, and the studio
   window comes up from below. On scroll: the copy lifts away and the window rises into place. */
export function Hero() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia(ref.current ?? undefined);
      mm.add(MOTION_OK, () => {
        const split = SplitText.create(".hero-title", {
          type: "words",
          mask: "words",
          aria: "auto",
          autoSplit: true,
          onSplit: (self) =>
            gsap
              .timeline({ delay: 0.15 })
              .from(".hero-ruler .nuqta", { scale: 1.8, opacity: 0, duration: 0.5, stagger: 0.07, ease: "qalam" })
              .from(self.words, { yPercent: 130, duration: 0.9, stagger: 0.06, ease: "qalam" }, 0.2)
              .from(".hero-rise", { yPercent: 10, opacity: 0, filter: "blur(10px)", duration: 0.9, stagger: 0.08, ease: "qalam" }, 0.55)
              .from(".hero-window", { y: 80, opacity: 0, duration: 1.2, ease: "qalam" }, 0.7),
        });
        gsap.set(".hero-copy", { visibility: "visible" });

        const tl = gsap.timeline({
          scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom bottom", scrub: 0.8, invalidateOnRefresh: true },
        });
        tl.to(".hero-copy", { y: () => -window.innerHeight * 0.18, opacity: 0, ease: "none", duration: 0.45 }, 0)
          .to(".dotfield", { opacity: 0.35, ease: "none", duration: 0.5 }, 0)
          .to(
            ".hero-window-inner",
            {
              y: () => {
                const win = document.querySelector<HTMLElement>(".hero-window");
                const nav = 76;
                return win ? -(win.offsetTop - nav) : 0;
              },
              scale: 1,
              ease: "power1.inOut",
              duration: 0.8,
            },
            0,
          )
          .set({}, {}, 1);
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  return (
    <section className="hero" id="top" ref={ref}>
      <div className="hero-sticky">
        <DotField />
        <div className="hero-copy container">
          <div className="hero-ruler" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="nuqta" />
            ))}
          </div>
          <h1 className="hero-title">{t.hero.title}</h1>
          <p className="hero-sub hero-rise">{t.hero.sub}</p>
          <div className="hero-actions hero-rise">
            <a className="btn btn-pearl" href={REPO}>
              <GitHubIcon />
              {t.hero.primary}
            </a>
            <CopyCommand text={CLONE} label={t.hero.copy} done={t.hero.copied} />
          </div>
          <p className="hero-note hero-rise">{t.hero.note}</p>
        </div>
        <div className="hero-window container">
          <div className="hero-window-inner">
            <Artboard w={1280} h={760} label={t.hero.windowLabel} className="hero-artboard">
              <StudioWindow lang={locale} critic={t.build.critic} />
            </Artboard>
          </div>
        </div>
      </div>
    </section>
  );
}
