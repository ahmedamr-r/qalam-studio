/**
 * How a design system travels to the server for prompts: the flattened role tokens plus its docs.
 * Systems live in the browser (localStorage), so the client sends them with each request; the
 * built-in one is sent by id only so its prompt stays byte-identical and cached.
 */
import { z } from "zod";
import { BUILTIN_ID, type DesignSystem } from "@/design-system/registry";
import { TokenSet, isRolePath, type Token } from "@/design-system/resolve";
import type { DesignDocs } from "@/design-system/docs";
import { isStylePath } from "@/design-system/styles";
import { systemFacts, wrapSystemBlock, type FactOptions } from "@/knowledge/facts";

export interface SystemPayload {
  id: string;
  name?: string;
  tokens?: { path: string; type: string; value: string }[];
  docs?: DesignDocs;
  /** Colour roles the extraction inferred rather than saw in the screenshots. */
  inferred?: string[];
  /** Fact keys the designer told Qalam AI to forget (left out) or always keep (sent first, past any limit). */
  knowledge?: { exclude?: string[]; pin?: string[] };
}

const valueText = (t: Token): string => {
  if (typeof t.value === "string" || typeof t.value === "number") return String(t.value);
  return JSON.stringify(t.value);
};

export function systemPayload(ds: DesignSystem): SystemPayload {
  if (ds.id === BUILTIN_ID) return { id: BUILTIN_ID };
  const ts = new TokenSet(ds.tree);
  // Roles, layout metrics and the component structure the studio draws (styles.ts).
  const tokens = ts.tokens
    .filter((t) => isRolePath(t.path) || t.path.startsWith("layout.") || isStylePath(t.path))
    .map((t) => ({ path: t.path, type: t.type, value: valueText(t).slice(0, 300) }));
  // Interview systems choose every colour (none are guesses about a product the model saw).
  const inferred = ds.source === "builtin" || ds.source === "interview" ? [] : ts.tokens.filter((t) => t.type === "color" && isRolePath(t.path) && /^Inferred/.test(t.description ?? "")).map((t) => t.path);
  return { id: ds.id, name: ds.name, tokens, docs: ds.docs, ...(inferred.length ? { inferred } : {}) };
}

const cap = (n: number) => z.string().max(n);
export const SystemPayloadSchema = z
  .object({
    id: cap(64),
    name: cap(80).optional(),
    tokens: z.array(z.object({ path: cap(100), type: cap(24), value: cap(300) })).max(400).optional(),
    docs: z.unknown().optional(),
    inferred: z.array(cap(100)).max(120).optional(),
    knowledge: z.object({ exclude: z.array(cap(160)).max(400).optional(), pin: z.array(cap(160)).max(200).optional() }).optional(),
  })
  .refine((p) => JSON.stringify(p.docs ?? null).length < 80_000, "Design system docs are too large.");

// ---------------------------------------------------------------------------
// Prompt text (server side): rendered from the system's facts (knowledge/facts.ts), so the ids the
// model cites are the ones the client records.

export { instOutline, tokenLines, tokensOf } from "@/knowledge/facts";

/** The per-system block of a prompt. Content extracted from screenshots is data, not instructions. */
export function systemBlock(name: string, docs: DesignDocs | undefined, tokens: { path: string; type: string; value: string }[], inferred: string[] = [], opts: FactOptions = {}): string {
  return wrapSystemBlock(systemFacts(name, docs, tokens, inferred, opts).body);
}
