/**
 * Structured-output schemas for extracting a design system from screenshots (two passes) and for
 * restyling screens. Generated from the role contract so the model fills exactly the paths the
 * builders use. No numeric/length keywords: structured outputs don't support them, the converter
 * clamps instead.
 */
import { ROLE_SPECS } from "@/design-system/contract";
import { COMPONENT_NAMES } from "@/design-system/components";
import { BUILTIN, isRolePath } from "@/design-system/resolve";
import type { ScreenSpec, Inst } from "@/design-system/builders";
import type { ComponentGuide, DesignLanguage, LayoutGuide } from "@/design-system/docs";
import { COMPONENT_PROPS_SCHEMA, screenDefs } from "./schemas";
import { SCAN_COMPONENTS } from "@/design-system/scan";
import { DEFAULT_OPTIONS, DEPTH_GROUPS, type Depth, type ExtractOptions, type FoundationGroup } from "@/design-system/extract-options";
import { isStylePath } from "@/design-system/styles";
import { STRUCTURE_SCHEMA, type StructureResult } from "./ds-structure";

type JSONSchema = Record<string, unknown>;

const str = (description: string): JSONSchema => ({ type: "string", description });
const num = (description: string): JSONSchema => ({ type: "number", description });
const strs = (description: string): JSONSchema => ({ type: "array", items: { type: "string" }, description });
const obj = (properties: Record<string, JSONSchema>, description?: string): JSONSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  ...(description ? { description } : {}),
});
const SOURCE: JSONSchema = { type: "string", enum: ["observed", "inferred"], description: "observed = visible in the image; inferred = derived from the language because the screen doesn't show it" };

/** Nest leaf schemas by dotted path, e.g. "bg.canvas" → { bg: { canvas: … } }. */
function nest(entries: [string, JSONSchema][], description?: string): JSONSchema {
  const tree: Record<string, unknown> = {};
  for (const [path, leaf] of entries) {
    const keys = path.split(".");
    let n = tree;
    for (const k of keys.slice(0, -1)) n = (n[k] ??= {}) as Record<string, unknown>;
    n[keys[keys.length - 1]] = { __leaf: leaf };
  }
  const build = (n: Record<string, unknown>, desc?: string): JSONSchema =>
    "__leaf" in n ? (n.__leaf as JSONSchema) : obj(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, build(v as Record<string, unknown>)])), desc);
  return build(tree, description);
}

const COLOR_ROLE_DEF = obj({
  hex: str("#RRGGBB, or #RRGGBBAA when translucent"),
  source: SOURCE,
  evidence: str("Where it appears, e.g. 'primary CTA fill, bottom of screen'. Empty if inferred."),
  image: num("Which image the bbox is in: 1 for the first, 2 for the second…"),
  bbox: { type: "array", items: { type: "number" }, description: "Region in 0–1 image coordinates [x0, y0, x1, y1] filled with exactly this colour (inside the element, away from text and edges). [] if inferred." },
});

