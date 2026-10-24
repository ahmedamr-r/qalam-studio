"use client";

import { GitHubIcon, Mark } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { otherLocale, REPO } from "@/lib/i18n";

export function Nav() {
  const { t, locale, switchTo } = useLocale();
  const other = otherLocale(locale);
  return (
    <header className="nav">
      <div className="nav-inner container">
        <a href="#top" className="nav-brand" aria-label={t.nav.home}>
          <Mark size={20} />
          <span>Qalam Studio</span>
        </a>
        <nav className="nav-links" aria-label="Page">
          <a href="#story">{t.nav.story}</a>
          <a href="#features">{t.nav.features}</a>
          <a href="#run">{t.nav.run}</a>
        </nav>
        <div className="nav-end">
          <button type="button" className="nav-lang" lang={other} onClick={() => switchTo(other)} title={t.nav.langLabel}>
            {t.nav.lang}
          </button>
          <a className="btn btn-pearl btn-sm" href={REPO}>
            <GitHubIcon size={15} />
            <span className="nav-gh-text">{t.nav.github}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
