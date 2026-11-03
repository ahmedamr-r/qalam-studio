import { fitCall, NUMBER_RECIPES, readEventRef, toolOn, type FittedCall, type NumbersRecipe, type ToolSchemas } from "@/connectors/analytics";
import { connectorDef } from "@/connectors/catalog";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { readSettings } from "../settings";
import { runTools } from "./claude-code";
import { withSignedIn } from "./oauth";

/*
 * A number from a saved chart in an analytics tool, through Qalam's own sign-in to its MCP server or
 * the server the user's Claude Code has. Code plans the calls and reads the number from the tool's
 * own answer. A tool that names a project is asked which first, in the same session.
 */

type Ask = (call: FittedCall) => Promise<string | null>;

async function onTool<T>(id: string, fn: (recipe: NumbersRecipe, ask: Ask, project: string | undefined) => Promise<T>): Promise<T> {
  const recipe = NUMBER_RECIPES[id];
  const label = connectorDef(id)?.label ?? id;
  const via = (await readSettings()).connectors?.[id];
  if (!recipe) throw new Error(`Qalam can't read numbers from ${label}.`);
  const go = async (ask: Ask) => fn(recipe, ask, recipe.project ? (recipe.project.read((await ask(recipe.project.call)) ?? "") ?? undefined) : undefined);
  if (via?.via === "oauth")
    return withSignedIn(id, via.url, async (call, schemas) => {
      const known = await schemas();
      return go((c) => {
        // What a tool offers isn't published for all of them: say what's there rather than call what isn't.
        if (!c.like && c.tool !== "exec" && !toolOn(c, known)) return Promise.resolve(null);
        if (c.like && !toolOn(c, known)) throw new Error(`${label} has no tool for this that Qalam knows. It offers: ${Object.keys(known).join(", ") || "nothing"}.`);
        return call(fitCall(c, known));
      });
    });
  if (via?.via === "claude-code") return go(async (c) => (await runTools(via.server, [fitCall(c)], undefined, "numbers"))[0]);
  throw new Error(`Connect ${label} in Connections first.`);
}

/** What a signed-in tool offers, as its server lists it: names and arguments, for finding out what a recipe should call. */
export async function toolsOffered(id: string): Promise<ToolSchemas> {
  const via = (await readSettings()).connectors?.[id];
  if (via?.via !== "oauth") throw new Error(`Sign in to ${connectorDef(id)?.label ?? id} in Connections first.`);
  return withSignedIn(id, via.url, (_call, schemas) => schemas());
}

export const searchInsights = (id: string, query: string): Promise<Hit[]> =>
  onTool(id, async (recipe, ask, project) => {
    const answer = await ask(recipe.search(query, project));
    if (answer === null) throw new Error(`${connectorDef(id)?.label ?? id} didn't answer. Is it still signed in?`);
    return recipe.hits(answer);
  });

/** A tool's events, for an account with no saved chart that fits. */
export async function searchEvents(id: string, query: string): Promise<Hit[]> {
  if (!NUMBER_RECIPES[id]?.events) return [];
  return onTool(id, async (recipe, ask) => {
    const events = recipe.events!;
    const places = events.places ? events.places.read((await ask(events.places.call)) ?? "") : {};
    const answer = await ask(events.search(query));
    if (answer === null) throw new Error(`${connectorDef(id)?.label ?? id} didn't answer. Is it still signed in?`);
    return events.hits(answer, { places, query });
  });
}

export const readInsight = (id: string, ref: string): Promise<InsightNumbers> =>
  onTool(id, async (recipe, ask, project) => {
    const counted = readEventRef(ref);
    if (counted) {
      if (!recipe.events) throw new Error(`Qalam can't count ${connectorDef(id)?.label ?? id}'s events yet.`);
      const answer = await ask(recipe.events.count(counted));
      if (answer === null) throw new Error(`${connectorDef(id)?.label ?? id} didn't count it.`);
      return recipe.events.numbers(answer, counted);
    }
    const answer = await ask(recipe.read(ref, project));
    if (answer === null) throw new Error(`${connectorDef(id)?.label ?? id} didn't read it.`);
    return recipe.numbers(answer);
  });
