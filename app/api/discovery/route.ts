import {
  DRAFT_SYSTEM,
  DiscoveryBody,
  EXTRACT_SYSTEM,
  FOLLOWUPS_SCHEMA,
  FOLLOWUPS_SYSTEM,
  SYNTHESIZE_SYSTEM,
  draftContent,
  draftSchema,
  extractContent,
  extractSchema,
  followupsContent,
  importTask,
  quotableIds,
  synthesizeContent,
  synthesizeIds,
  synthesizeSchema,
} from "@/ai/discovery";
import { aiConfigured, jsonError, rateLimited, streamResearch, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** Drafting a product's tree runs on the generation model (Opus 5.5 by default). */
const DISCOVERY_MODEL = process.env.DISCOVERY_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/**
 * Discovery boards: read the product interview (and ask up to three follow-ups), then draft the
 * opportunity tree. The draft streams, so its cards appear as they're written; the client checks
 * every quote and number against the builder's answers before anything lands on the board.
 * Sources: bring material in from connected tools (import), pick out what customers said in it
 * (extract, a few parts per call), and map those quotes to the tree (synthesize). The client keeps
 * a quote only where it finds it in the material, and shows the mapping as proposals to accept.
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
      return streamStructured({ ...call, system: DRAFT_SYSTEM, schema: draftSchema(quotableIds(b)), effort: "high", maxTokens: 24000, deltas: true, content: [{ type: "text", text: draftContent(b) }] });
    case "extract":
      return streamStructured({ ...call, system: EXTRACT_SYSTEM, schema: extractSchema(b.chunks.map((c) => c.id)), effort: "medium", maxTokens: 24000, content: [{ type: "text", text: extractContent(b) }] });
    case "synthesize": {
      const ids = synthesizeIds(b);
      return streamStructured({ ...call, system: SYNTHESIZE_SYSTEM, schema: synthesizeSchema(ids.cards, ids.parents, ids.quotes), effort: "high", maxTokens: 24000, content: [{ type: "text", text: synthesizeContent(b) }] });
    }
    case "import": {
      // Connected tools only: a web page comes in through its address (/api/fetch-url).
      const connectors = b.connectors.filter((id) => id !== "web");
      if (!connectors.length) return jsonError(400, "no_connector", "Pick a connected tool to import from.");
      return streamResearch({ purpose: "import", task: importTask(b), connectors });
    }
  }
}
