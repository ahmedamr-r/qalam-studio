"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useLocale } from "@/components/locale";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";

import { IconSearch } from "../mocks/icons";

/* Everything else, as the studio's own ⌘K palette instead of a grid of cards: a real search field
   over the real command names. Arrow keys move through the results. */
export function Features() {
  const { t, locale } = useLocale();
  const c = t.features;
  const ref = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return c.groups
      .map((g) => ({
        name: g.name,
        items: g.items.filter((item) => {
          const hay = `${item.name} ${item.desc} ${g.name}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [c.groups, query]);
  const flat = results.flatMap((g) => g.items);
  const total = c.groups.reduce((n, g) => n + g.items.length, 0);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  useGSAP(
    () => {
      const mm = gsap.matchMedia(ref.current ?? undefined);
      mm.add(MOTION_OK, () => {
        gsap
          .timeline({ scrollTrigger: { trigger: ".palette", start: "top 80%", once: true } })
          .from(".palette-keys kbd", { y: 3, duration: 0.12, stagger: 0.06, yoyo: true, repeat: 1, ease: "power1.inOut" })
          .from(".palette", { scale: 0.97, opacity: 0, y: 24, duration: 0.7, ease: "qalam" }, 0.15)
          .from(".palette-group", { opacity: 0, y: 12, stagger: 0.06, duration: 0.5, ease: "qalam" }, 0.35);
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [locale], revertOnUpdate: true },
  );

  let index = -1;
  return (
    <section className="features" id="features" ref={ref} aria-labelledby="features-title">
      <div className="container features-inner">
        <div className="features-copy">
          <h2 id="features-title" className="section-title">
            {c.title}
          </h2>
          <p className="section-body">{c.body}</p>
          <p className="palette-keys" aria-hidden dir="ltr">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </p>
        </div>

        <div className="palette" role="search">
          <label className="palette-field">
            <IconSearch />
            <span className="sr-only">{c.placeholder}</span>
            <input
              type="search"
              value={query}
              placeholder={c.placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              aria-controls="palette-list"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="palette-count">
              {flat.length}/{total}
            </span>
          </label>
          <div className="palette-list" id="palette-list" aria-live="polite">
            {results.length === 0 && <p className="palette-empty">{c.empty}</p>}
            {results.map((g) => (
              <div key={g.name} className="palette-group">
                <p className="palette-group-name">{g.name}</p>
                <ul>
                  {g.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <li key={item.name} className={i === active ? "is-active" : undefined} onMouseEnter={() => setActive(i)}>
                        <span className="palette-name" lang="en">
                          {item.name}
                        </span>
                        <span className="palette-desc">{item.desc}</span>
                        {"keys" in item && item.keys && (
                          <span className="palette-kbd" dir="ltr">
                            {item.keys.map((k) => (
                              <kbd key={k}>{k}</kbd>
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
