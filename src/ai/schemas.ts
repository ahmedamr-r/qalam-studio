/**
 * JSON Schemas for Claude structured outputs, generated from the component catalog.
 * Structured outputs don't allow recursion, so container nesting is unrolled: body items nest four
 * components deep (e.g. Card > horizontal Stack > vertical Stack > Text), header, sidebar and
 * footer items three.
 */
import { CATALOG, type ComponentSpec, type PropSpec } from "@/design-system/components";
import { CUSTOM_SPEC } from "@/design-system/custom";
import type { ComponentDef } from "@/design-system/docs";
import { PLATFORMS, PLATFORM_IDS } from "@/design-system/platform";
import { ARABIC_FONTS, LATIN_FONTS } from "@/design-system/interview/fonts";
import { KNOB_IDS, KNOB_SPECS } from "@/design-system/interview/knobs";

type JSONSchema = Record<string, unknown>;

function propSchema(p: PropSpec): JSONSchema {
  switch (p.type) {
    case "string":
      return { type: "string", description: `max ${p.maxChars} characters${p.description ? ` — ${p.description}` : ""}` };
    case "number":
      return { type: "number", ...(p.description ? { description: p.description } : {}) };
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { type: "string", enum: p.values };
    case "icon":
      return { $ref: "#/$defs/Icon" };
    case "strings":
      return { type: "array", items: { type: "string" }, description: `max ${p.maxItems} items, each max ${p.maxChars} characters` };
    case "numbers":
      return { type: "array", items: { type: "number" }, description: `max ${p.maxItems} items${p.description ? ` — ${p.description}` : ""}` };
    case "items":
      return {
        type: "array",
        description: `max ${p.maxItems} items${p.description ? ` — ${p.description}` : ""}`,
        items: objectOf(p.fields),
      };
    case "path":
      return { type: "string", description: `SVG path data, max ${p.maxChars} characters${p.description ? ` — ${p.description}` : ""}` };
    case "image":
      return { type: "string", description: `crop:x,y,w,h (a box in the source screenshot, in pixels of the image as you see it), or empty${p.description ? ` — ${p.description}` : ""}` };
  }
}

function objectOf(fields: Record<string, PropSpec>): JSONSchema {
  const required = Object.entries(fields)
    .filter(([, p]) => "required" in p && p.required)
    .map(([k]) => k);
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(fields).map(([k, p]) => [k, propSchema(p)])),
    required,
  };
}

function componentSchema(name: string, childRef?: string): JSONSchema {
  const spec: ComponentSpec = name === CUSTOM_SPEC.name ? CUSTOM_SPEC : CATALOG.find((c) => c.name === name)!;
  const properties: JSONSchema = { component: { type: "string", const: name }, props: objectOf(spec.props) };
  const required = ["component", "props"];
  if (childRef) {
    properties.children = { type: "array", items: { $ref: childRef } };
    required.push("children");
  }
  return { type: "object", additionalProperties: false, properties, required };
}

// Custom places a system's own component, or one defined in newComponents, by name.
const LEAVES = [...CATALOG.filter((c) => !c.container).map((c) => c.name), CUSTOM_SPEC.name];
const CONTAINERS = CATALOG.filter((c) => c.container).map((c) => c.name);

