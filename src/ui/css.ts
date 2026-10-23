import type { Effect, Gradient } from "@/doc/schema";

/** CSS for previews in panels (the canvas itself renders with CanvasKit). */
export function cssGradient(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
  return g.kind === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle}deg, ${stops})`;
}

export function cssShadow(effects: Effect[] | undefined): string {
  if (!effects?.length) return "none";
  return effects.map((e) => `${e.kind === "inner" ? "inset " : ""}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${e.color}`).join(", ");
}
