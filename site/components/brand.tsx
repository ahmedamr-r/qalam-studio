import { useId } from "react";

/* The studio's mark, copied from src/ui/brand/pencil.ts: a faceted pencil whose graphite point is a
   separate rhombus, the nuqta. The nuqta is also the calligrapher's unit of measure, which is why
   it leads the thread down the page. */
export const PENCIL_PATH =
  "M20.22 1.5 22.5 3.78 22.5 5.92 21.56 6.85 17.15 2.44 18.08 1.5Z M16.51 3.07 20.93 7.49 11.89 16.52 7.48 12.11Z M6.84 12.74 11.26 17.16 5.77 19.17 4.83 18.23Z M17.68 5.85 10.25 13.28 10.86 13.88 18.28 6.45Z";
export const NUQTA_PATH = "M3.37 18.75 5.25 20.63 3.37 22.5 1.5 20.63Z";
const NUQTA_HOLE_PATH = "M3.37 19.84 2.59 20.63 3.37 21.41 4.16 20.63Z";

export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" fillRule="evenodd" d={PENCIL_PATH} />
      <path fill="var(--saffron)" d={NUQTA_PATH} />
    </svg>
  );
}

/** Qalam AI's glyph: the pencil in the lapis → saffron gradient. Its nuqta is hollow while it works.
    `ink` draws it in the text colour, for the saffron buttons. */
export function AIGlyph({ size = 16, working = false, ink = false }: { size?: number; working?: boolean; ink?: boolean }) {
  const id = "g" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fill = ink ? "currentColor" : `url(#${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="ai-glyph">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="22" y1="2" x2="2" y2="22">
          <stop offset="0" stopColor="#5379fd" />
          <stop offset=".45" stopColor="#ea4ca4" />
          <stop offset=".75" stopColor="#fd6940" />
          <stop offset="1" stopColor="#f9b73f" />
        </linearGradient>
      </defs>
      <path fill={fill} fillRule="evenodd" d={PENCIL_PATH} />
      <path fill={fill} fillRule="evenodd" d={working ? `${NUQTA_PATH} ${NUQTA_HOLE_PATH}` : NUQTA_PATH} />
    </svg>
  );
}

/** A lone nuqta (rhombus). */
export function Nuqta({ className, size = 10 }: { className?: string; size?: number }) {
  return <span className={`nuqta ${className ?? ""}`} style={{ width: size, height: size }} aria-hidden />;
}

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
