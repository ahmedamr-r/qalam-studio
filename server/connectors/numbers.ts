import { fitCall, NUMBER_RECIPES, readEventRef, toolOn, type FittedCall, type NumbersRecipe, type ToolSchemas } from "@/connectors/analytics";
import { connectorDef } from "@/connectors/catalog";
import { readOnly } from "@/connectors/everywhere";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit, ToolCall } from "@/connectors/recipes";
import { readSettings } from "../settings";
import { runTools } from "./claude-code";
import { SignInAgain, withSignedIn } from "./oauth";

/*
 * A number from a saved chart in an analytics tool, through Qalam's own sign-in to its MCP server or
 * the server the user's Claude Code has. Code plans the calls and reads the number from the tool's
 * own answer. A tool that names a project is asked which first, in the same session.
 */

type Ask = (call: FittedCall) => Promise<string | null>;
/** Several calls in one go: one session on Qalam's sign-in, one run through Claude Code. Each answer, or null. */
type AskMany = (calls: FittedCall[]) => Promise<(string | null)[]>;

/** Qalam only reads: a call that isn't one of the tool's read tools is refused before it's made (src/connectors/everywhere.ts). */
function checked(id: string, c: ToolCall): ToolCall {
  if (!readOnly(id, c)) throw new Error(`Qalam only reads from ${connectorDef(id)?.label ?? id}, so it won't call ${c.tool}.`);
  return c;
}

async function onTool<T>(id: string, fn: (recipe: NumbersRecipe, ask: Ask, project: string | undefined, many: AskMany) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const recipe = NUMBER_RECIPES[id];
  const label = connectorDef(id)?.label ?? id;
  const via = (await readSettings()).connectors?.[id];
  if (!recipe) throw new Error(`Qalam can't read numbers from ${label}.`);
  const go = async (ask: Ask, many: AskMany) => fn(recipe, ask, recipe.project ? (recipe.project.read((await ask(recipe.project.call)) ?? "") ?? undefined) : undefined, many);
  if (via?.via === "oauth")
    return withSignedIn(id, via.url, async (call, schemas) => {
      const known = await schemas();
      const ask: Ask = (c) => {
        // What a tool offers isn't published for all of them: say what's there rather than call what isn't.
        if (!c.like && c.tool !== "exec" && !toolOn(c, known)) return Promise.resolve(null);
        if (c.like && !toolOn(c, known)) throw new Error(`${label} has no tool for this that Qalam knows. It offers: ${Object.keys(known).join(", ") || "nothing"}.`);
        return call(checked(id, fitCall(c, known)));
      };
      return go(ask, async (calls) => {
        const out: (string | null)[] = [];
        for (const c of calls) {
          if (signal?.aborted) break;
          // A call that fails is noted; a sign-in the service stopped taking ends it.
          out.push(await Promise.resolve()
            .then(() => ask(c))
            .catch((e: unknown) => (e instanceof SignInAgain ? Promise.reject(e) : null)));
        }
        return out;
      });
    });
  if (via?.via === "claude-code") return go(async (c) => (await runTools(via.server, [checked(id, fitCall(c))], signal, "numbers"))[0], (calls) => runTools(via.server, calls.map((c) => checked(id, fitCall(c))), signal, "numbers"));
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

/** Several searches for saved charts in one go, for a look across every tool: each search's charts, or why it failed. */
export const searchInsightsMany = (id: string, queries: readonly string[], signal?: AbortSignal): Promise<(Hit[] | Error)[]> =>
  onTool(
    id,
    async (recipe, _ask, project, many) =>
      (await many(queries.map((q) => recipe.search(q, project)))).map((a) => {
        if (a === null) return new Error(`${connectorDef(id)?.label ?? id} didn't answer. Is it still signed in?`);
        try {
          return recipe.hits(a);
        } catch (e) {
          return e instanceof Error ? e : new Error(String(e));
        }
      }),
    signal,
  );

/** Several saved charts' numbers in one go (null: it didn't read, or has no number to read). */
export const readInsightsMany = (id: string, refs: readonly string[], signal?: AbortSignal): Promise<(InsightNumbers | null)[]> =>
  onTool(
    id,
    async (recipe, _ask, project, many) =>
      (await many(refs.map((r) => recipe.read(r, project)))).map((a) => {
        if (a === null) return null;
        try {
          return recipe.numbers(a);
        } catch {
          return null;
        }
      }),
    signal,
  );

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
