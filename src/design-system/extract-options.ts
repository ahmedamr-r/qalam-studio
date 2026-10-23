import { CATALOG } from "./components";

/**
 * What the designer asks for before an extraction runs: how deep the tokens go, and which parts of
 * the written system (language, component guides, new components) Claude should produce. Shared by
 * the client (options form, sample replay) and the route (schemas and prompts per request).
 */

/** Screenshots of one product the designer can extract from at once. */
export const MAX_EXTRACT_IMAGES = 8;

export type Depth = "essentials" | "standard" | "complete";
export type PatternMode = "none" | "suggest" | "listed";

export interface ExtractOptions {
  depth: Depth;
  /** false = tokens only (a single pass). */
  docs: boolean;
  /** Design language and layout orchestration. */
  language: boolean;
  /** Catalog components to write a design.md guide for. */
  components: string[];
  /** New components: none, Claude suggests distinctive ones, or the designer names them. */
  patterns: PatternMode;
  /** Components to create from scratch when `patterns` is "listed". */
  patternNames: string[];
  /** Catalog components the first look saw in the screenshots ([] = no first look). */
  observed: string[];
  /** Style every catalog component ("all"), or only `components`; the rest keep the default recipes. */
  recipes: RecipeScope;
  /** The designer's answers to Qalam AI's questions (and their note), passed to both passes. */
  notes: DesignerNote[];
}

export type RecipeScope = "all" | "chosen";
export interface DesignerNote {
  question: string;
  answer: string;
}

/** Foundation groups the first pass fills, per depth. Anything left out gets neutral defaults. */
export type FoundationGroup = "colors" | "type" | "radius" | "space" | "size" | "borderWidth" | "shadows" | "gradients" | "layout" | "components";

const ESSENTIALS: FoundationGroup[] = ["colors", "type", "radius", "space", "size"];
const STANDARD: FoundationGroup[] = [...ESSENTIALS, "borderWidth", "shadows", "gradients", "layout"];
export const DEPTH_GROUPS: Record<Depth, FoundationGroup[]> = { essentials: ESSENTIALS, standard: STANDARD, complete: [...STANDARD, "components"] };

export const DEPTHS: { value: Depth; label: string; description: string }[] = [
  { value: "essentials", label: "Essentials", description: "Colour roles and palette, fonts and the type scale, radii, spacing. The fastest pass; components keep default styling, apart from the button, field, card and chip shapes the studio measures in the pixels." },
  { value: "standard", label: "Standard", description: "Adds border widths, drop and inner shadows layer by layer, gradients, and section gaps. Components keep default styling, apart from the shapes the studio measures." },
  { value: "complete", label: "Complete", description: "Adds how every component is styled: button shape and height, card borders vs shadows, input and chip styles." },
];

export const MAX_PATTERNS = 6;
export const MAX_NOTES = 4;
export const ALL_COMPONENTS = CATALOG.map((c) => c.name);

export const DEFAULT_OPTIONS: ExtractOptions = {
  depth: "complete",
  docs: true,
  language: true,
  components: ALL_COMPONENTS,
  patterns: "suggest",
  patternNames: [],
  observed: [],
  recipes: "all",
  notes: [],
};

