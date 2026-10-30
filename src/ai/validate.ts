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

type Schema = Record<string, unknown>;
const isObject = (x: unknown): x is Schema => !!x && typeof x === "object" && !Array.isArray(x);

/** A field that may also be null (strict mode's way of leaving it out). */
function nullable(s: unknown): unknown {
  if (!isObject(s)) return s;
  const withNull = Array.isArray(s.enum) && !s.enum.includes(null) ? { enum: [...s.enum, null] } : {};
  if (Array.isArray(s.anyOf)) return { ...s, anyOf: [...s.anyOf, { type: "null" }] };
  if (typeof s.type === "string") return { ...s, type: [s.type, "null"], ...withNull };
  if (Array.isArray(s.type)) return s.type.includes("null") ? s : { ...s, type: [...s.type, "null"], ...withNull };
  return { anyOf: [s, { type: "null" }] };
}

function strict(s: unknown): unknown {
  if (!isObject(s)) return s;
  const out: Schema = { ...s };
  if (isObject(s.properties)) {
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, required.has(k) ? strict(v) : nullable(strict(v))]));
    out.required = Object.keys(s.properties);
    out.additionalProperties = false;
  }
  if (s.items) out.items = strict(s.items);
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[k])) out[k] = (s[k] as unknown[]).map(strict);
  if (isObject(s.$defs)) out.$defs = Object.fromEntries(Object.entries(s.$defs).map(([k, v]) => [k, strict(v)]));
  return out;
}

const stricts = new WeakMap<object, Schema>();

/**
 * The schema as OpenAI's strict mode takes it (OpenAI's json_schema, Codex's output schema): every
 * property required, one that was optional may be null instead, and no other properties. The
 * answer's nulls in those places are taken out again before it's checked (`withoutNulls`).
 */
export function strictSchema(schema: Schema): Schema {
  let s = stricts.get(schema);
  if (!s) stricts.set(schema, (s = strict(schema) as Schema));
  return s;
}

/** An answer with the nulls in optional fields taken out (they stand for "left out"). */
export function withoutNulls(value: unknown, schema: unknown): unknown {
  const s = isObject(schema) ? schema : {};
  const branch = Array.isArray(s.anyOf) ? (s.anyOf as unknown[]).find((b) => isObject(b) && (Array.isArray(value) ? !!b.items : isObject(value) && !!b.properties)) : null;
  if (branch) return withoutNulls(value, branch);
  if (Array.isArray(value)) return value.map((v) => withoutNulls(v, s.items));
  if (!isObject(value)) return value;
  const props = isObject(s.properties) ? s.properties : {};
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => v !== null || required.has(k))
      .map(([k, v]) => [k, withoutNulls(v, props[k])]),
  );
}

export type Checked = { ok: true; data: unknown } | { ok: false; problems: string[] };

/** A model's text read as the call's answer: its JSON (nulls in optional fields taken out), valid against the schema, or what's wrong with it. */
export function checkAnswer(text: string, schema: Record<string, unknown>): Checked {
  const found = jsonIn(text);
  if (found === null) return { ok: false, problems: ["The answer wasn't a JSON object."] };
  const data = withoutNulls(found, schema);
  const r = checkerOf(schema).safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, problems: r.error.issues.slice(0, MAX_PROBLEMS).map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`) };
}

/** The repair turn's words: what was wrong, and to answer again with only the JSON. */
export const repairPrompt = (problems: string[]) => `Your answer didn't match the schema:\n${problems.map((p) => `- ${p}`).join("\n")}\nAnswer again with only the corrected JSON object.`;
