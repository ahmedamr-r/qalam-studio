/**
 * The prototyping agent's calls: proposing what to prototype on a screen, and writing the parts
 * the picked steps need (a dish's options sheet, a confirm dialog, a toast). Code has already
 * worked out what can be built there (proto/agent/candidates.ts): the model picks, orders and
 * words those candidates, by id — it never names a layer — and writes what new parts say, in the
 * catalog's components. Code builds, checks and keeps or drops what it wrote.
 */
import { z } from "zod";
import { catalogForPrompt } from "@/design-system/components";
import { screenDefs } from "./schemas";
import { ConnectorsField } from "./research-shared";

type JSONSchema = Record<string, unknown>;

const cap = (n: number) => z.string().max(n);
/** A candidate's id ("c3"), or an ask built from blocks ("f1"). */
const Id = z.string().regex(/^[cf]\d{1,2}$/);
const KINDS = ["sheet", "dialog", "toast", "menu", "bar"] as const;
const ROLES = ["options", "collection", "confirm", "done", "custom"] as const;
const LayerId = z.string().regex(/^l\d{1,3}$/);

/** A candidate as the model reads it. */
export const CandidateIn = z.object({
  id: Id,
  recipe: cap(40),
  name: cap(40),
  what: cap(400),
  needs: z.object({ kind: z.enum(KINDS), role: z.enum(ROLES) }).optional(),
  after: Id.optional(),
  instead: Id.optional(),
  main: z.boolean(),
});

export const ProposeBody = z
  .object({
    stage: z.literal("propose"),
    /** The screen by role and copy (proto/agent/describe.ts). */
    screen: cap(8000),
    candidates: z.array(CandidateIn).max(24),
    /** What the designer asked for, in their words (one ask a line). */
    ask: cap(1200).optional(),
    /** With an ask: the layers it can point at (proto/agent/layers.ts), and their components' names (their props are listed). */
    layers: z.array(z.object({ id: LayerId, what: cap(200) })).max(80).optional(),
    components: z.array(cap(40)).max(40).optional(),
    connectors: ConnectorsField,
  })
  // Something to propose: what code can build, or what the designer asked for.
  .refine((b) => b.candidates.length > 0 || !!b.ask?.trim(), { message: "Nothing to propose", path: ["candidates"] });