/** Elements the studio measures in the pixels (height, corner radius, margins). */
export const MEASURED_KINDS = ["primary-button", "secondary-button", "text-field", "card", "chip", "tag", "icon-button", "tile", "banner"] as const;
export type MeasuredKind = (typeof MEASURED_KINDS)[number];
/** Elements the studio reads component structure from (floating vs docked nav, title placement…). */
export const STRUCTURE_KINDS = ["nav-bar", "nav-active", "top-bar-title", "tabs-active", "list-item", "list-leading"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const ELEMENT_KINDS = [...MEASURED_KINDS, ...STRUCTURE_KINDS] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const ELEMENTS: JSONSchema = {
  type: "array",
  description:
    "Up to two of each kind of element you can see, for the studio to measure in the pixels (height, corner radius, side margins). The bbox goes around the whole element, including its border, as tightly as you can. Leave out kinds you can't see.",
  items: obj({
    kind: {
      type: "string",
      enum: [...ELEMENT_KINDS],
      description:
        "primary-button: main filled CTA; text-field: input or search field; tile: service/category tile; banner: promo banner; nav-bar: the whole bottom tab bar (the full-width bar, or the floating pill with its background); nav-active: the shape behind the active tab's icon (only if there is one); top-bar-title: the screen title text, tight around the text; tabs-active: the selected tab's marker (its underline or its pill); list-item: one whole list row, from its top edge to just above the next row, edge to edge of the list; list-leading: a row's leading icon, including the shape around it if it has one",
    },
    image: num("Which image: 1 for the first…"),
    bbox: { type: "array", items: { type: "number" }, description: "[x0, y0, x1, y1] in 0–1 image coordinates" },
  }),
};

const TYPE_ROLE_DEF = obj({
  family: { type: "string", enum: ["latin", "display"], description: "Which font family slot this style uses" },
  weight: num("100–900"),
  size: num("px at 1x (divide by the screenshot's scale, usually 3 for phone captures)"),
  lineHeight: num("px"),
  letterSpacing: num("px, negative for tight headings"),
  source: SOURCE,
  evidence: str("Example text set in this style"),
});

const FONT: JSONSchema = obj({
  identified: str("The typeface as it looks, e.g. 'SF Pro Display', 'Circular', 'Inter'"),
  googleFont: str("Closest family available on Google Fonts, exact name, e.g. 'Inter', 'DM Sans', 'Manrope'"),
  category: { type: "string", enum: ["sans-serif", "serif", "rounded", "geometric", "grotesque", "humanist", "monospace", "display"] },
  confidence: num("0–1"),
});

const SHADOW_LAYER: JSONSchema = obj({
  x: num("px offset"),
  y: num("px offset"),
  blur: num("px blur radius (CSS convention)"),
  spread: num("px, may be negative"),
  color: str("#RRGGBBAA with the real (usually low) alpha"),
  inset: { type: "boolean", description: "true for an inner shadow" },
});

const SHADOW_ROLE_DEF = obj({
  layers: { type: "array", items: SHADOW_LAYER, description: "All layers, top to bottom, e.g. a tight contact shadow plus a soft ambient one. [] for none." },
  source: SOURCE,
  evidence: str("Which element casts it"),
});

const ref = (name: string): JSONSchema => ({ $ref: `#/$defs/${name}` });

const dimGroup = (prefix: string): JSONSchema =>
  obj({
    ...Object.fromEntries(ROLE_SPECS.filter((r) => r.path.startsWith(prefix) && r.type === "dimension").map((r) => [r.path.slice(prefix.length), { type: "number" }])),
    evidence: str("What you measured"),
  });

/** One line per recipe token for the prompt: path, type and the built-in value (a role reference). */
export function recipeReference(): string {
  return ROLE_SPECS.filter((r) => r.path.startsWith("component.") && !isStylePath(r.path))
    .map((r) => {
      const t = BUILTIN.get(r.path)!;
      return `${r.path.slice(10)} (${r.type}) = ${typeof t.authored === "string" ? t.authored : JSON.stringify(t.authored)}`;
    })
    .join("\n");
}

/** Pass 1 schema for a depth: groups outside the depth are left out (the converter fills them). */
export function foundationsSchema(depth: Depth): JSONSchema {
  const groups = new Set<FoundationGroup>(DEPTH_GROUPS[depth]);
  const all: Record<string, JSONSchema> = {
    name: str("A short, descriptive name for this design system, e.g. 'Lumen Banking'"),
    summary: str("2–3 sentences on the visual system you see"),
    scale: num("Screenshot scale factor you assumed (1, 2 or 3); all px values below are at 1x"),
    primitives: {
      type: "array",
      description: "The palette as named ramps, e.g. {name:'violet.600', hex:'#6D28D9'}. Every distinct colour you can see, light to dark.",
      items: obj({ name: str("group.step, e.g. 'violet.600', 'neutral.50'"), hex: str("#RRGGBB") }),
    },
    colors: nest(ROLE_SPECS.filter((r) => r.type === "color" && isRolePath(r.path)).map((r) => [r.path, ref("ColorRole")])),
    fonts: obj({ latin: ref("Font"), display: ref("Font"), arabic: str("Google Font for Arabic if Arabic text is visible, else ''") }),
    type: nest(ROLE_SPECS.filter((r) => r.type === "typography").map((r) => [r.path.slice(5), ref("TypeRole")])),
    radius: dimGroup("radius."),
    space: obj({ ...(dimGroup("space.").properties as Record<string, JSONSchema>), baseUnit: num("Base grid unit, usually 4 or 8") }),
    size: dimGroup("size."),
    elements: ELEMENTS,
    // Structure is cheap and mostly measured: asked at every depth.
    structure: STRUCTURE_SCHEMA,
    ...FOUNDATION_EXTRAS,
  };
  const optional: Record<string, FoundationGroup> = { borderWidth: "borderWidth", shadows: "shadows", gradients: "gradients", layout: "layout", components: "components" };
  const properties = Object.fromEntries(Object.entries(all).filter(([k]) => !optional[k] || groups.has(optional[k])));
  const defs: Record<string, JSONSchema> = { ColorRole: COLOR_ROLE_DEF, TypeRole: TYPE_ROLE_DEF, Font: FONT };
  if (groups.has("shadows")) defs.ShadowRole = SHADOW_ROLE_DEF;
  return { ...obj(properties), $defs: defs };
}

const FOUNDATION_EXTRAS: Record<string, JSONSchema> = {
  borderWidth: dimGroup("border-width."),
  shadows: obj(Object.fromEntries(ROLE_SPECS.filter((r) => r.type === "shadow" && r.path.startsWith("shadow.") && r.path !== "shadow.none").map((r) => [r.path.slice(7), ref("ShadowRole")]))),
  gradients: {
    type: "array",
    description: "Gradients used as fills. Name the main brand one 'brand', and a soft wash behind the top of screens that fades into the background 'backdrop'. [] if the design has none.",
    items: obj({
      name: str("kebab-case, e.g. 'brand', 'hero', 'card-highlight'"),
      kind: { type: "string", enum: ["linear", "radial"] },
      angle: num("CSS degrees: 0 = to top, 90 = to right, 180 = to bottom"),
      stops: { type: "array", items: obj({ hex: str("#RRGGBB or #RRGGBBAA"), position: num("0–1") }) },
      usage: str("Where it's used"),
      source: SOURCE,
    }),
  },
  layout: obj({ gutter: num("px screen side margin"), "section-gap": num("px between body sections"), "footer-gap": num("px between stacked footer actions"), evidence: str("What you measured") }),
  // Structure options (component.*.style.*) come in "structure", as enums.
  components: nest(ROLE_SPECS.filter((r) => r.path.startsWith("component.") && !isStylePath(r.path)).map((r) => [r.path.slice(10), { type: "string" }])),
};

export const DS_FOUNDATIONS_SCHEMA = foundationsSchema("complete");

// ---------------------------------------------------------------------------

const GUIDE_FIELDS = {
  observed: { type: "boolean", description: "Seen in the source design" },
  purpose: str("One or two sentences"),
  whenToUse: strs("Concrete situations"),
  whenNotToUse: strs("Situations where another component fits better, naming it"),
  anatomy: strs("Parts, e.g. 'leading icon (20px, icon.secondary)'"),
  variants: { type: "array", items: obj({ name: str("Variant or prop value"), usage: str("When to use it in this system") }) },
  content: str("Copy guidelines: tone, length, casing"),
  placement: str("Where it sits in layouts and spacing around it"),
  states: str("Pressed, selected, disabled, error… as this system shows them"),
  dos: strs("Do"),
  donts: strs("Don't"),
  tokens: strs("Token paths that style it in this system, e.g. component.button.radius"),
} as const;

/** Pass 2 schema for the chosen docs: only the requested sections, only the chosen components. */
export function guideSchema(o: ExtractOptions): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  if (o.language) {
    properties.language = obj({
      name: str("Name of the language, e.g. 'Soft neo-banking'"),
      summary: str("3–4 sentences"),
      personality: strs("3–5 adjectives"),
      principles: { type: "array", items: obj({ title: str("Short"), body: str("One or two sentences") }) },
      color: str("How colour is used: ratios, where the brand colour appears, backgrounds"),
      typography: str("Voice of the type: families, weights, casing, hierarchy"),
      shape: str("Corner language and silhouettes"),
      depth: str("Elevation strategy: borders vs shadows, inner shadows, layering"),
      density: str("Spacing rhythm and information density"),
      iconography: str("Icon style"),
      imagery: str("Photography/illustration style"),
      voice: str("Copy tone as seen"),
      dos: strs("Do"),
      donts: strs("Don't"),
    });
    properties.layout = obj({
      summary: str("How screens are orchestrated in this system"),
      density: { type: "string", enum: ["compact", "regular", "airy"] },
      grid: str("Columns, margins, alignment"),
      rhythm: str("Vertical rhythm between sections and inside groups"),
      navigation: str("Top bar, tab bar, sheets: which patterns and when"),
      hierarchy: str("Order of information on a typical screen"),
      templates: {
        type: "array",
        description: "2–5 typical screen templates in this system",
        items: obj({
          name: str("e.g. 'Home', 'Detail', 'Checkout'"),
          whenToUse: str("One sentence"),
          regions: { type: "array", items: obj({ region: { type: "string", enum: ["header", "hero", "body", "footer"] }, components: { type: "array", items: { type: "string", enum: COMPONENT_NAMES } }, notes: str("Short") }) },
        }),
      },
      rules: strs("Orchestration rules a generator must follow"),
    });
  }
  if (o.components.length) {
    properties.components = {
      type: "array",
      description: `Exactly one design.md-style guide per component: ${o.components.join(", ")}`,
      items: obj({ component: { type: "string", enum: o.components }, ...GUIDE_FIELDS }),
    };
  }
  if (o.patterns !== "none") {
    properties.patterns = {
      type: "array",
      description:
        o.patterns === "listed"
          ? `Exactly these new components, in order: ${o.patternNames.join(", ")}; each composed from catalog components`
          : "Niche components specific to this design (0–5), each composed from catalog components",
      items: obj({
        name: str("PascalCase, e.g. 'BalanceCard', 'RideOptionRow'"),
        purpose: str("One sentence"),
        guide: obj({ component: str("Same as name"), ...GUIDE_FIELDS }),
        props: COMPONENT_PROPS_SCHEMA,
        composition: { $ref: "#/$defs/Node3" },
      }),
    };
  }
  return { ...obj(properties), ...(o.patterns !== "none" ? { $defs: screenDefs() } : {}) };
}

