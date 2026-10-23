import { useId } from "react";
import { NUQTA_HOLE_PATH, NUQTA_PATH, PENCIL_AXIS, PENCIL_PATH } from "./pencil";

/*
 * Qalam AI's glyph: the studio's pencil (src/ui/brand/pencil.ts) with its nuqta point hollow, Qalam
 * AI's suggestion still being written. The hollow fills when a run completes (`done` → [data-done]
 * .q-nuqta-hole scales 0→1 on the bouncy spring). Below 16px the hollow would close up, so the
 * nuqta is drawn filled. tone="ink" sits on the saffron Generate button; "current" takes the text
 * colour. Never the ✦ sparkle.
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
  const small = size < 16;
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
          {/* One gradient across the whole glyph, eraser (lapis) to point (saffron). */}
          <linearGradient id={id} gradientUnits="userSpaceOnUse" {...PENCIL_AXIS}>
            <stop offset="0" stopColor="#5379fd" />
            <stop offset=".45" stopColor="#ea4ca4" />
            <stop offset=".75" stopColor="#fd6940" />
            <stop offset="1" stopColor="#f9b73f" />
          </linearGradient>
        </defs>
      )}
      <path fill={fill} fillRule="evenodd" d={PENCIL_PATH} />
      {small ? (
        <path fill={fill} d={NUQTA_PATH} />
      ) : (
        <>
          <path fill={fill} fillRule="evenodd" d={`${NUQTA_PATH} ${NUQTA_HOLE_PATH}`} />
          <path fill={fill} className="q-nuqta-hole" d={NUQTA_HOLE_PATH} />
        </>
      )}
    </svg>
  );
}
