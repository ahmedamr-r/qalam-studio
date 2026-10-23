import type { BuildCtx, LBox, ScreenSpec } from "./builders";
import { BUILTIN } from "./resolve";
import { PLATFORMS, type Platform } from "./platform";

/*
 * Surfaces: the parts a screen opens or shows without leaving it (by the Back test, they belong to
 * its route), each drawn as a frame of its own beside the screen. They are built like screens,
 * from a spec's header, body and footer and with the system's recipes, but with no system bars:
 * a sheet rises from the bottom edge, a dialog sits in the middle, a toast is an inverse strip, a
 * menu is a small raised list, and a bar is a strip pinned to an edge of the screen.
 *
 * builders.ts hands a spec with a `surface` here (only types come back from it: no import cycle).
 */

export type Surface = "sheet" | "dialog" | "toast" | "menu" | "bar";
export const SURFACES = ["sheet", "dialog", "toast", "menu", "bar"] as const satisfies readonly Surface[];
export const isSurface = (v: unknown): v is Surface => (SURFACES as readonly unknown[]).includes(v);

/** What each one is called in the studio. */
export const SURFACE_LABEL: Record<Surface, string> = { sheet: "Sheet", dialog: "Dialog", toast: "Toast", menu: "Menu", bar: "Bar" };

type Region = "header" | "sidebar" | "hero" | "body" | "footer";
type Build = (region: Region, ctx?: BuildCtx) => LBox[];

const frame = (name: string, p: Partial<LBox> = {}, children: LBox[] = []): LBox => ({ kind: "frame", name, direction: "column", children, ...p });
const rect = (name: string, p: Partial<LBox>): LBox => ({ kind: "rect", name, ...p });

/** The home indicator's strip under a sheet on a phone. */
const SAFE_AREA = 34;
const MENU_W = 240;

function dark(hex: string | undefined): boolean {
  if (!hex || !/^#[0-9a-f]{6}/i.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
}

/** How wide a surface is on a platform: sheets and bars span a phone, the rest are cards. */
export function surfaceWidth(surface: Surface, platform: Platform, gutter: number): number {
  const w = PLATFORMS[platform].w;
  const phone = platform === "mobile";
  switch (surface) {
    case "sheet":
      return phone ? w : 480;
    case "bar":
      return w;
    case "dialog":
      return phone ? Math.min(w - 2 * gutter, 360) : 480;
    case "toast":
      return phone ? w - 2 * gutter : 400;
    case "menu":
      return MENU_W;
  }
}

/** Build a surface's frame from its spec (see builders.ts buildScreen, which calls this). */
export function buildSurface(spec: ScreenSpec, base: BuildCtx, build: Build): LBox {
  const surface = spec.surface!;
  const ts = base.ts ?? BUILTIN;
  const platform = base.platform ?? "mobile";
  const m = base.gutter ?? ts.dimension("layout.gutter") ?? 16;
  const sectionGap = ts.dimension("layout.section-gap") ?? 16;
  const width = surfaceWidth(surface, platform, m);
  /** Content drawn on the surface's own fill (text on a dark toast turns light). */
  const on = (fill: string): BuildCtx => ({ ...base, backdrop: false, surface: fill, onDark: dark(ts.paint(fill)?.color) || undefined });
  const name = spec.name || "Surface";
  const part = (region: Region, fill: string) => build(region, on(fill));

  switch (surface) {
    case "sheet": {
      const fill = "component.sheet.fill";
      const header = part("header", fill);
      const body = part("body", fill);
      const footer = part("footer", fill);
      return frame(
        name,
        {
          width,
          align: "stretch",
          fill,
          radius: { token: "component.sheet.radius", corners: [true, true, false, false] },
          shadow: "component.sheet.shadow",
          clip: true,
        },
        [
          frame("Grabber", { align: "center", width: "fill", padding: [8, 0, 4, 0] }, [rect("Handle", { width: 36, height: 4, radius: "radius.pill", fill: "component.sheet.handle" })]),
          ...(header.length ? [frame("Header", { width: "fill", align: "stretch" }, header)] : []),
          frame("Content", { width: "fill", align: "stretch", gap: sectionGap, padding: [header.length ? 8 : 12, m, 16, m], spaceTokens: ["layout.section-gap", "layout.gutter"] }, body),
          ...(footer.length ? [frame("Footer", { width: "fill", align: "stretch", gap: 12, padding: [12, m, 8, m] }, footer)] : []),
          ...(platform === "mobile" ? [frame("Safe area", { width: "fill", height: SAFE_AREA })] : []),
        ],
      );
    }
    case "dialog": {
      const fill = "bg.surface-raised";
      const footer = part("footer", fill);
      return frame(name, { width, align: "stretch", gap: 16, padding: [24, 24, 24, 24], fill, radius: "radius.lg", shadow: "shadow.lg", clip: true }, [
        ...part("header", fill),
        ...part("body", fill),
        ...(footer.length ? [frame("Actions", { width: "fill", align: "stretch", gap: 8 }, footer)] : []),
      ]);
    }
    case "toast": {
      const fill = "bg.inverse";
      return frame(name, { direction: "row", width, align: "center", justify: "between", gap: 12, padding: [12, 16, 12, 16], fill, radius: "radius.md", shadow: "shadow.md" }, [
        ...part("header", fill),
        ...part("body", fill),
        ...part("footer", fill),
      ]);
    }
    case "menu": {
      const fill = "bg.surface-raised";
      // Rows sit closer to the edges than on a screen.
      const ctx = { ...on(fill), gutter: 12 };
      return frame(
        name,
        { width, align: "stretch", padding: [6, 12, 6, 12], fill, radius: "radius.md", shadow: "shadow.md", stroke: { token: "border.subtle", width: 1 }, clip: true },
        [...build("header", ctx), ...build("body", ctx)],
      );
    }
    case "bar":
    default: {
      const fill = "bg.canvas";
      return frame(name, { width, align: "stretch", gap: 12, padding: [12, m, 8, m], fill }, [
        rect("Border", { height: 1, fill: "border.subtle", absolute: { top: 0, start: 0, end: 0 } }),
        ...part("header", fill),
        ...part("body", fill),
        ...part("footer", fill),
      ]);
    }
  }
}
