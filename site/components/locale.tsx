"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { getLenis } from "@/components/motion/SmoothScroll";
import { copy, type Copy } from "@/content";
import { REDUCED, ScrollTrigger } from "@/lib/gsap";
import { dirOf, type Locale } from "@/lib/i18n";

type LocaleState = {
  locale: Locale;
  rtl: boolean;
  t: Copy;
  /** Switch language in place: the page mirrors behind a seam that sweeps in the new reading direction. */
  switchTo: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleState | null>(null);

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale needs <LocaleProvider>");
  return value;
}

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initial);

  const switchTo = useCallback((next: Locale) => {
    if (next === document.documentElement.lang) return;
    const root = document.documentElement;
    const y = window.scrollY;
    const apply = () => {
      flushSync(() => setLocale(next));
      root.lang = next;
      root.dir = dirOf(next);
      document.title = copy[next].meta.title;
      history.replaceState(history.state, "", `/${next}${location.hash}`);
      ScrollTrigger.refresh();
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else window.scrollTo(0, y);
    };

    if (!document.startViewTransition || window.matchMedia(REDUCED).matches) {
      apply();
      return;
    }
    // The seam only exists in the new snapshot, so it enters with its own keyframes instead of
    // morphing from the old page's position (see `.seam` in globals.css).
    root.dataset.flip = next === "ar" ? "to-rtl" : "to-ltr";
    const transition = document.startViewTransition(() => {
      root.classList.add("is-flipping");
      apply();
    });
    transition.finished.finally(() => {
      root.classList.remove("is-flipping");
      delete root.dataset.flip;
    });
  }, []);

  const value = useMemo(
    () => ({ locale, rtl: locale === "ar", t: copy[locale], switchTo }),
    [locale, switchTo],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
