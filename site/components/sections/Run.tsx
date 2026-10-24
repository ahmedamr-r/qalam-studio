"use client";

import { useRef, useState } from "react";

import { GitHubIcon, Mark } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";
import { REPO } from "@/lib/i18n";

import { IconCheck } from "../mocks/icons";

const COMMANDS = [
  `git clone ${REPO}.git`,
  "cd qalam-studio",
  "pnpm install",
  "cp .env.example .env.local",
  "pnpm dev",
];

/* Run it: the README's steps type themselves out once, then privacy and requirements. */
export function Run() {
  const { t, locale } = useLocale();
  const c = t.run;
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useGSAP(
    () => {
      const mm = gsap.matchMedia(ref.current ?? undefined);
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: ".term", start: "top 75%", once: true } });
        gsap.utils.toArray<HTMLElement>(".term-line").forEach((line) => {
          const text = line.querySelector<HTMLElement>(".term-text");
          const n = Math.min(text?.textContent?.length ?? 10, 48);
          tl.fromTo(
            text,
            { clipPath: "inset(0 100% 0 0)" },
            { clipPath: "inset(0 0% 0 0)", duration: n * 0.028, ease: `steps(${n})` },
            "+=0.18",
          ).fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.01 }, "<");
        });
        tl.from(".term-ready", { opacity: 0, y: 6, duration: 0.4, ease: "qalam" }, "+=0.2");
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked; the commands are selectable. */
    }
  };

  return (
    <section className="run" id="run" ref={ref} aria-labelledby="run-title">
      <div className="container run-inner">
        <div className="run-copy">
          <h2 id="run-title" className="section-title">
            {c.title}
          </h2>
          <p className="section-body">{c.body}</p>
          <dl className="run-privacy">
            {c.privacy.map(([title, body]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="run-side">
          <div className="term" dir="ltr" lang="en">
            <div className="term-head">
              <span className="term-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="term-title">~/code</span>
              <button type="button" className="term-copy" onClick={copyAll}>
                {copied ? <IconCheck size={13} /> : null}
                {copied ? c.copied : c.copyAll}
              </button>
            </div>
            <pre className="term-body" aria-label={c.terminalLabel}>
              {COMMANDS.map((cmd, i) => (
                <span key={cmd} className="term-line">
                  <span className="term-prompt" aria-hidden>
                    $
                  </span>
                  <span className="term-text">
                    {cmd}
                    {i === 3 && <span className="term-comment">{c.commentEnv}</span>}
                  </span>
                </span>
              ))}
              <span className="term-ready">
                <span className="term-ok">✓</span> Ready on http://localhost:3000
              </span>
            </pre>
          </div>
          <div className="run-need">
            <p className="run-need-title">{c.needTitle}</p>
            <ul>
              {c.need.map((n) => (
                <li key={n}>
                  <IconCheck size={13} />
                  {n}
                </li>
              ))}
            </ul>
            <p className="run-noai">{c.noAi}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* The end: the mark at poster size; its nuqta fills on a spring, the one spring on the page, the
   way Qalam AI's glyph fills when a run is done. */
export function End() {
  const { t, locale } = useLocale();
  const c = t.end;
  const f = t.footer;
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia(ref.current ?? undefined);
      mm.add(MOTION_OK, () => {
        gsap
          .timeline({ scrollTrigger: { trigger: ".end-mark", start: "top 75%", once: true } })
          .from(".end-pencil", { opacity: 0, x: 30, y: -30, duration: 1, ease: "qalam" })
          .fromTo(".end-nuqta-fill", { scale: 0 }, { scale: 1, duration: 0.9, ease: "elastic.out(1, 0.45)", transformOrigin: "50% 50%" }, 0.55)
          .from(".end-rise", { yPercent: 10, opacity: 0, filter: "blur(10px)", duration: 0.9, stagger: 0.08, ease: "qalam" }, 0.6);
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  return (
    <section className="end" ref={ref} aria-labelledby="end-title">
      <div className="container end-inner">
        <svg className="end-mark" viewBox="0 0 24 24" aria-hidden>
          <path
            className="end-pencil"
            fill="currentColor"
            fillRule="evenodd"
            d="M20.22 1.5 22.5 3.78 22.5 5.92 21.56 6.85 17.15 2.44 18.08 1.5Z M16.51 3.07 20.93 7.49 11.89 16.52 7.48 12.11Z M6.84 12.74 11.26 17.16 5.77 19.17 4.83 18.23Z M17.68 5.85 10.25 13.28 10.86 13.88 18.28 6.45Z"
          />
          <path className="end-nuqta" d="M3.37 18.75 5.25 20.63 3.37 22.5 1.5 20.63Z" />
          <path className="end-nuqta-fill" d="M3.37 18.75 5.25 20.63 3.37 22.5 1.5 20.63Z" />
        </svg>
        <h2 id="end-title" className="end-title end-rise">
          {c.title}
        </h2>
        <p className="end-body end-rise">{c.body}</p>
        <div className="end-actions end-rise">
          <a className="btn btn-pearl" href={REPO}>
            <GitHubIcon />
            {c.primary}
          </a>
          <a className="btn btn-ghost" href={`${REPO}/issues`}>
            {c.secondary}
          </a>
        </div>
        <p className="end-meaning end-rise">{c.meaning}</p>
      </div>
      <footer className="footer">
        <div className="container footer-inner">
          <span className="footer-brand">
            <Mark size={16} />
            Qalam Studio
          </span>
          <span className="footer-note">{f.early}</span>
          <span className="footer-links">
            <a href={`${REPO}/blob/main/LICENSE`}>{f.license}</a>
            <a href={REPO}>{f.source}</a>
            <span>
              {f.builtBy} <a href="https://www.ahmedamr.com">{f.author}</a>
            </span>
          </span>
        </div>
      </footer>
    </section>
  );
}