export function screenDefs(): Record<string, JSONSchema> {
  return {
    Icon: { type: "string", description: "A Lucide icon by its kebab-case name (lucide.dev/icons), e.g. 'x', 'arrow-left', 'map-pin'" },
    Leaf: { anyOf: LEAVES.map((n) => componentSchema(n)) },
    Container1: { anyOf: CONTAINERS.map((n) => componentSchema(n, "#/$defs/Leaf")) },
    Node1: { anyOf: [{ $ref: "#/$defs/Leaf" }, { $ref: "#/$defs/Container1" }] },
    Container2: { anyOf: CONTAINERS.map((n) => componentSchema(n, "#/$defs/Node1")) },
    Node2: { anyOf: [{ $ref: "#/$defs/Leaf" }, { $ref: "#/$defs/Container1" }, { $ref: "#/$defs/Container2" }] },
    Container3: { anyOf: CONTAINERS.map((n) => componentSchema(n, "#/$defs/Node2")) },
    Node3: { anyOf: [{ $ref: "#/$defs/Leaf" }, { $ref: "#/$defs/Container1" }, { $ref: "#/$defs/Container2" }, { $ref: "#/$defs/Container3" }] },
    Screen: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Short frame name, e.g. 'Order tracking · Map first'" },
        rationale: { type: "string", description: "One sentence: what this variant optimises for" },
        platform: { type: "string", enum: PLATFORM_IDS, description: "mobile: 390×844 phone; web: 1440-wide website or web app page; dashboard: 1440-wide admin or analytics app with a side navigation; app: 1440×900 desktop tool people edit in (video or photo editor, design tool, IDE)" },
        margin: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description: `Side margin in px, only when the brief asks for specific margins. null = the default: the design system's gutter on mobile, ${PLATFORMS.web.margin} on web, ${PLATFORMS.dashboard.margin} on dashboards, ${PLATFORMS.app.margin} in a desktop app's workspace`,
        },
        dir: { type: "string", enum: ["ltr", "rtl"] },
        lang: { type: "string", enum: ["en", "ar"] },
        background: { type: "string", enum: ["canvas", "surface"], description: "Screens with a hero use canvas, the colour the backdrop fades into" },
        header: { type: "array", items: { $ref: "#/$defs/Node2" }, description: "mobile: usually one TopBar; web: the site navigation; dashboard: the page title and actions; app: the app bar (name, Toolbar, actions)" },
        sidebar: { type: "array", items: { $ref: "#/$defs/Node2" }, description: "dashboard: the side navigation; app: the start panel (media, assets, layers). Empty for mobile and web" },
        hero: {
          type: "array",
          items: { $ref: "#/$defs/Node2" },
          description:
            "mobile and web: the screen's lead content (greeting or headline, a key figure such as a balance or ETA, a SearchBar, a full-bleed map; 1–4 items) on the design system's backdrop, a soft gradient behind the top of the screen and the header that fades into the background. Empty for flat screens (forms, settings, checkout steps, dense lists) and always on dashboards and desktop apps",
        },
        overlap: {
          type: "string",
          enum: ["none", "sm", "md", "lg"],
          description: "How far the first body section rises over the hero's bottom edge: sm 16px, md 32px, lg 48px. Only with a hero, and only when body[0] has its own surface (a Card, a Stack with a background, ServiceGrid, PromoBanner, SearchBar). none otherwise",
        },
        body: { type: "array", items: { $ref: "#/$defs/Node3" } },
        footer: { type: "array", items: { $ref: "#/$defs/Node2" }, description: "mobile: pinned bottom (primary Button, BottomNav or BottomSheet); web: the page footer; dashboard: usually empty; app: the bottom panel across the window (a Timeline, or a status bar)" },
      },
      required: ["name", "rationale", "platform", "margin", "dir", "lang", "background", "header", "sidebar", "hero", "overlap", "body", "footer"],
    },
  };
}

export const OFF_SYSTEM_SCHEMA: JSONSchema = {
  type: "array",
  description: "Needs the brief implies that the component catalog cannot express. Empty if none.",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      need: { type: "string", description: "What the screen needs, e.g. 'live courier photo'" },
      workaround: { type: "string", description: "Which system components you used instead" },
      proposal: { type: "string", description: "Suggested new component or variant for the DS backlog" },
    },
    required: ["need", "workaround", "proposal"],
  },
};

/**
 * Components the model makes while designing: reusable things the catalog can't express (a card
 * face, a mark), composed of catalog parts and Graphic, placed with Custom. Written before the
 * screens, so they're known when the screens that place them stream in.
 */
/** A component's props: what its instances fill in (shared by components made while designing and extracted ones). */
export const COMPONENT_PROPS_SCHEMA: JSONSchema = {
  type: "array",
  description: "What changes from one use to the next (the card's last digits, a product's name and price, a label); the composition shows each as {name}. max 6",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "camelCase, e.g. 'last4'" },
      kind: { type: "string", enum: ["text", "icon"] },
      maxChars: { type: "number", description: "For text: the longest value that fits" },
      example: { type: "string", description: "A real value, shown when an instance leaves it out" },
    },
    required: ["name", "kind", "maxChars", "example"],
  },
};

export const NEW_COMPONENTS_SCHEMA: JSONSchema = {
  type: "array",
  description: "Components you define for these screens (empty if none): each is placed with Custom by its name, with values for its props",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "Title Case, max 32 characters, e.g. 'Cash Card'; not a catalog name" },
      purpose: { type: "string", description: "One sentence: what it is and where the product uses it" },
      props: COMPONENT_PROPS_SCHEMA,
      composition: { $ref: "#/$defs/Node2" },
    },
    required: ["name", "purpose", "props", "composition"],
  },
};

export const GENERATE_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  $defs: screenDefs(),
  properties: {
    // First, so the studio can show it while the screens are still being written.
    approach: { type: "string", description: "1–2 sentences for the designer on the direction you took for these screens, written before them" },
    newComponents: NEW_COMPONENTS_SCHEMA,
    variants: { type: "array", items: { $ref: "#/$defs/Screen" } },
    offSystem: OFF_SYSTEM_SCHEMA,
    interactions: {
      type: "array",
      items: { type: "string" },
      description: "What the brief asks to see happen on the screen without leaving it, which you didn't draw because Qalam AI prototypes it there (a sheet open, something added, another tab): a few words each in the brief's language, e.g. 'The dish's options sheet open'. Empty when it asks for none",
    },
  },
  required: ["approach", "newComponents", "variants", "offSystem", "interactions"],
};

