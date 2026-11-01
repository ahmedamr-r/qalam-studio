import clsx from "clsx";
import { AudioLines } from "lucide-react";
import { engineLogo, logoFor, type Logo } from "@/connectors/logos";
import type { EngineKind } from "@/ai/engine-kinds";

/*
 * A connector's logo, or an engine maker's (src/connectors/logos.ts): its mark in its brand colour
 * on a tile that stays light in both themes (bg-stage), so a brand reads the same on either; a
 * colour a shade too pale for the tile draws a shade deeper, one far too pale in ink. `decorative`
 * when the name is already beside it.
 */
export function ConnectorLogo({ id, ...o }: { id: string } & TileProps) {
  return <BrandTile logo={logoFor(id)} {...o} />;
}

/** The engine Qalam AI runs on, by its maker's mark: Claude's for Claude Code and a Claude key, OpenAI's for Codex and an OpenAI key. */
export function EngineLogo({ kind, ...o }: { kind: EngineKind } & TileProps) {
  return <BrandTile logo={engineLogo(kind)} {...o} />;
}

interface TileProps {
  size?: 16 | 20 | 28;
  decorative?: boolean;
  className?: string;
}

function BrandTile({ logo, size = 20, decorative, className }: { logo: Logo } & TileProps) {
  const glyph = size === 16 ? 10 : size === 20 ? 12 : 16;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : logo.title}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : logo.title}
      className={clsx(
        "grid shrink-0 place-items-center bg-stage text-stage-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
        size === 16 ? "size-[16px] rounded-[3px]" : size === 20 ? "size-[20px] rounded-sm" : "size-[28px] rounded-md",
        className,
      )}
    >
      {logo.kind === "mark" ? (
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={logo.tone === "brand" ? { color: logo.color ?? `#${logo.hex}` } : undefined}>
          <path d={logo.path} />
        </svg>
      ) : logo.kind === "audio" ? (
        <AudioLines size={glyph} absoluteStrokeWidth strokeWidth={1.5} aria-hidden />
      ) : (
        <span aria-hidden className={clsx("font-semibold", size === 28 ? "text-caption" : "text-micro")}>
          {logo.letter}
        </span>
      )}
    </span>
  );
}
