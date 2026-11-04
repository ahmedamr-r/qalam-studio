/*
 * The names src/engine/ost-painter.ts draws Qalam AI's glyph by, from when the mark was a pencil.
 * The geometry is in ./geometry.ts; this goes once the painter imports from there.
 */
import { AI_NUQTA_POLYGON, AI_SMALL_NUQTA_POLYGON } from "./geometry";

export const PENCIL_POLYGONS = [AI_NUQTA_POLYGON] as const;
export const NUQTA_POLYGON = AI_SMALL_NUQTA_POLYGON;
