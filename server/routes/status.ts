import { MODEL, aiConfigured, backend } from "@/ai/server";
import { listConnectors } from "@/ai/connectors";
import { claudeState } from "../claude";

export async function GET() {
  // With Claude Code as the engine, say whether it's there and signed in, so the app can say what to do first.
  const b = backend();
  const claude = b === "cli" ? await claudeState() : undefined;
  return Response.json({ ai: aiConfigured(), model: MODEL, backend: b, hosted: !!process.env.VERCEL, connectors: aiConfigured() ? listConnectors(b) : [], claude });
}
