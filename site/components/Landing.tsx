"use client";

import { Nav } from "@/components/chrome/Nav";
import { Story } from "@/components/chrome/Thread";
import { LocaleProvider } from "@/components/locale";
import { SmoothScroll } from "@/components/motion/SmoothScroll";
import { ArabicScene } from "@/components/sections/ArabicScene";
import { BuildScene } from "@/components/sections/BuildScene";
import { CheckScene } from "@/components/sections/CheckScene";
import { Features } from "@/components/sections/Features";
import { Hero } from "@/components/sections/Hero";
import { PlanScene } from "@/components/sections/PlanScene";
import { ProtoScene } from "@/components/sections/ProtoScene";
import { QuoteScene } from "@/components/sections/QuoteScene";
import { ReasonScene } from "@/components/sections/ReasonScene";
import { End, Run } from "@/components/sections/Run";
import { TokensScene } from "@/components/sections/TokensScene";
import { TreeScene } from "@/components/sections/TreeScene";
import type { Locale } from "@/lib/i18n";

export function Landing({ locale }: { locale: Locale }) {
  return (
    <LocaleProvider initial={locale}>
      <SmoothScroll />
      <Nav />
      <main>
        <Hero />
        <Story>
          <QuoteScene />
          <TreeScene />
          <PlanScene />
          <BuildScene />
          <CheckScene />
          <TokensScene />
          <ArabicScene />
          <ReasonScene />
        </Story>
        <ProtoScene />
        <Features />
        <Run />
      </main>
      <End />
      {/* The language flip's seam: only shown inside the view transition (see LocaleProvider). */}
      <div className="seam" aria-hidden>
        <span className="nuqta" />
      </div>
    </LocaleProvider>
  );
}
