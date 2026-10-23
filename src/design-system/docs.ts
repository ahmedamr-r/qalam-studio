import type { Inst } from "./builders";
import { CATALOG } from "./components";

/**
 * The written half of a design system: its language, how screens are orchestrated, and a
 * design.md-style guide for every component (universal catalog components and the system's own
 * niche patterns).
 */

export interface DesignLanguage {
  name: string;
  summary: string;
  personality: string[];
  principles: { title: string; body: string }[];
  color: string;
  typography: string;
  shape: string;
  depth: string;
  density: string;
  iconography: string;
  imagery: string;
  voice: string;
  dos: string[];
  donts: string[];
}

export type Region = "header" | "hero" | "body" | "footer";

export interface LayoutTemplate {
  name: string;
  whenToUse: string;
  regions: { region: Region; components: string[]; notes: string }[];
}

export interface LayoutGuide {
  summary: string;
  density: "compact" | "regular" | "airy";
  grid: string;
  rhythm: string;
  navigation: string;
  hierarchy: string;
  templates: LayoutTemplate[];
  rules: string[];
}

export interface ComponentGuide {
  /** Catalog component name, or the pattern name for niche components. */
  component: string;
  /** Seen in the source design (vs. inferred from the language). */
  observed: boolean;
  purpose: string;
  whenToUse: string[];
  whenNotToUse: string[];
  anatomy: string[];
  variants: { name: string; usage: string }[];
  content: string;
  placement: string;
  states: string;
  dos: string[];
  donts: string[];
  /** Token paths this component is styled with in this system. */
  tokens: string[];
}

/** A value a component's instances fill in: its composition shows it wherever it says `{name}`. */
export interface ComponentProp {
  name: string;
  kind: "text" | "icon";
  maxChars: number;
  /** Shown when an instance leaves it out. */
  example: string;
}

/**
 * A component made of catalog components (Graphic included): a system's own (a pattern) or one
 * Qalam AI proposed for a screen (kept on the screen's spec until the designer adds it to the
 * system). Screens place it with a Custom instance, which stays linked to it.
 */
export interface ComponentDef {
  name: string;
  purpose: string;
  props?: ComponentProp[];
  composition: Inst;
}

/** A niche component: specific to one system, composed from universal catalog components. */
export interface Pattern extends ComponentDef {
  guide: ComponentGuide;
  /** Who made it: the extraction (read from the source screens) or Qalam AI while designing. */
  origin?: "extraction" | "ai";
  /** "asset:" reference of the screenshot it was read from (a component added from a screenshot of just it). */
  reference?: string;
}

/** Something the source screenshots have that the catalog can't draw exactly, and how screens approximate it. */
export interface CatalogGap {
  element: string;
  workaround: string;
}

export interface DesignDocs {
  language: DesignLanguage;
  layout: LayoutGuide;
  components: ComponentGuide[];
  patterns: Pattern[];
  /** From the extraction's fidelity check: what the catalog can't draw of this product. */
  gaps?: CatalogGap[];
}

// ---------------------------------------------------------------------------
// design.md rendering

const list = (items: string[]) => items.filter(Boolean).map((i) => `- ${i}`).join("\n");
const section = (title: string, body: string) => (body.trim() ? `## ${title}\n\n${body.trim()}\n` : "");

export function guideMarkdown(g: ComponentGuide, systemName: string): string {
  return [
    `# ${g.component}\n\n_${systemName} · ${g.observed ? "observed in the source design" : "inferred from the design language"}_\n\n${g.purpose}\n`,
    section("When to use", list(g.whenToUse)),
    section("When not to use", list(g.whenNotToUse)),
    section("Anatomy", list(g.anatomy)),
    section("Variants", g.variants.map((v) => `- **${v.name}**: ${v.usage}`).join("\n")),
    section("Content", g.content),
    section("Placement", g.placement),
    section("States", g.states),
    section("Do", list(g.dos)),
    section("Don't", list(g.donts)),
    section("Tokens", g.tokens.map((t) => `\`${t}\``).join(", ")),
  ]
    .filter(Boolean)
    .join("\n");
}

export function languageMarkdown(l: DesignLanguage): string {
  return [
    `# ${l.name}\n\n${l.summary}\n\n**Personality:** ${l.personality.join(", ")}\n`,
    section("Principles", l.principles.map((p) => `- **${p.title}**: ${p.body}`).join("\n")),
    section("Colour", l.color),
    section("Typography", l.typography),
    section("Shape", l.shape),
    section("Depth", l.depth),
    section("Density", l.density),
    section("Iconography", l.iconography),
    section("Imagery", l.imagery),
    section("Voice", l.voice),
    section("Do", list(l.dos)),
    section("Don't", list(l.donts)),
  ]
    .filter(Boolean)
    .join("\n");
}

