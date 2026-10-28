import {
  DRAFT_KNOWLEDGE,
  DRAFT_SYSTEM,
  DUMP_FOLLOWUP_SYSTEM,
  DUMP_PLACE_KNOWLEDGE,
  DUMP_PLACE_SYSTEM,
  DUMP_READ_SYSTEM,
  DiscoveryBody,
  FOLLOWUPS_SCHEMA,
  FOLLOWUPS_SYSTEM,
  draftContent,
  draftSchema,
  dumpFollowupContent,
  dumpFollowupSchema,
  dumpPlaceContent,
  dumpPlaceSchema,
  dumpReadContent,
  dumpReadSchema,
  extractCall,
  followupsContent,
  importTask,
  placeIds,
  quotableIds,
  synthesizeCall,
  withKnowledge,
  withPieceReliance,
} from "@/ai/discovery";
import { aiConfigured, jsonError, rateLimited, streamResearch, streamStructured } from "@/ai/server";

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
  // Each stage's kind picks its model (src/ai/models.ts): extracting reads, the rest decide.
  switch (b.stage) {
    case "followups":
      return streamStructured({ kind: "followups", system: FOLLOWUPS_SYSTEM, schema: FOLLOWUPS_SCHEMA, effort: "medium", maxTokens: 8000, content: [{ type: "text", text: followupsContent(b) }] });
    case "draft":
      return streamStructured({ kind: "draft", system: withKnowledge(DRAFT_SYSTEM, b.context, DRAFT_KNOWLEDGE), schema: withPieceReliance(draftSchema(quotableIds(b), b.context?.quotes), b.context), effort: "high", maxTokens: 24000, deltas: true, content: [{ type: "text", text: draftContent(b) }] });
    case "extract":
      return streamStructured(extractCall(b));
    case "synthesize":
      return streamStructured(synthesizeCall(b));
    case "dump-read":
      return streamStructured({ kind: "dump-read", system: DUMP_READ_SYSTEM, schema: dumpReadSchema(b.tree.map((c) => c.id)), effort: "high", maxTokens: 16000, content: [{ type: "text", text: dumpReadContent(b) }] });
    case "dump-followup":
      return streamStructured({ kind: "dump-followup", system: DUMP_FOLLOWUP_SYSTEM, schema: dumpFollowupSchema(b.tree.map((c) => c.id), b.fragments.map((f) => f.id)), effort: "medium", maxTokens: 8000, content: [{ type: "text", text: dumpFollowupContent(b) }] });
    case "dump-place":
      return streamStructured({ kind: "dump-place", system: withKnowledge(DUMP_PLACE_SYSTEM, b.context, b.context?.quotes.length ? DUMP_PLACE_KNOWLEDGE : ""), schema: withPieceReliance(dumpPlaceSchema(placeIds(b)), b.context), effort: "high", maxTokens: 24000, deltas: true, content: [{ type: "text", text: dumpPlaceContent(b) }] });
    case "import": {
      // Connected tools only: a web page comes in through its address (/api/fetch-url).
      const connectors = b.connectors.filter((id) => id !== "web");
      if (!connectors.length) return jsonError(400, "no_connector", "Pick a connected tool to import from.");
      return streamResearch({ purpose: "import", task: importTask(b), connectors });
    }
  }
}
