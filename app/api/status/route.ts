import { BACKEND, MODEL, aiConfigured } from "@/ai/server";
import { listConnectors } from "@/ai/connectors";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ai: aiConfigured(), model: MODEL, backend: BACKEND, hosted: !!process.env.VERCEL, connectors: aiConfigured() ? listConnectors(BACKEND) : [] });
}
