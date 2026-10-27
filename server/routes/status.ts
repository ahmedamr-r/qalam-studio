import { BACKEND, MODEL, aiConfigured } from "@/ai/server";
import { listConnectors } from "@/ai/connectors";
import { claudeState } from "../claude";

export async function GET() {
  // With the CLI backend, say whether Claude Code is there and signed in, so the app can say what to do first.
  const claude = BACKEND === "cli" ? await claudeState() : undefined;
  return Response.json({ ai: aiConfigured(), model: MODEL, backend: BACKEND, hosted: !!process.env.VERCEL, connectors: aiConfigured() ? listConnectors(BACKEND) : [], claude });
}
