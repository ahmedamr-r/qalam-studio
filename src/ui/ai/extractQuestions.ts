import type { ScanFetch, ScanResult } from "@/ai/ds-schemas";
import { CATALOG } from "@/design-system/components";
import { SCAN_COMPONENTS } from "@/design-system/scan";
import { ALL_COMPONENTS, MAX_PATTERNS, normalizeOptions, type Depth, type DesignerNote, type ExtractOptions } from "@/design-system/extract-options";
import { OTHER, answerOf, resolvedAnswers, type Answers, type MultiGroup, type Question, type SingleQuestion } from "./questionFlow";
import type { ExtractOutcome } from "./extract";

/**
 * What Qalam AI asks before extracting a design system, built from its first look at the
 * screenshots, and how the answers become extraction options. Pure (tested).
 */

export const CATEGORY_LABEL: Record<string, string> = {
  navigation: "Navigation",
  input: "Inputs & actions",
  content: "Content",
  feedback: "Feedback",
  layout: "Layout",
  commerce: "Commerce",
};

/** Settings on the review step. null = follows the first answer. */
export interface ExtractAdvanced {
  depth: Depth | null;
  language: boolean | null;
  /** Rebuild the first screenshot with the draft (the fidelity check). */
  rebuild: boolean;
}
export const DEFAULT_ADVANCED: ExtractAdvanced = { depth: null, language: null, rebuild: true };

/** Values in the "New components" group: candidates the first look found, and "find them for me". */
export const NEW_PREFIX = "new:";
export const SUGGEST = "new:*suggest";

const FETCH_IDS: ScanFetch[] = ["tokens", "components", "extended"];
const listNames = (names: string[], n = 4) => (names.length > n ? `${names.slice(0, n).join(", ")} and ${names.length - n} more` : names.join(", "));

/** Catalog components the first look didn't see, in catalog category order. */
function unseen(scan: ScanResult | null): string[] {
  const seen = new Set(scan?.components.map((c) => c.name) ?? []);
  const order = Object.keys(CATEGORY_LABEL);
  return CATALOG.filter((c) => SCAN_COMPONENTS.includes(c.name) && !seen.has(c.name))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .map((c) => c.name);
}

function fetchQuestion(scan: ScanResult | null): SingleQuestion {
  const seen = scan?.components.map((c) => c.name) ?? [];
  const extras = unseen(scan).length;
  return {
    id: "fetch",
    kind: "single",
    title: "What should I extract?",
    why: scan?.recommendation.why || undefined,
    recommended: scan ? scan.recommendation.fetch : "components",
    options: [
      { value: "tokens", label: "Tokens only", description: "Colours, type, radii, spacing, shadows. Components keep the default styling, resolved with your colours." },
      {
        value: "components",
        label: "Tokens + the components you use",
        description: seen.length ? `Also styles and documents the ${seen.length} component${seen.length > 1 ? "s" : ""} in your screens: ${listNames(seen)}.` : "Also styles and documents the catalog components you pick next.",
      },
      {
        value: "extended",
        label: "Tokens + your components + extras to match",
        description: `Also designs ${seen.length ? `the other ${extras}` : "the"} catalog components in your style, so screens that need them still look like this product.`,
      },
    ],
  };
}

function componentsQuestion(scan: ScanResult | null, fetch: ScanFetch): Question {
  const extras = unseen(scan);
  const byName = new Map(CATALOG.map((c) => [c.name, c]));
  const groups: MultiGroup[] = [];
  if (scan?.components.length)
    groups.push({
      id: "seen",
      label: "In your screens",
      options: scan.components.map((c) => ({ value: c.name, label: c.name, badge: `×${c.count}`, description: c.evidence || undefined })),
    });
  groups.push({
    id: "extra",
    label: scan?.components.length ? "Designed to match" : "Catalog components",
    hint: scan?.components.length ? "Not in your screenshots: Qalam AI designs them in this system's style." : "Pick the ones your product uses; the others keep the default styling.",
    options: extras.map((n) => ({ value: n, label: n, description: byName.get(n)?.description })),
  });
  const candidates = scan?.candidates ?? [];
  groups.push({
    id: "new",
    label: "New components",
    hint: "Product-specific pieces, built from catalog components.",
    options: [
      ...candidates.map((c) => ({ value: `${NEW_PREFIX}${c.name}`, label: c.name, description: c.description })),
      ...(scan ? [] : [{ value: SUGGEST, label: "Let Qalam AI find them", description: "Up to 5 distinctive elements it can see that aren't a single catalog component." }]),
    ],
    max: MAX_PATTERNS,
    custom: { placeholder: "Name one, e.g. Balance card" },
  });
  const seen = scan?.components.map((c) => c.name) ?? [];
  return {
    id: "components",
    kind: "multi",
    title: fetch === "extended" ? "Which components should I style, document and design?" : "Which components should I style and document?",
    why: seen.length ? "The ones I saw are ticked. Untick any you don't need, or add more." : "I couldn't see the screens, so pick the components your product uses.",
    dependsOn: ["fetch"],
    min: 1,
    groups,
    default: {
      values: [...seen, ...(fetch === "extended" ? extras : []), ...candidates.slice(0, MAX_PATTERNS).map((c) => `${NEW_PREFIX}${c.name}`)],
    },
  };
}

/** The first answer, with its recommendation filled in. */
export function fetchOf(scan: ScanResult | null, answers: Answers): ScanFetch {
  const a = answerOf(fetchQuestion(scan), answers);
  return a.kind === "single" && FETCH_IDS.includes(a.value as ScanFetch) ? (a.value as ScanFetch) : "components";
}