const LATIN_NAMES = LATIN_FONTS.map((f) => f.family);

/** Generating without a design system: the look Qalam AI picks, as knobs code builds every token from (design-system/freeform.ts). */
const LOOK_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "2–3 words that name the look, e.g. 'Quiet studio'" },
    rationale: { type: "string", description: "One sentence for the designer, under 200 characters, on why this look fits the product and its people, quoting the brief" },
    adjectives: { type: "array", items: { type: "string" }, description: "2–4 single words the look should read as" },
    hue: { type: "number", description: "Brand hue in OKLCH degrees (0–360): 25 red, 60 orange, 90 amber, 110 yellow, 150 green, 200 teal, 250 blue, 290 violet, 330 pink. Ignored when the brief gives a brand colour" },
    ...Object.fromEntries(
      KNOB_IDS.filter((k) => k !== "hue").map((k) => {
        if (k === "font") return [k, { type: "string", enum: LATIN_NAMES, description: "Body font" }];
        if (k === "displayFont") return [k, { type: "string", enum: ["same", ...LATIN_NAMES], description: "Headings font: 'same' for the body font, or another family" }];
        if (k === "arabicFont") return [k, { type: "string", enum: [...ARABIC_FONTS], description: "Arabic font paired with the body font" }];
        return [k, { type: "string", enum: [...KNOB_SPECS[k].options], description: KNOB_SPECS[k].label }];
      }),
    ),
  },
  required: ["name", "rationale", "adjectives", ...KNOB_IDS],
};

/**
 * Generate without a design system: the look comes right after the approach, before the screens,
 * so the studio can build the system the screens are drawn with as they stream. With a look from
 * earlier turns, null keeps it.
 */
export function freeformGenerateSchema(keep: boolean): JSONSchema {
  const { approach, ...rest } = GENERATE_SCHEMA.properties as Record<string, JSONSchema>;
  const style = keep
    ? { anyOf: [LOOK_SCHEMA, { type: "null" }], description: "null keeps the look these screens already have; a new look only when the brief asks for a different one" }
    : { ...LOOK_SCHEMA, description: "How these screens look: there is no design system, so you choose it" };
  return { ...GENERATE_SCHEMA, properties: { approach, style, ...rest }, required: ["approach", "style", ...(GENERATE_SCHEMA.required as string[]).filter((r) => r !== "approach")] };
}

/**
 * An edit to part of a screen: for each selected component (by spec path), what replaces it.
 * The paths are fixed per request, so nothing outside the selection can change.
 */
export function sectionSchema(paths: string[]): JSONSchema {
  return {
    type: "object",
    additionalProperties: false,
    $defs: screenDefs(),
    properties: {
      approach: { type: "string", description: "1–2 sentences for the designer on what you changed in the selected part, written before the edits" },
      newComponents: NEW_COMPONENTS_SCHEMA,
      edits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", enum: paths, description: "The selected component being replaced" },
            items: {
              type: "array",
              items: { $ref: "#/$defs/Node3" },
              description: "What replaces it: usually one component; several only when the brief asks to add something beside it or to split it; none to remove it",
            },
          },
          required: ["path", "items"],
        },
      },
      offSystem: OFF_SYSTEM_SCHEMA,
    },
    required: ["approach", "newComponents", "edits", "offSystem"],
  };
}

/** The repair pass: each screen it was given, fixed, with what changed. */
export const REPAIR_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  $defs: screenDefs(),
  properties: {
    screens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number", description: "The screen's index as given" },
          screen: { $ref: "#/$defs/Screen" },
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { path: { type: "string", description: "Spec path you changed" }, summary: { type: "string", description: "What changed, naming the issue it fixes" } },
              required: ["path", "summary"],
            },
          },
        },
        required: ["index", "screen", "changes"],
      },
    },
  },
  required: ["screens"],
};

