import { useId } from "react";
import { AI_AXIS, AI_HOLE_PATH, AI_NUQTA_PATH, AI_SMALL_NUQTA_PATH } from "./geometry";

/*
 * Qalam AI's glyph: a pair of nuqtas (./geometry.ts), the big one an outline, as the mark is a
 * stroke: Qalam AI's suggestion still being written. The hollow fills when a run completes (`done`
 * → [data-done] .q-nuqta-hole scales 0→1 on the bouncy spring). tone="ink" sits on the saffron
 * Generate button; "current" takes the text colour. Never the ✦ sparkle.
 */
export function QalamAIGlyph({
  size = 16,
  done = false,
  tone = "gradient",
  className,
}: {
  size?: 12 | 14 | 16 | 18;
  done?: boolean;
  tone?: "gradient" | "ink" | "current";
  className?: string;
}) {
  const id = "qai" + useId().replace(/[^a-zA-Z0-9_-]/g, ""); // safe inside url(#…)
  const fill = tone === "gradient" ? `url(#${id})` : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      data-done={done || undefined}
      style={tone === "ink" ? { color: "var(--color-accent-fg)" } : undefined}
    >
      {tone === "gradient" && (
        <defs>
          {/* One gradient across the whole glyph, in the theme's two periwinkles. */}
          <linearGradient id={id} gradientUnits="userSpaceOnUse" {...AI_AXIS}>
            <stop offset="0" stopColor="var(--ai-glyph-1)" />
            <stop offset="1" stopColor="var(--ai-glyph-2)" />
          </linearGradient>
        </defs>
      )}
      <path fill={fill} fillRule="evenodd" d={`${AI_NUQTA_PATH} ${AI_HOLE_PATH}`} />
      <path fill={fill} className="q-nuqta-hole" d={AI_HOLE_PATH} />
      <path fill={fill} d={AI_SMALL_NUQTA_PATH} />
    </svg>
  );
}
