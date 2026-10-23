import { nanoid } from "nanoid";
import { CATALOG } from "../components";
import { completeTree, isValid, setToken, validateTree } from "../contract";
import { contrastFailures, fixRecipeContrast, type ContrastFailure } from "../contrast";
import { emptyGuide, type DesignDocs, type DesignLanguage, type LayoutGuide } from "../docs";
import type { Platform } from "../platform";
import type { DesignSystem, FontRef } from "../registry";
import type { Tree } from "../resolve";
import { GENERATOR_VERSION, KNOB_SPECS, hueName, type Knobs, type ReadBack } from "./knobs";
import { DENSITY_SCALE, recipeEntries, USED_WEIGHTS } from "./recipes";
import { colourRoles, palette, primitives } from "./roles";
import { overrideEntries } from "./components";

/**
 * Knobs → a complete design system. The palette and every role, then the recipes, then the
 * contract's neutral defaults for anything left; component text is made legible on its fills,
 * and the result is validated. Same knobs, same tree, byte for byte.
 */

export interface Expansion {
  tree: Tree;
  notes: string[];
  /** Pairs still under their minimum after every fix (should be none). */
  failures: ContrastFailure[];
}

export function expandKnobs(k: Knobs, opts: { platform?: Platform } = {}): Expansion {
  const p = palette(k);
  const roles = colourRoles(k, p);
  const tree: Tree = { $extensions: { "qalam.interview": { knobs: k, generatorVersion: GENERATOR_VERSION } } };
  for (const [path, hex] of primitives(p)) setToken(tree, path, { $type: "color", $value: hex });
  for (const [role, v] of Object.entries(roles)) setToken(tree, role, { $type: "color", $value: v.ref ? `{${v.ref}}` : v.hex, $description: `Generated · ${v.note}` });
  setToken(tree, "gradient.brand", {
    $type: "gradient",
    $value: { kind: "linear", angle: 115, stops: [{ color: "{color.brand.11}", position: 0 }, { color: "{color.brand.9}", position: 1 }] },
  });
  for (const [path, node] of recipeEntries(k, { platform: opts.platform, ink: roles["text.primary"].hex, focus: roles["border.focus"].hex })) setToken(tree, path, node);
  // The designer's choices for single components, over the system's recipes.
  for (const [path, node] of overrideEntries(k)) setToken(tree, path, node);

  const notes: string[] = [];
  const done = completeTree(tree).tree;
  fixRecipeContrast(done, notes);
  const v = validateTree(done);
  if (!isValid(v)) throw new Error(`Generated system is incomplete: ${[...v.missing, ...v.wrongType, ...v.unresolved].slice(0, 5).join(", ")}`);
  return { tree: done, notes, failures: contrastFailures(done) };
}

/** What each knob says, for the docs and the Refine sentence. */
export function knobSentence(k: Knobs): string {
  const parts = [KNOB_SPECS.density.phrase(k.density), `${KNOB_SPECS.chroma.phrase(k.chroma)} in ${k.brandHex ? "your brand colour" : hueName(k.hue)}`, KNOB_SPECS.radius.phrase(k.radius), KNOB_SPECS.elevation.phrase(k.elevation), KNOB_SPECS.fill.phrase(k.fill)];
  return `${parts[0][0].toUpperCase()}${parts[0].slice(1)}, with ${parts.slice(1, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

function language(read: ReadBack, k: Knobs, name: string): DesignLanguage {
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  return {
    name,
    summary: read.summary,
    personality: read.adjectives,
    principles: read.language.principles,
    color: `${cap(KNOB_SPECS.chroma.phrase(k.chroma))} built on ${k.brandHex ? `the brand colour ${k.brandHex}` : `a ${hueName(k.hue)} hue`}, with ${KNOB_SPECS.neutralTint.phrase(k.neutralTint)} and ${KNOB_SPECS.contrast.phrase(k.contrast)}. Every text colour meets WCAG 2.2 AA on the surfaces it is used on.`,
    typography: `${k.font} at ${k.bodySize}px for body text${k.displayFont === "same" ? "" : `, ${k.displayFont} for headings`}, on ${KNOB_SPECS.typeRatio.phrase(k.typeRatio)}; ${k.arabicFont} for Arabic.`,
    shape: `${cap(KNOB_SPECS.radius.phrase(k.radius))}; ${KNOB_SPECS.fill.phrase(k.fill)}.`,
    depth: `${cap(KNOB_SPECS.elevation.phrase(k.elevation))}.`,
    density: `${cap(k.density)} spacing (${Math.round(DENSITY_SCALE[k.density] * 100)}% of the base scale).`,
    iconography: "Outlined icons at a consistent stroke, coloured with the icon roles.",
    imagery: "",
    voice: read.language.voice,
    dos: read.language.dos,
    donts: read.language.donts,
  };
}

function layout(read: ReadBack, k: Knobs): LayoutGuide {
  const s = DENSITY_SCALE[k.density];
  return {
    summary: `${read.platform === "mobile" ? "Mobile screens" : "Screens"} for ${read.audience || "the product's users"}.`,
    density: s < 0.97 ? "compact" : s > 1.02 ? "airy" : "regular",
    grid: read.platform === "mobile" ? "Single column with 16px gutters." : "A 12-column grid with 24px gutters.",
    rhythm: "Section gaps from the layout tokens; cards and lists use the space scale.",
    navigation: read.platform === "mobile" ? "TopBar for hierarchy, BottomNav for top-level destinations." : "A sidebar or top navigation for top-level destinations.",
    hierarchy: "One clear title, the primary content, then supporting detail; one primary action per screen.",
    templates: [],
    rules: [],
  };
}

export function interviewDocs(read: ReadBack, k: Knobs, name: string): DesignDocs {
  return { language: language(read, k, name), layout: layout(read, k), components: CATALOG.map((c) => emptyGuide(c.name, c.description)), patterns: [] };
}

export function systemFonts(k: Knobs): FontRef[] {
  const families = [...new Set([k.font, k.displayFont === "same" ? k.font : k.displayFont, k.arabicFont])];
  return families.map((family) => ({ family, googleFont: family, weights: [...USED_WEIGHTS] }));
}

/** The saved system: source "interview", tied to its project. */
export function designSystemFromInterview(d: { knobs: Knobs; read: ReadBack; name: string; projectId: string; platform?: Platform; id?: string; now?: number }): DesignSystem {
  const { tree, notes } = expandKnobs(d.knobs, { platform: d.platform ?? d.read.platform });
  const now = d.now ?? Date.now();
  return {
    id: d.id ?? `interview-${nanoid(8)}`,
    name: d.name,
    source: "interview",
    tree,
    docs: interviewDocs(d.read, d.knobs, d.name),
    fonts: systemFonts(d.knobs),
    notes,
    projectId: d.projectId,
    createdAt: now,
    updatedAt: now,
  };
}
