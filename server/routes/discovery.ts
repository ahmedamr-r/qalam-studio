import {
  DRAFT_KNOWLEDGE,
  DRAFT_SYSTEM,
  DUMP_FOLLOWUP_SYSTEM,
  DUMP_PLACE_KNOWLEDGE,
  DUMP_PLACE_SYSTEM,
  DUMP_READ_SYSTEM,
  DiscoveryBody,
  EXTRACT_KNOWLEDGE,
  EXTRACT_SYSTEM,
  FOLLOWUPS_SCHEMA,
  FOLLOWUPS_SYSTEM,
  SYNTHESIZE_KNOWLEDGE,
  SYNTHESIZE_SYSTEM,
  draftContent,
  draftSchema,
  dumpFollowupContent,
  dumpFollowupSchema,
  dumpPlaceContent,
  dumpPlaceSchema,
  dumpReadContent,
  dumpReadSchema,
  extractContent,
  extractSchema,
  followupsContent,
  importTask,
  placeIds,
  quotableIds,
  synthesizeContent,
  synthesizeIds,
  synthesizeSchema,
  withKnowledge,
  withPieceReliance,
} from "@/ai/discovery";
import { aiConfigured, jsonError, rateLimited, streamResearch, streamStructured } from "@/ai/server";

/** Drafting a product's tree runs on the generation model (Opus 5.5 by default). */
export const DISCOVERY_MODEL = process.env.DISCOVERY_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/**
 * Discovery boards: read the product interview (and ask up to three follow-ups), then draft the
 * opportunity tree. The draft streams, so its cards appear as they're written; the client checks
 * every quote and number against the builder's answers before anything lands on the board.
 * Sources: bring material in from connected tools (import), pick out what customers said in it
 * (extract, a few parts per call), and map those quotes to the tree (synthesize). The client keeps
 * a quote only where it finds it in the material, and shows the mapping as proposals to accept.
 * A brain dump: read it (what Qalam AI took from it, its pieces, pushback, a round of questions),
 * read each round of answers, then place it (streamed, so the proposals take shape on the board).
 * Drafting, extracting, mapping and placing can carry what the organization already knows
 * (`context`): the prompt gets it, and the answer says which pieces it relied on.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = DiscoveryBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;
  const call = { model: DISCOVERY_MODEL };
  switch (b.stage) {
    case "followups":
      return streamStructured({ ...call, system: FOLLOWUPS_SYSTEM, schema: FOLLOWUPS_SCHEMA, effort: "medium", maxTokens: 8000, content: [{ type: "text", text: followupsContent(b) }] });
    case "draft":
      return streamStructured({ ...call, system: withKnowledge(DRAFT_SYSTEM, b.context, DRAFT_KNOWLEDGE), schema: withPieceReliance(draftSchema(quotableIds(b), b.context?.quotes), b.context), effort: "high", maxTokens: 24000, deltas: true, content: [{ type: "text", text: draftContent(b) }] });
    case "extract":
      return streamStructured({ ...call, system: withKnowledge(EXTRACT_SYSTEM, b.context, EXTRACT_KNOWLEDGE), schema: withPieceReliance(extractSchema(b.chunks.map((c) => c.id)), b.context), effort: "medium", maxTokens: 24000, content: [{ type: "text", text: extractContent(b) }] });
    case "synthesize": {
      const ids = synthesizeIds(b);
      return streamStructured({ ...call, system: withKnowledge(SYNTHESIZE_SYSTEM, b.context, SYNTHESIZE_KNOWLEDGE), schema: withPieceReliance(synthesizeSchema(ids.cards, ids.parents, ids.quotes), b.context), effort: "high", maxTokens: 24000, content: [{ type: "text", text: synthesizeContent(b) }] });
    }
    case "dump-read":
      return streamStructured({ ...call, system: DUMP_READ_SYSTEM, schema: dumpReadSchema(b.tree.map((c) => c.id)), effort: "high", maxTokens: 16000, content: [{ type: "text", text: dumpReadContent(b) }] });
    case "dump-followup":
      return streamStructured({ ...call, system: DUMP_FOLLOWUP_SYSTEM, schema: dumpFollowupSchema(b.tree.map((c) => c.id), b.fragments.map((f) => f.id)), effort: "medium", maxTokens: 8000, content: [{ type: "text", text: dumpFollowupContent(b) }] });
    case "dump-place":
      return streamStructured({ ...call, system: withKnowledge(DUMP_PLACE_SYSTEM, b.context, b.context?.quotes.length ? DUMP_PLACE_KNOWLEDGE : ""), schema: withPieceReliance(dumpPlaceSchema(placeIds(b)), b.context), effort: "high", maxTokens: 24000, deltas: true, content: [{ type: "text", text: dumpPlaceContent(b) }] });
    case "import": {
      // Connected tools only: a web page comes in through its address (/api/fetch-url).
      const connectors = b.connectors.filter((id) => id !== "web");
      if (!connectors.length) return jsonError(400, "no_connector", "Pick a connected tool to import from.");
      return streamResearch({ purpose: "import", task: importTask(b), connectors });
    }
  }
}