export const EXTRACT_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  $defs: screenDefs(),
  properties: {
    summary: { type: "string", description: "2–3 sentences on what the source contains and the main risks" },
    namingConvention: { type: "string", description: "The naming convention you applied, e.g. 'group.role-modifier, kebab-case'" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceId: { type: "string", description: "id of the raw value from the input list, or 'img-N' for values read from an image" },
          value: { type: "string", description: "Normalised value: #RRGGBB, #RRGGBBAA, '12px', or a font shorthand" },
          type: { type: "string", enum: ["color", "dimension", "typography", "shadow"] },
          usage: { type: "string", description: "Where it is used (selectors/elements)" },
          intent: { type: "string", description: "Semantic role, e.g. 'brand primary action', 'success feedback'" },
          name: { type: "string", description: "Suggested token path" },
          existingToken: { type: "string", description: "Matching path in the current library, or empty string" },
          action: { type: "string", enum: ["reuse-existing", "new-token", "split", "merge", "drop"] },
          group: { type: "string", description: "Shared id for suggestions that split one raw value into several meanings (or merge near-duplicates); empty otherwise" },
          confidence: { type: "number", description: "0–1" },
          reasoning: { type: "string", description: "One or two sentences. Explain intent vs coincidence." },
        },
        required: ["sourceId", "value", "type", "usage", "intent", "name", "existingToken", "action", "group", "confidence", "reasoning"],
      },
    },
    rebuild: {
      anyOf: [{ $ref: "#/$defs/Screen" }, { type: "null" }],
      description: "For screenshots only: the screen rebuilt from catalog components. null for CSS/JSON input.",
    },
  },
  required: ["summary", "namingConvention", "suggestions", "rebuild"],
};

export const AUDIT_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "2–3 sentence verdict" },
    score: { type: "number", description: "0–100 system adherence + accessibility score" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          findingIds: { type: "array", items: { type: "string" }, description: "Linter finding ids this explains (may be empty for new observations)" },
          nodeId: { type: "string", description: "Node id, or empty string" },
          issue: { type: "string" },
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          rule: { type: "string", description: "WCAG success criterion or DS rule, e.g. 'WCAG 1.4.3' or 'DS: use type tokens'" },
          replaceWith: { type: "string", description: "Token or component to use instead, or empty string" },
          rtlNote: { type: "string", description: "RTL/Arabic implication, or empty string" },
        },
        required: ["findingIds", "nodeId", "issue", "severity", "rule", "replaceWith", "rtlNote"],
      },
    },
  },
  required: ["summary", "score", "issues"],
};

// ---------------------------------------------------------------------------
// Response types (validated again by the builders/linter on the client).

import type { Inst, ScreenSpec } from "@/design-system/builders";

export interface OffSystemNeed {
  need: string;
  workaround: string;
  proposal: string;
}

export interface SectionResult {
  approach: string;
  /** Components made for this edit (older recordings have none). */
  newComponents?: ComponentDef[];
  edits: { path: string; items: Inst[] }[];
  offSystem: OffSystemNeed[];
}

export interface GenerateResult {
  /** A line for the designer on the direction taken (older recordings have none). */
  approach?: string;
  /** Components made for these screens (older recordings have none). */
  newComponents?: ComponentDef[];
  /** What the brief asked to see happen on the screens that wasn't drawn: left for the prototype. */
  interactions?: string[];
  /** Without a design system: the look Qalam AI picked (raw, see sanitizeLook); null keeps the one the screens have. */
  style?: unknown;
  variants: ScreenSpec[];
  offSystem: OffSystemNeed[];
  /** The facts the screens relied on (older recordings have none). */
  reliedOn?: { id: string; why: string }[];
  /** What it had to guess about the product or its users. */
  assumed?: { topic: string; guess: string }[];
}

export interface Suggestion {
  sourceId: string;
  value: string;
  type: "color" | "dimension" | "typography" | "shadow";
  usage: string;
  intent: string;
  name: string;
  existingToken: string;
  action: "reuse-existing" | "new-token" | "split" | "merge" | "drop";
  group: string;
  confidence: number;
  reasoning: string;
}

export interface RepairResult {
  screens: { index: number; screen: ScreenSpec; changes: { path: string; summary: string }[] }[];
}

export interface ExtractResult {
  summary: string;
  namingConvention: string;
  suggestions: Suggestion[];
  rebuild: ScreenSpec | null;
}

export interface AuditIssue {
  findingIds: string[];
  nodeId: string;
  issue: string;
  severity: "critical" | "major" | "minor";
  rule: string;
  replaceWith: string;
  rtlNote: string;
}

export interface AuditResult {
  summary: string;
  score: number;
  issues: AuditIssue[];
}

// ---------------------------------------------------------------------------
// Direction: a screen's copy translated when it switches between LTR and RTL

export const TRANSLATE_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The string's id, exactly as given" },
          text: { type: "string", description: "The translation, or the source unchanged when it stays as written (a person's name, a brand, a code)" },
        },
        required: ["id", "text"],
      },
    },
    note: { type: "string", description: "One short line for the designer: a term you chose or what you kept as written and why; empty string if nothing to say" },
  },
  required: ["translations", "note"],
};

export interface TranslateResult {
  translations: { id: string; text: string }[];
  note: string;
}