export function layoutMarkdown(l: LayoutGuide): string {
  return [
    `# Layout orchestration\n\n${l.summary}\n\n**Density:** ${l.density}\n`,
    section("Grid", l.grid),
    section("Rhythm", l.rhythm),
    section("Navigation", l.navigation),
    section("Hierarchy", l.hierarchy),
    section(
      "Screen templates",
      l.templates
        .map((t) => `### ${t.name}\n\n${t.whenToUse}\n\n${t.regions.map((r) => `- **${r.region}**: ${r.components.join(" → ")}${r.notes ? ` (${r.notes})` : ""}`).join("\n")}`)
        .join("\n\n"),
    ),
    section("Rules", list(l.rules)),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The whole written system as one design.md. */
export function docsMarkdown(name: string, d: DesignDocs): string {
  const demote = (md: string) => md.replace(/^(#+) /gm, "#$1 ");
  return [
    `# ${name}\n`,
    demote(languageMarkdown(d.language)),
    demote(layoutMarkdown(d.layout)),
    "## Components\n",
    ...d.components.map((g) => demote(demote(guideMarkdown(g, name)))),
    ...(d.patterns.length ? ["## Patterns\n", ...d.patterns.map((p) => demote(demote(guideMarkdown(p.guide, name))))] : []),
  ].join("\n");
}

/** Compact version for prompts: one paragraph per component. */
export function guidesForPrompt(d: DesignDocs): string {
  const g = d.components.map(
    (c) =>
      `- ${c.component}: ${c.purpose}${c.anatomy?.length ? ` Anatomy: ${c.anatomy.slice(0, 5).join("; ")}.` : ""}${c.whenToUse.length ? ` Use: ${c.whenToUse.join("; ")}.` : ""}${c.whenNotToUse.length ? ` Avoid: ${c.whenNotToUse.join("; ")}.` : ""}${c.variants.length ? ` Variants: ${c.variants.map((v) => `${v.name} (${v.usage})`).join("; ")}.` : ""}${c.dos?.length ? ` Do: ${c.dos.slice(0, 4).join("; ")}.` : ""}${c.donts?.length ? ` Don't: ${c.donts.slice(0, 4).join("; ")}.` : ""}`,
  );
  return g.join("\n");
}

// ---------------------------------------------------------------------------
// Built-in docs (Qalam's ink default)

export function emptyGuide(component: string, purpose = ""): ComponentGuide {
  return { component, observed: false, purpose, whenToUse: [], whenNotToUse: [], anatomy: [], variants: [], content: "", placement: "", states: "", dos: [], donts: [], tokens: [] };
}

export const BUILTIN_LANGUAGE: DesignLanguage = {
  name: "Qalam Ink: super app",
  summary:
    "A calm, confident super-app language. Deep ink carries every primary action, a periwinkle accent is the bright thread, and light grey tiles organise a dense catalogue of services without visual noise.",
  personality: ["Confident", "Friendly", "Efficient", "Bilingual"],
  principles: [
    { title: "One accent thread", body: "Periwinkle is an accent for labels and highlights on deep ink, never body text on white." },
    { title: "Services first", body: "Tiles and cards give every service an equal, tappable slot; promos use sub-brand colours sparingly." },
    { title: "Arabic is first-class", body: "RTL layouts mirror, directional icons flip and copy is written natively, not translated word for word." },
  ],
  color: "Deep ink (bg.brand-strong) for primary actions with periwinkle labels. Light grey surfaces for tiles; white canvas. Sub-brand colours (go, get, eat, pay) only on promotional banners.",
  typography: "Inter for Latin, IBM Plex Sans Arabic for Arabic. Bold, sentence-case headings; 15px body with generous 22px line height.",
  shape: "Pill buttons and chips, radius.lg tiles and cards, radius.xl sheets and hero banners.",
  depth: "Mostly flat. A soft shadow.sm lifts raised cards and the selected segment; bottom sheets use shadow.md.",
  density: "Regular: 16px gutters and section gaps, 44px minimum touch targets.",
  iconography: "Rounded, 2px stroke line icons that mirror in RTL when directional.",
  imagery: "Tinted placeholders stand in for food and product photography; maps carry routes and pins.",
  voice: "Short, specific and warm: real restaurant names, ETAs and AED prices. Currency sits after the amount in Arabic.",
  dos: ["One primary action per screen", "Use sub-brand colours only for promotions", "Mirror layouts in RTL"],
  donts: ["Periwinkle text on white", "Lorem ipsum", "More than one bottom navigation"],
};

export const BUILTIN_LAYOUT: LayoutGuide = {
  summary: "Mobile screens (390×844) stack a top bar, scrolling body sections and a pinned footer.",
  density: "regular",
  grid: "Single column with 16px gutters; service grids use 4 columns.",
  rhythm: "16px between body sections, 12px inside cards, 8px between chips and tiles.",
  navigation: "TopBar for hierarchy (back or close on the leading edge); BottomNav for top-level destinations; BottomSheet for focused tasks.",
  hierarchy: "Headline or title first, then the primary content, then supporting lists; one primary action pinned in the footer.",
  templates: [
    {
      name: "Home",
      whenToUse: "Super-app landing with services and promotions",
      regions: [
        { region: "header", components: ["TopBar"], notes: "" },
        { region: "hero", components: ["Text", "SearchBar"], notes: "Greeting and search on the backdrop" },
        { region: "body", components: ["ServiceGrid", "PromoBanner", "ListItem"], notes: "The ServiceGrid rises over the hero's edge (overlap md)" },
        { region: "footer", components: ["BottomNav"], notes: "" },
      ],
    },
    {
      name: "Tracking",
      whenToUse: "Live ride or delivery progress",
      regions: [
        { region: "header", components: ["TopBar"], notes: "" },
        { region: "body", components: ["MapPlaceholder", "ProgressTracker", "Card"], notes: "Map first" },
        { region: "footer", components: ["Button"], notes: "Contact or cancel" },
      ],
    },
  ],
  rules: [
    "At most one BottomNav, one BottomSheet and one primary Button in the footer",
    "Group with Stack (rows) and Card (related content); nest only as deep as the content needs",
    "Landing screens (home, wallet, account) lead with a hero on the backdrop, and their first section overlaps its edge; task screens stay flat",
  ],
};

export const BUILTIN_DOCS: DesignDocs = {
  language: BUILTIN_LANGUAGE,
  layout: BUILTIN_LAYOUT,
  components: CATALOG.map((c) => emptyGuide(c.name, c.description)),
  patterns: [],
};
