import { DS_GUIDE_SYSTEM, DS_REBUILD_BASE, blockFor, dsFoundationsSystem } from "@/ai/prompts";
import { REBUILD_SCHEMA, SCAN_SCHEMA, foundationsSchema, guideSchema } from "@/ai/ds-schemas";
import { ExtractDsBody, captureLine } from "@/ai/ds-request";
import { DS_SCAN_SYSTEM, scanContent } from "@/ai/ds-scan";
import { DS_RECONCILE_SYSTEM, RECONCILE_SCHEMA, reconcileContent } from "@/ai/ds-reconcile";
import { foundationsInstructions, guideInstructions, normalizeOptions, wantsGuide } from "@/design-system/extract-options";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import type Anthropic from "@anthropic-ai/sdk";

/** Extraction runs on Opus 5.5 (the most precise reader of screenshots), whatever the default model is. */
const EXTRACT_MODEL = process.env.DS_EXTRACT_MODEL || "claude-opus-5-5";

/** The first look is quick (low effort, small images); it can run on another model. */
const SCAN_MODEL = process.env.DS_SCAN_MODEL || EXTRACT_MODEL;

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = ExtractDsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { stage, images, captures, palette, foundations, name, designSystem, reconcile } = parsed.data;
  const options = normalizeOptions(parsed.data.options);
  if (stage === "scan")
    return streamStructured({ system: DS_SCAN_SYSTEM, schema: SCAN_SCHEMA, effort: "low", model: SCAN_MODEL, maxTokens: 12000, content: scanContent(images, captures, options.notes[0]?.answer) });
  if (stage === "rebuild") {
    if (!designSystem) return jsonError(400, "bad_input", "The rebuild needs the extracted system.");
    const first = images[0];
    return streamStructured({
      system: [DS_REBUILD_BASE, blockFor(designSystem)],
      schema: REBUILD_SCHEMA,
      effort: "medium",
      model: EXTRACT_MODEL,
      maxTokens: 48000,
      content: [
        { type: "image", source: { type: "base64", media_type: first.mediaType, data: first.data } },
        { type: "text", text: [captures[0] ? captureLine(captures[0], 0) : "", "Rebuild this screenshot with the catalog, as faithfully as it allows."].filter(Boolean).join("\n") },
      ],
    });
  }
  if (stage === "reconcile") {
    if (!reconcile) return jsonError(400, "bad_input", "The comparison needs the rebuild.");
    return streamStructured({ system: DS_RECONCILE_SYSTEM, schema: RECONCILE_SCHEMA, effort: "medium", model: EXTRACT_MODEL, maxTokens: 16000, content: reconcileContent(images[0], captures[0], reconcile) });
  }
  if (stage === "guide" && !foundations) return jsonError(400, "bad_input", "The guide pass needs the extracted foundations.");
  if (stage === "guide" && !wantsGuide(options)) return jsonError(400, "bad_input", "Nothing to write: choose the design language, component guides or new components.");

  // Numbered, so bboxes can say which image they are in.
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = images.flatMap((im, i) => [
    ...(images.length > 1 ? [{ type: "text" as const, text: `Image ${i + 1}:` }] : []),
    { type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } },
  ]);
  const lines =
    stage === "foundations"
      ? [
          `Extract the design system from ${images.length > 1 ? `these ${images.length} screenshots of one product` : "this screenshot"}.`,
          captures.map(captureLine).join("\n"),
          palette.length ? `Dominant flat colours measured from the pixels (use these exact hexes where they match): ${palette.join(", ")}` : "",
          foundationsInstructions(options),
        ]
      : [
          `Write the documentation for the design system "${name ?? "Extracted"}" extracted from ${images.length > 1 ? "these screenshots" : "this screenshot"}.`,
          guideInstructions(options),
          `Extracted tokens:\n${foundations}`,
        ];
  content.push({ type: "text", text: lines.filter(Boolean).join("\n\n") });

  return streamStructured(
    stage === "foundations"
      ? { system: dsFoundationsSystem(options.depth), schema: foundationsSchema(options.depth), effort: "high", content, model: EXTRACT_MODEL, maxTokens: 48000 }
      : // Writing, not measuring: medium effort keeps the second pass to a few minutes.
        { system: DS_GUIDE_SYSTEM, schema: guideSchema(options), effort: "medium", content, model: EXTRACT_MODEL, maxTokens: 64000 },
  );
}
