import { z } from "zod";
import { MAX_EXTRACT_IMAGES } from "@/design-system/extract-options";
import { SystemPayloadSchema } from "./ds-payload";

/** Request body of /api/extract-ds (kept out of the route so tests can import it). */

export const Image = z.object({ mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string().max(4_500_000) });

/** What the studio read from each capture's size (see src/design-system/pixels.ts). */
export const Capture = z.object({
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(40_000),
  sentWidth: z.number().int().positive().max(4000),
  sentHeight: z.number().int().positive().max(4000),
  scale: z.number().positive().max(8),
  logicalWidth: z.number().positive().max(10_000),
  confident: z.boolean(),
  kind: z.enum(["phone", "desktop"]),
  alternative: z.number().positive().max(8).optional(),
});
export type CaptureInput = z.infer<typeof Capture>;

export function captureLine(c: CaptureInput, i: number): string {
  const size = `Image ${i + 1}: a ${c.kind} capture of ${c.width}×${c.height} px, shown to you at ${c.sentWidth}×${c.sentHeight}.`;
  return c.confident
    ? `${size} Its scale is ${c.scale}× (${c.logicalWidth} px wide at 1x): divide capture pixels by ${c.scale}.`
    : `${size} Its scale is probably ${c.scale}× (${c.logicalWidth} px wide at 1x)${c.alternative ? `, possibly ${c.alternative}× (${Math.round(c.width / c.alternative)} px wide)` : ""}: judge from the UI.`;
}

/** What the client sends for the comparison (the screenshot itself is images[0] of the request). */
export const ReconcileInput = z.object({
  /** The rebuild, drawn with the draft system. */
  rebuild: Image,
  /** The draft's structure, one line per component. */
  structure: z.array(z.string().max(400)).max(20),
  /** The structural tokens as "path = value". */
  tokens: z.array(z.string().max(200)).max(120),
  /** What the studio measured, on both sides. */
  measured: z.array(z.string().max(400)).max(30),
  /** The rebuild's components, by region. */
  outline: z.string().max(8000),
  gaps: z.array(z.object({ element: z.string().max(200), workaround: z.string().max(200) })).max(12),
});
export type ReconcileInputT = z.infer<typeof ReconcileInput>;

export const ExtractDsBody = z.object({
  /** scan = the first look (what's there, what to ask); then foundations, guide and rebuild; reconcile = compare the rebuild with the screenshot. */
  stage: z.enum(["scan", "foundations", "guide", "rebuild", "reconcile"]),
  images: z.array(Image).min(1).max(MAX_EXTRACT_IMAGES),
  captures: z.array(Capture).max(MAX_EXTRACT_IMAGES).default([]),
  palette: z.array(z.string().max(12)).max(24).default([]),
  /** Pass 2 only: the extracted tokens, as "path = value" lines. */
  foundations: z.string().max(60_000).optional(),
  name: z.string().max(80).optional(),
  /** Rebuild only: the system extracted in pass 1. */
  designSystem: SystemPayloadSchema.optional(),
  /** Reconcile only: the rebuild drawn with the draft, and what the studio knows about both. */
  reconcile: ReconcileInput.optional(),
  /** What the designer asked for: token depth, which docs to write, and their answers. */
  options: z
    .object({
      depth: z.enum(["essentials", "standard", "complete"]),
      docs: z.boolean(),
      language: z.boolean(),
      components: z.array(z.string().max(40)).max(40),
      patterns: z.enum(["none", "suggest", "listed"]),
      patternNames: z.array(z.string().max(40)).max(6),
      observed: z.array(z.string().max(40)).max(40),
      recipes: z.enum(["all", "chosen"]),
      notes: z.array(z.object({ question: z.string().max(300), answer: z.string().max(300) })).max(6),
    })
    .partial()
    .optional(),
});
export type ExtractDsRequest = z.infer<typeof ExtractDsBody>;