/** Clean up options from storage or a request body. */
export function normalizeOptions(o: Partial<ExtractOptions> | undefined): ExtractOptions {
  const d = DEFAULT_OPTIONS;
  const depth = o?.depth === "essentials" || o?.depth === "standard" || o?.depth === "complete" ? o.depth : d.depth;
  const patterns = o?.patterns === "none" || o?.patterns === "suggest" || o?.patterns === "listed" ? o.patterns : d.patterns;
  const names = [...new Set((Array.isArray(o?.patternNames) ? o.patternNames : []).map((n) => String(n).trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_PATTERNS);
  const clip = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  const notes = (Array.isArray(o?.notes) ? o.notes : [])
    .map((n) => ({ question: clip(n?.question), answer: clip(n?.answer) }))
    .filter((n) => n.answer)
    .slice(0, MAX_NOTES);
  return {
    depth,
    docs: typeof o?.docs === "boolean" ? o.docs : d.docs,
    language: typeof o?.language === "boolean" ? o.language : d.language,
    components: Array.isArray(o?.components) ? ALL_COMPONENTS.filter((c) => o.components!.includes(c)) : d.components,
    patterns: patterns === "listed" && !names.length ? "none" : patterns,
    patternNames: names,
    observed: Array.isArray(o?.observed) ? ALL_COMPONENTS.filter((c) => o.observed!.includes(c)) : d.observed,
    recipes: o?.recipes === "chosen" ? "chosen" : "all",
    notes,
  };
}

/** The designer's answers, as prompt lines. */
function noteLines(o: ExtractOptions): string[] {
  if (!o.notes.length) return [];
  return [
    "The designer answered these questions about the screenshots; follow the answers where they settle something the pixels leave open:",
    ...o.notes.map((n) => (n.question ? `- ${n.question} → ${n.answer}` : `- ${n.answer}`)),
  ];
}

/** Per-request instructions for the first pass (the system prompt stays cached per depth). */
export function foundationsInstructions(o: ExtractOptions): string {
  const lines: string[] = [];
  if (o.observed.length) lines.push(`A first look found these catalog components in the screenshots: ${o.observed.join(", ")}.`);
  if (DEPTH_GROUPS[o.depth].includes("components") && o.recipes === "chosen") {
    const unseen = o.components.filter((c) => !o.observed.includes(c));
    lines.push(
      o.components.length
        ? `Style the recipes of these components only: ${o.components.join(", ")}.${unseen.length ? ` ${unseen.join(", ")} ${unseen.length > 1 ? "aren't" : "isn't"} in the screenshots: design ${unseen.length > 1 ? "them" : "it"} to match the visual language (and set visible: false for ${unseen.length > 1 ? "them" : "it"} in structure).` : ""} For every other recipe return the built-in reference value unchanged.`
        : "Return the built-in reference value for every recipe: the designer asked for tokens only.",
    );
  }
  lines.push(...noteLines(o));
  return lines.join("\n");
}

/** Does the written-system pass have anything to do? */
export const wantsGuide = (o: ExtractOptions) => o.docs && (o.language || o.components.length > 0 || o.patterns !== "none");

/** Per-request instructions for the second pass (the system prompt stays cached). */
export function guideInstructions(o: ExtractOptions): string {
  const lines: string[] = ["Write only the sections the response schema asks for."];
  lines.push("The component.*.style.* values are this system's component structure (how the tab bar, top bar, tabs, list rows and tiles are built), measured from the screenshots: write each guide's anatomy to match them.");
  if (!DEPTH_GROUPS[o.depth].includes("components"))
    lines.push("Component styling wasn't extracted at this depth, so the component.* values below are defaults, not observations. Describe components (shape, height, borders, shadows) as the screenshot shows them.");
  if (!o.language) lines.push("The designer skipped the design language and layout orchestration.");
  if (o.components.length && o.components.length < ALL_COMPONENTS.length) lines.push(`Write guides only for these catalog components: ${o.components.join(", ")}.`);
  if (!o.components.length) lines.push("The designer skipped the catalog component guides.");
  if (o.components.length && o.observed.length) {
    const seen = o.components.filter((c) => o.observed.includes(c));
    const unseen = o.components.filter((c) => !o.observed.includes(c));
    if (seen.length) lines.push(`A first look saw ${seen.join(", ")} in the screenshots: mark ${seen.length > 1 ? "those" : "it"} observed.`);
    if (unseen.length) lines.push(`${unseen.join(", ")} ${unseen.length > 1 ? "aren't" : "isn't"} in the screenshots: design ${unseen.length > 1 ? "them" : "it"} to match this system's language and mark ${unseen.length > 1 ? "them" : "it"} inferred.`);
  }
  if (o.patterns === "suggest") lines.push("Create 0–5 niche components you can see in the screenshot that aren't a single catalog component.");
  if (o.patterns === "listed")
    lines.push(
      `Create exactly these components from scratch, one entry each, in this order: ${o.patternNames.map((n) => `"${n}"`).join(", ")}. Compose each only from catalog components. Base it on the screenshot where you can see it (observed); otherwise design it in this system's language (inferred).`,
    );
  lines.push(...noteLines(o));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Replaying a recorded extraction (the bundled sample) with the chosen options.

export function trimFoundations<T extends Record<string, unknown>>(f: T, depth: Depth): T {
  const keep = new Set<string>(DEPTH_GROUPS[depth]);
  const all: FoundationGroup[] = DEPTH_GROUPS.complete;
  const out: Record<string, unknown> = { ...f };
  for (const g of all) if (!keep.has(g)) delete out[g];
  delete out.componentNotes;
  return out as T;
}

export function trimGuide<T extends { language?: unknown; layout?: unknown; components?: { component: string }[]; patterns?: unknown[] }>(g: T, o: ExtractOptions): T {
  const out = { ...g };
  if (!o.language) {
    delete out.language;
    delete out.layout;
  }
  out.components = (g.components ?? []).filter((c) => o.components.includes(c.component));
  if (o.patterns === "none") out.patterns = [];
  // Named components: keep the recorded ones whose names match.
  if (o.patterns === "listed") out.patterns = (g.patterns ?? []).filter((p) => o.patternNames.some((n) => sameName(n, patternName(p))));
  return out;
}

const patternName = (p: unknown) => String((p as { name?: unknown })?.name ?? "");
/** "Balance hero card" and "BalanceHeroCard" are the same component. */
export const sameName = (a: string, b: string) => {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!k(a) && k(a) === k(b);
};

/** Human summary of what a run will do, for the options form. */
export function describeRun(o: ExtractOptions, sample = false): string {
  const passes = wantsGuide(o) ? "two passes" : "one pass";
  const parts = [`${DEPTHS.find((d) => d.value === o.depth)!.label} tokens`];
  if (wantsGuide(o)) {
    if (o.language) parts.push("design language and layout");
    if (o.components.length) parts.push(`${o.components.length} component guide${o.components.length > 1 ? "s" : ""}`);
    if (o.patterns === "suggest") parts.push("new components it finds");
    if (o.patterns === "listed") parts.push(`${o.patternNames.length} new component${o.patternNames.length > 1 ? "s" : ""}`);
  }
  if (DEPTH_GROUPS[o.depth].includes("components") && o.recipes === "chosen") parts.splice(1, 0, o.components.length ? `styling for ${o.components.length} component${o.components.length > 1 ? "s" : ""}` : "default component styling");
  return `Qalam AI runs ${passes}: ${parts.join(", ")}${sample ? "" : ", then rebuilds the screenshot with the result so you can compare them"}.`;
}
