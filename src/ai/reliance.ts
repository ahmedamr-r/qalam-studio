type JSONSchema = Record<string, unknown>;

/**
 * "Relied on": the facts an answer says it was shaped by. Every fact in a prompt carries a short
 * id in square brackets; the model lists the ones that mattered, with a sentence for the designer.
 * The client keeps only ids the request really sent (knowledge/trace.ts), so nothing is invented.
 * Shared by the routes, the client and tests (no server-only imports).
 */

export const MAX_RELIED = 8;

export const RELIED_ON_SCHEMA: JSONSchema = {
  type: "array",
  description: "Up to 8 ids of the facts given to you (in square brackets) that actually shaped this answer, most important first",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", description: "A fact's id as given, e.g. d12, b3, c2, r1" },
      why: { type: "string", description: "One plain sentence for the designer on how it shaped the answer" },
    },
    required: ["id", "why"],
  },
};

/** The schema with "reliedOn" added last (so screens stream before it). */
export function withReliance(schema: JSONSchema): JSONSchema {
  const props = (schema.properties ?? {}) as Record<string, JSONSchema>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return { ...schema, properties: { ...props, reliedOn: RELIED_ON_SCHEMA }, required: [...required.filter((r) => r !== "reliedOn"), "reliedOn"] };
}

/** Appended to the cached system prompts of the routes that report what they relied on. */
export const RELIANCE_NOTE = `Facts you are given carry ids in square brackets: [d12] a design-system rule, [b3] something the designer told you about the project, [q2] an answer from this critique, [c2] an earlier turn of this chat, [r1] web research, [p1] an earlier decision this one follows. In "reliedOn", list up to ${MAX_RELIED} ids of the facts that actually shaped this answer, most important first, each with one plain sentence for the designer on how it shaped it (for example "Kept a single pinned primary button"). Use only ids you were given, and an empty list when none mattered. Never write these ids anywhere else in your answer: not in screen copy, names, rules or summaries.`;

export interface RelianceItem {
  id: string;
  why: string;
}

// ---------------------------------------------------------------------------
// "Assumed": what the model had to guess because nobody told it (Generate). The Knowledge hub shows
// these under "It didn't know", each with a field for the designer's real answer.

export const MAX_ASSUMED = 4;
/** Brief topics a guess can be about (the brief's own topics: see doc/brief.ts). */
export const ASSUMED_TOPICS = ["goal", "audience", "problem", "first-notice", "primary-action", "success-metric", "constraints", "other"] as const;

export const ASSUMED_SCHEMA: JSONSchema = {
  type: "array",
  description: "Up to 4 things about the product or its users you had to guess because the brief and the designer didn't say",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string", enum: [...ASSUMED_TOPICS] },
      guess: { type: "string", description: "Your guess in one plain sentence, e.g. \"Regular riders who top up weekly\"" },
    },
    required: ["topic", "guess"],
  },
};

/** The schema with "assumed" added before "reliedOn" (both after the screens). */
export function withAssumptions(schema: JSONSchema): JSONSchema {
  const props = { ...((schema.properties ?? {}) as Record<string, JSONSchema>) };
  const relied = props.reliedOn;
  delete props.reliedOn;
  const required = (Array.isArray(schema.required) ? (schema.required as string[]) : []).filter((r) => r !== "assumed" && r !== "reliedOn");
  return { ...schema, properties: { ...props, assumed: ASSUMED_SCHEMA, ...(relied ? { reliedOn: relied } : {}) }, required: [...required, "assumed", ...(relied ? ["reliedOn"] : [])] };
}

export const ASSUMPTION_NOTE = `In "assumed", list up to ${MAX_ASSUMED} things about the product or its users that shaped these screens but that you had to guess, because neither the brief nor the project brief says them (who uses it, what the screen is for, what must be noticed first, the main action, what success looks like, constraints). One plain sentence each. Leave it empty when you were told everything that mattered.`;

export interface AssumedItem {
  topic: (typeof ASSUMED_TOPICS)[number];
  guess: string;
}