export const DS_GUIDE_SCHEMA = guideSchema(DEFAULT_OPTIONS);

export const RESTYLE_SCHEMA: JSONSchema = {
  ...obj({
    screen: { $ref: "#/$defs/Screen" },
    changes: { type: "array", items: obj({ path: str("Spec path you changed, e.g. 'body.2'"), summary: str("What changed and why, citing the design language") }) },
  }),
  $defs: screenDefs(),
};

/** The source screenshot rebuilt with the extracted system: the fidelity check. */
export const REBUILD_SCHEMA: JSONSchema = {
  ...obj({
    screen: { $ref: "#/$defs/Screen" },
    gaps: {
      type: "array",
      description: "What the catalog couldn't reproduce faithfully. [] if nothing.",
      items: obj({ element: str("What's in the screenshot, e.g. 'donut chart of spending'"), workaround: str("What you used instead") }),
    },
  }),
  $defs: screenDefs(),
};

// ---------------------------------------------------------------------------
// First look: what the screenshots show, before the designer chooses what to extract

export { SCAN_COMPONENTS };

export const SCAN_SCHEMA: JSONSchema = obj({
  product: str("The product's name if a screen shows it, else a short descriptive name, e.g. 'Lumen Wallet'"),
  platform: { type: "string", enum: ["mobile", "web", "dashboard", "app"], description: "mobile = phone app; web = website; dashboard = admin or analytics app with side navigation; app = desktop tool people edit in (video or photo editor, design tool, IDE)" },
  look: str("One sentence on what makes it look the way it does: palette, surfaces, shapes, type, density"),
  components: {
    type: "array",
    description: "Catalog components you can see, one entry each",
    items: obj({
      name: { type: "string", enum: SCAN_COMPONENTS },
      images: { type: "array", items: { type: "number" }, description: "Which images show it: 1 for the first…" },
      count: num("How many instances across all images"),
      evidence: str("Where, e.g. 'Top up, Send and Swap in the balance card; Pay a bill at the bottom'"),
    }),
  },
  candidates: {
    type: "array",
    description: "Distinctive, product-specific elements that aren't a single catalog component (0–5). [] if none.",
    items: obj({
      name: str("Short name, e.g. 'Balance hero card'"),
      description: str("What it is and which catalog components it would be built from"),
      images: { type: "array", items: { type: "number" }, description: "Which images show it" },
    }),
  },
  recommendation: obj({
    fetch: { type: "string", enum: ["tokens", "components", "extended"], description: "What you'd extract from these screenshots" },
    why: str("One sentence, citing the screens"),
  }),
  questions: {
    type: "array",
    description: "0–2 questions about ambiguities that would change the system. [] when the screenshots are clear.",
    items: obj({
      text: str("The question, short and specific to these screens"),
      why: str("What changes in the system depending on the answer"),
      options: strs("2–4 mutually exclusive answers, each under 60 characters"),
      recommended: str("The option you'd pick, copied exactly"),
    }),
  },
});