export const PartsBody = z.object({
  stage: z.literal("parts"),
  screen: cap(8000),
  platform: z.enum(["mobile", "web", "dashboard", "app"]),
  lang: z.enum(["en", "ar"]),
  dir: z.enum(["ltr", "rtl"]),
  parts: z
    .array(
      z.object({
        candidate: Id,
        kind: z.enum(KINDS),
        role: z.enum(ROLES),
        /** The step as the designer picked it, and what the proposal said the part would hold. */
        label: cap(200),
        plan: cap(400).optional(),
        /** What it's about, written by code (the first item and its price, the action's words). */
        about: cap(800),
        /** A version written before that didn't pass, and why: to fix. */
        previous: cap(12_000).optional(),
        issues: z.array(cap(300)).max(8).optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const PrototypeBody = z.discriminatedUnion("stage", [ProposeBody, PartsBody]);
export type ProposeInput = z.infer<typeof ProposeBody>;
export type PartsInput = z.infer<typeof PartsBody>;

// ---------------------------------------------------------------------------
// Answers

export interface ProposedStep {
  candidate: string;
  label: string;
  why: string;
  recommended: boolean;
  plan: string;
  /** For a step to a page not designed yet: the page's name (absent in older answers). */
  page?: string;
}

export interface ProposedBlock {
  kind: "toggle-look" | "reveal" | "open-part" | "toast";
  on: string;
  target: string;
  look: { prop: string; value: string }[];
  start: "shown" | "hidden" | "";
  text: string;
  part: "sheet" | "dialog" | "menu" | "";
}

export interface ProposedAsk {
  label: string;
  rung: "free-form" | "not-yet";
  reason: string;
  blocks: ProposedBlock[];
}

export interface ProposeResult {
  steps: ProposedStep[];
  asks: ProposedAsk[];
}

export interface WrittenPart {
  candidate: string;
  name: string;
  header: unknown[];
  body: unknown[];
  footer: unknown[];
}

export interface PartsResult {
  parts: WrittenPart[];
}

const str = (description: string): JSONSchema => ({ type: "string", description });
const obj = (properties: Record<string, JSONSchema>, description?: string): JSONSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  ...(description ? { description } : {}),
});

/** What the model may answer when proposing: steps by candidate id (pinned), and what of the ask no candidate covers, built from blocks on layer ids (pinned). */
export function proposeSchema(ids: string[], layerIds: string[] = []): JSONSchema {
  return obj({
    steps: {
      type: "array",
      description: "The candidates worth building, the main path first, in the order a person meets them; max 10. Leave out what doesn't suit the product.",
      items: obj({
        // No candidates (only an ask): the list stays empty, but the schema needs an id to name.
        candidate: { type: "string", enum: ids.length ? ids : ["none"] },
        label: str("What a person does and sees, in plain words for a designer, max 90 characters, e.g. 'Tap a dish to pick its size and extras, then add it'"),
        why: str("Why it's worth it, in one short sentence: what leading products in this domain do, or what the screen is for. max 120 characters"),
        recommended: { type: "boolean", description: "Ticked for the designer when proposed: the main path, and what the market standard expects" },
        plan: str("For a candidate that needs a new part: what it will hold, in one line, in the screen's currency and language (e.g. 'Size: Regular or Large +AED 6.00; extras: garlic +AED 2.00, cheese +AED 3.00; how many'). For a Next page: what that page shows, in one line, the way leading products do it (e.g. 'The dishes added with their options and quantities, delivery fee, total, Checkout'). Empty otherwise"),
        page: str("For a Next page: the page's name as a screen's name, in the screen's language, e.g. 'Basket', 'Checkout', 'Finding your driver'. Empty otherwise"),
      }),
    },
    asks: {
      type: "array",
      description: "What the designer asked for that no candidate covers (empty when nothing was asked, or all of it is covered); max 4",
      items: obj({
        label: str("The ask as a step, max 90 characters"),
        rung: { type: "string", enum: ["free-form", "not-yet"], description: "free-form: it can be built from the building blocks on this screen's layers; not-yet: it needs something this prototype can't do yet (another screen, real data, typing, a gesture, money worked out)" },
        reason: str("For free-form, what it does in one sentence; for not-yet, why not"),
        blocks: {
          type: "array",
          description: "free-form: the building blocks it's made of, in order (max 3); empty for not-yet",
          items: obj({
            kind: { type: "string", enum: ["toggle-look", "reveal", "open-part", "toast"] },
            on: { type: "string", enum: [...layerIds, ""], description: "The layer tapped" },
            target: { type: "string", enum: [...layerIds, ""], description: "reveal: the layer shown or hidden; empty otherwise" },
            look: {
              type: "array",
              description: "toggle-look: props of the tapped layer's component and the values they take while it's on (e.g. variant: brand; label: Following); empty otherwise",
              items: obj({ prop: str("A prop of the component"), value: str("Its value while on, as text (true/false for yes/no props)") }),
            },
            start: { type: "string", enum: ["shown", "hidden", ""], description: "reveal: whether the target shows to begin with; empty otherwise" },
            text: str("toast: what it says (in the screen's language, max 40 characters); open-part: what the part holds; empty otherwise"),
            part: { type: "string", enum: ["sheet", "dialog", "menu", ""], description: "open-part: what opens; empty otherwise" },
          }),
        },
      }),
    },
  });
}

/** What the model may answer when writing parts: each part's spec, in the catalog's components. */
export function partsSchema(ids: string[]): JSONSchema {
  return {
    ...obj({
      parts: {
        type: "array",
        description: "One per part asked for",
        items: obj({
          candidate: { type: "string", enum: ids },
          name: str("Short frame name, e.g. 'Dish options', 'Confirm transfer'"),
          header: { type: "array", items: { $ref: "#/$defs/Node2" } },
          body: { type: "array", items: { $ref: "#/$defs/Node3" } },
          footer: { type: "array", items: { $ref: "#/$defs/Node2" } },
        }),
      },
    }),
    $defs: screenDefs(),
  };
}

// ---------------------------------------------------------------------------
// Prompts

const ROLE_SHAPE: Record<(typeof ROLES)[number], string> = {
  options: `An options sheet for one item (it is reused for every item: code puts the tapped item's title and caption in it).
- header: one TopBar, title the first item's title, leading "close".
- body: first a Text (style "body", tone "secondary") with the item's caption; then 1–3 groups of options, each a Card (tone "surface") titled like "Size · Required", holding 2–5 ListItem rows: trailing "radio" for a group where one is picked (sizes, types), "checkbox" for a group where any are (extras). A row's trailingText is its price as the screen writes money: what it adds with a plus ("+AED 6.00"); the base choice has none. In a required pick-one group, check the usual choice (checked: true), or none to make the person choose.
- footer: one Stack (direction "horizontal", gap "300", align "center") holding a Stepper (value 1) and a Button (variant "primary", fullWidth true) labelled "Add · " and the first item's price exactly as the screen writes it.
Options a person of this product would expect (the market standard), named the way the product does.`,
  collection: `A bar shown over the bottom of the screen once something's been added.
- body: one Button (variant "primary", fullWidth true, an icon like "shopping-bag" or "shopping-cart") labelled with what the list is called and the first item's price as the screen writes money ("View basket · AED 18.00"). header and footer empty.`,
  confirm: `A dialog that asks before the action goes ahead.
- header: one Text (style "title"): the question, repeating what the action names (its object, its amount exactly as the screen writes it), e.g. "Send AED 100.00 to Lina?", "Delete Northwind?".
- body: one Text (style "body", tone "secondary"): what happens next, and whether it can be undone, in one sentence.
- footer: two Buttons (fullWidth true): first the one that goes ahead (variant "danger" for something destructive, else "primary"; the action's verb and object), then one that backs out (variant "tertiary": "Cancel", or "Change" when the person might adjust something).`,
  done: `A toast that says the action is done, then goes on its own.
- body: one Text (style "body-strong"), max 40 characters, saying what happened ("Sent AED 100.00 to Lina", "Ride booked, finding a driver"). header and footer empty.`,
  custom: `What the designer asked a part to hold (its purpose is given), as the kind of part asked for:
- a sheet: header one TopBar (title, leading "close"); body what it holds; footer a primary Button when there's something to do.
- a dialog: header a Text (style "title"); body a Text; footer the Buttons to go ahead and to back out.
- a menu: body a few ListItems (a leadingIcon each).`,
};

/** The catalog's entries for these components (their props), for what a block may change. */
function catalogFor(names: string[]): string {
  return catalogForPrompt()
    .split(/\n(?=- )/)
    .filter((e) => names.includes(e.replace(/^- /, "").split(/[ :[]/)[0]))
    .join("\n");
}

export const PROPOSE_SYSTEM = `You are Qalam AI's prototyper. A designer has a screen and wants it to work like the real product: what tapping does, what opens over it, what updates as they go. Code has worked out everything that can be built on this screen, as candidates with ids (c1, c2…). Propose which to build: pick and order them — the main path first, the way a person meets them — and word each for the designer in plain language. Prefer the market standard: what leading products in this domain do on this kind of screen. Where two candidates are alternatives, propose one. Recommend the main path and what the standard expects; leave out what wouldn't suit the product. For a candidate that needs a new part, say in one line what it will hold, in the screen's language and the way it writes money.
A Next page candidate is where the screen leads on (the basket bar's button, the main action): it goes to a page that isn't designed yet, which the designer can generate later; name that page and say what it shows, as the market does it.
If the designer asked for something, map it onto candidates where you can; whatever no candidate covers goes in "asks". Build what you can of it from blocks on the screen's layers ("free-form"): toggle-look (tapping a layer flips its look: name props of its component and the values they take while on — a layer "in each item" flips per item, like a dish's heart), reveal (tapping one layer shows or hides another), open-part (tapping a layer opens a new sheet, dialog or menu; say in text what it holds), toast (tapping a layer shows a toast saying text). Anything blocks can't do — another screen, typing, a gesture, real data, money worked out — is "not-yet", with the reason.
Point only at candidate ids you were given. Write in the screen's language for anything a person reads in the product; your labels and reasons for the designer are in English.`;

export function partsSystem(): string {
  return `You are Qalam AI's prototyper, writing the parts a screen needs to work: a sheet, a bar, a dialog or a toast. Each part is a frame of its own, built from the design system's components, in the screen's language and direction, and must match the screen: same product, same voice, money written exactly the way the screen writes it (its currency, its digits — Arabic-Indic when the screen uses them — and its separators), and other numbers in the same digits. Code wires each part up by what it finds in it, so follow the shape asked for each part exactly; anything else you add must not get in its way.

Shapes:
${Object.entries(ROLE_SHAPE)
  .map(([role, shape]) => `[${role}] ${shape}`)
  .join("\n\n")}

Components (props in brackets):
${catalogForPrompt()}`;
}

/** What the designer asked for: one line, or a list when they asked for several things. */
function askLine(ask: string | undefined): string {
  const lines = (ask ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "The designer didn't ask for anything in particular.";
  return lines.length === 1 ? `The designer asks: ${lines[0]}` : `The designer asks for:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export function proposeContent(b: ProposeInput): string {
  return [
    b.screen,
    "",
    "Candidates:",
    ...(b.candidates.length
      ? b.candidates.map((c) => `${c.id}: ${c.name} — ${c.what}.${c.needs ? ` Needs a new ${c.needs.kind}.` : ""}${c.after ? ` Only after ${c.after}.` : ""}${c.instead ? ` An alternative to ${c.instead}.` : ""}${c.main ? " On the main path." : ""}`)
      : ["None: code builds nothing on this screen by itself, so steps stays empty. Build what the designer asks from blocks."]),
    "",
    askLine(b.ask),
    ...(b.ask?.trim() && b.layers?.length ? ["", "Layers on the screen, for blocks:", ...b.layers.map((l) => `${l.id}: ${l.what}`)] : []),
    ...(b.ask?.trim() && b.components?.length ? ["", "Their components' props:", catalogFor(b.components)] : []),
  ].join("\n");
}

export function partsContent(b: PartsInput): string {
  return [
    b.screen,
    "",
    `Write these parts (${b.platform}, ${b.lang}, ${b.dir === "rtl" ? "right to left" : "left to right"}):`,
    ...b.parts.map(
      (p) =>
        `- ${p.candidate}: a ${p.kind} [${p.role}] for "${p.label}". ${p.about}${p.plan ? ` It should hold: ${p.plan}` : ""}` +
        (p.issues?.length ? `\n  Your last version didn't pass: ${p.issues.join(" ")} Fix that, and keep what was right.${p.previous ? `\n  It was: ${p.previous}` : ""}` : ""),
    ),
  ].join("\n");
}
