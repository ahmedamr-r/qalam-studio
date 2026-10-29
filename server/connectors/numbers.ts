import { insightHits, insightNumbers, posthogRead, posthogSearch, type InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { readSettings } from "../settings";
import { runTools } from "./claude-code";

/*
 * An outcome's number, read from a saved PostHog insight through the PostHog server the user's
 * Claude Code has (the tool-runner makes the two calls code planned; code reads the number from
 * PostHog's own answer).
 */

async function server(): Promise<string> {
  const via = (await readSettings()).connectors?.posthog;
  if (via?.via !== "claude-code") throw new Error("Use PostHog through Claude Code in Connections first.");
  return via.server;
}

export async function searchInsights(query: string): Promise<Hit[]> {
  const [answer] = await runTools(await server(), [posthogSearch(query)], undefined, "numbers");
  if (answer === null) throw new Error("PostHog didn't answer through Claude Code. Is it signed in there?");
  return insightHits(answer);
}

export async function readInsight(ref: string): Promise<InsightNumbers> {
  const [answer] = await runTools(await server(), [posthogRead(ref)], undefined, "numbers");
  if (answer === null) throw new Error("PostHog didn't run the insight through Claude Code.");
  return insightNumbers(answer);
}