// ---------------------------------------------------------------------------
// Response types

export interface ColorRole {
  hex: string;
  source: "observed" | "inferred";
  evidence: string;
  /** 1-based index of the image the bbox is in (absent in older recordings: the first). */
  image?: number;
  bbox: number[];
}

export interface ElementBox {
  kind: ElementKind;
  image?: number;
  bbox: number[];
}
export interface TypeRole {
  family: "latin" | "display";
  weight: number;
  size: number;
  lineHeight: number;
  letterSpacing: number;
  source: "observed" | "inferred";
  evidence: string;
}
export interface FontGuess {
  identified: string;
  googleFont: string;
  category: string;
  confidence: number;
}
export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}
export interface GradientOut {
  name: string;
  kind: "linear" | "radial";
  angle: number;
  stops: { hex: string; position: number }[];
  usage: string;
  source: "observed" | "inferred";
}
type Nested<T> = { [k: string]: T | Nested<T> };

export interface FoundationsResult {
  name: string;
  summary: string;
  scale: number;
  primitives: { name: string; hex: string }[];
  colors: Nested<ColorRole>;
  fonts: { latin: FontGuess; display: FontGuess; arabic: string };
  type: Record<string, TypeRole>;
  radius: Record<string, number | string>;
  space: Record<string, number | string>;
  size: Record<string, number | string>;
  /** Elements to measure (absent in older recordings). */
  elements?: ElementBox[];
  // Absent when the extraction depth leaves them out.
  borderWidth?: Record<string, number | string>;
  shadows?: Record<string, { layers: ShadowLayer[]; source: "observed" | "inferred"; evidence: string }>;
  gradients?: GradientOut[];
  layout?: Record<string, number | string>;
  components?: Nested<string>;
  /** How each component is built (absent in older recordings). */
  structure?: StructureResult;
  /** Older recordings only: the model's notes per component family (no longer asked for). */
  componentNotes?: { component: string; observed: boolean; notes: string }[];
}

