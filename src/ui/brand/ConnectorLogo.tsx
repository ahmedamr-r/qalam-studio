import clsx from "clsx";
import { AudioLines } from "lucide-react";
import { logoFor } from "@/connectors/logos";

/*
 * A connector's logo (src/connectors/logos.ts): its mark in its brand colour on a tile that stays
 * light in both themes (bg-stage), so a brand reads the same on either; a colour too pale for the
 * tile draws in ink. `decorative` when the connector's name is already beside it.
 */
export function ConnectorLogo({ id, size = 20, decorative, className }: { id: string; size?: 20 | 28; decorative?: boolean; className?: string }) {
  const logo = logoFor(id);
  const glyph = size === 20 ? 12 : 16;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : logo.title}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : logo.title}
      className={clsx(
        "grid shrink-0 place-items-center bg-stage text-stage-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
        size === 20 ? "size-[20px] rounded-sm" : "size-[28px] rounded-md",
        className,
      )}
    >
      {logo.kind === "mark" ? (
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={logo.tone === "brand" ? { color: `#${logo.hex}` } : undefined}>
          <path d={logo.path} />
        </svg>
      ) : logo.kind === "audio" ? (
        <AudioLines size={glyph} absoluteStrokeWidth strokeWidth={1.5} aria-hidden />
      ) : (
        <span aria-hidden className={clsx("font-semibold", size === 20 ? "text-micro" : "text-caption")}>
          {logo.letter}
        </span>
      )}
    </span>
  );
}