/** The questions, given the answers so far: what to extract, which components, then Qalam AI's own. */
export function extractQuestions(scan: ScanResult | null, answers: Answers): Question[] {
  const fetch = fetchOf(scan, answers);
  const qs: Question[] = [fetchQuestion(scan)];
  if (fetch !== "tokens") qs.push(componentsQuestion(scan, fetch));
  for (const q of scan?.questions ?? [])
    qs.push({
      id: q.id,
      kind: "single",
      source: "ai",
      optional: true,
      title: q.text,
      why: q.why || undefined,
      recommended: q.recommended || undefined,
      options: q.options.map((o) => ({ value: o, label: o })),
      other: { label: "Other…", placeholder: "Your answer" },
    });
  return qs;
}

/** Depth and docs when the designer leaves them to the first answer. */
export function advancedFor(fetch: ScanFetch, a: ExtractAdvanced): { depth: Depth; language: boolean } {
  return { depth: a.depth ?? (fetch === "tokens" ? "standard" : "complete"), language: a.language ?? fetch !== "tokens" };
}

/** The designer's answers as extraction options. */
export function optionsFromAnswers(scan: ScanResult | null, answers: Answers, advanced: ExtractAdvanced = DEFAULT_ADVANCED, note = ""): ExtractOptions {
  const qs = extractQuestions(scan, answers);
  const res = resolvedAnswers(qs, answers);
  const fetch = fetchOf(scan, res);
  const pick = fetch !== "tokens" && res.components?.kind === "multi" ? res.components : { values: [] as string[], custom: [] as string[] };
  const components = ALL_COMPONENTS.filter((c) => pick.values.includes(c));
  const named = pick.values.filter((v) => v.startsWith(NEW_PREFIX) && v !== SUGGEST).map((v) => v.slice(NEW_PREFIX.length));
  const patternNames = [...named, ...pick.custom].slice(0, MAX_PATTERNS);
  const patterns = patternNames.length ? "listed" : pick.values.includes(SUGGEST) ? "suggest" : "none";
  const { depth, language } = advancedFor(fetch, advanced);
  const notes: DesignerNote[] = [];
  if (note.trim()) notes.push({ question: "Designer's note", answer: note.trim() });
  for (const q of scan?.questions ?? []) {
    const a = res[q.id];
    if (a?.kind !== "single" || !a.value) continue;
    const answer = a.value === OTHER ? (a.other ?? "").trim() : a.value;
    if (answer) notes.push({ question: q.text, answer });
  }
  return normalizeOptions({
    depth,
    language,
    docs: language || components.length > 0 || patterns !== "none",
    components,
    patterns,
    patternNames,
    observed: scan?.components.map((c) => c.name) ?? [],
    recipes: "chosen",
    notes,
  });
}

/** What the draft will cover, e.g. "11 components: 8 seen, 3 designed to match · 2 new". */
export function coverage(o: ExtractOptions): { seen: number; designed: number; created: number | "suggest"; line: string } {
  const seen = o.components.filter((c) => o.observed.includes(c)).length;
  const designed = o.components.length - seen;
  const created = o.patterns === "suggest" ? "suggest" : o.patterns === "listed" ? o.patternNames.length : 0;
  const parts: string[] = [];
  if (o.components.length) {
    const split = o.observed.length ? [seen && `${seen} seen`, designed && `${designed} designed to match`].filter(Boolean).join(", ") : "";
    parts.push(`${o.components.length} component${o.components.length > 1 ? "s" : ""} styled${split ? ` (${split})` : ""}`);
  } else parts.push("Tokens only");
  if (created === "suggest") parts.push("new components it finds");
  else if (created) parts.push(`${created} new`);
  const rest = ALL_COMPONENTS.length - 2 - o.components.length;
  if (rest > 0) parts.push("the rest keep the default styling");
  return { seen, designed, created, line: parts.join(" · ") };
}

/** The turn in a few lines, for the chat context later requests see. */
export function extractSummary(o: ExtractOutcome): string[] {
  const lines: string[] = [];
  const s = o.scan;
  if (s) {
    lines.push(`First look: ${s.product || "the product"} (${s.platform}). ${s.look}`.trim());
    if (s.components.length) lines.push(`Components seen: ${s.components.map((c) => `${c.name} ×${c.count}`).join(", ")}`);
    if (s.candidates.length) lines.push(`Distinctive elements: ${s.candidates.map((c) => c.name).join(", ")}`);
  } else if (o.scanError) lines.push("The first look failed; the designer picked from the whole catalog.");
  if (o.phase === "asking" || o.phase === "scanning") {
    lines.push("Waiting for the designer's answers before extracting.");
    return lines;
  }
  if (o.options) {
    lines.push(`Asked for: ${o.options.depth} tokens · ${coverage(o.options).line}`);
    const answers = o.options.notes.filter((n) => n.question !== "Designer's note");
    if (answers.length) lines.push(`The designer's answers: ${answers.map((n) => `${n.question} → ${n.answer}`).join("; ")}`);
  }
  if (o.phase === "draft" && o.draft) lines.push(`Draft "${o.draft.name}" is ready for review; not saved yet.`);
  if (o.phase === "saved" && o.saved) lines.push(`Saved as the design system "${o.saved.name}" and made active.`);
  if (o.phase === "discarded") lines.push("The designer discarded the draft.");
  return lines;
}