/** Sections the designer skipped are absent. */
export interface GuideResult {
  language?: DesignLanguage;
  layout?: LayoutGuide;
  components?: ComponentGuide[];
  patterns?: { name: string; purpose: string; guide: ComponentGuide; props?: unknown; composition: Inst }[];
}

export interface RebuildResult {
  screen: ScreenSpec;
  gaps: { element: string; workaround: string }[];
}

export type ScanFetch = "tokens" | "components" | "extended";
export interface ScanComponent {
  name: string;
  images: number[];
  count: number;
  evidence: string;
}
export interface ScanCandidate {
  name: string;
  description: string;
  images: number[];
}
export interface ScanQuestion {
  /** "ai-1", "ai-2" (set by the studio). */
  id: string;
  text: string;
  why: string;
  options: string[];
  /** One of the options, or "". */
  recommended: string;
}
/** The first look, after the studio's checks (src/design-system/scan.ts). */
export interface ScanResult {
  product: string;
  platform: "mobile" | "web" | "dashboard" | "app";
  look: string;
  components: ScanComponent[];
  candidates: ScanCandidate[];
  recommendation: { fetch: ScanFetch; why: string };
  questions: ScanQuestion[];
}

export interface RestyleResult {
  screen: ScreenSpec;
  changes: { path: string; summary: string }[];
  /** Critique fixes: the facts the fix relied on. */
  reliedOn?: { id: string; why: string }[];
}
