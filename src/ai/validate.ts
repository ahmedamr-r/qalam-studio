import { z } from "zod";

/*
 * An answer's JSON, checked against the call's schema (pure). Claude enforces a call's schema
 * itself; other engines may not (a local model, a provider that only takes a schema as a hint), so
 * their answer is read here: thinking taken out, the JSON object cut out of what's around it, and
 * checked. What doesn't hold comes back as a few problems in words, for one repair turn.
 */

const checkers = new WeakMap<object, z.ZodType>();
const MAX_PROBLEMS = 5;

/** The schema as a checker (made once per schema object). */
function checkerOf(schema: Record<string, unknown>): z.ZodType {
  let c = checkers.get(schema);
  if (!c) {
    c = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    checkers.set(schema, c);
  }
  return c;
}

/** The JSON object in a model's text: its thinking and any code fence taken out. Null: none, or not JSON. */
export function jsonIn(text: string): unknown {
  const bare = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const start = bare.indexOf("{");
  const end = bare.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(bare.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type Checked = { ok: true; data: unknown } | { ok: false; problems: string[] };

/** A model's text read as the call's answer: its JSON, valid against the schema, or what's wrong with it. */
export function checkAnswer(text: string, schema: Record<string, unknown>): Checked {
  const data = jsonIn(text);
  if (data === null) return { ok: false, problems: ["The answer wasn't a JSON object."] };
  const r = checkerOf(schema).safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, problems: r.error.issues.slice(0, MAX_PROBLEMS).map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`) };
}

/** The repair turn's words: what was wrong, and to answer again with only the JSON. */
export const repairPrompt = (problems: string[]) => `Your answer didn't match the schema:\n${problems.map((p) => `- ${p}`).join("\n")}\nAnswer again with only the corrected JSON object.`;
