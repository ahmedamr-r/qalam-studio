import { BUILTIN, isRolePath } from "./resolve";
import { CUSTOM_SPEC, componentKey } from "./custom";

/**
 * Component catalog: the only building blocks the AI (and the Components panel) may use.
 * Character limits are per string and apply to both English and Arabic copy.
 */

export type PropSpec =
  | { type: "string"; maxChars: number; required?: boolean; description?: string }
  | { type: "number"; min?: number; max?: number; required?: boolean; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "enum"; values: string[]; default: string; description?: string }
  | { type: "icon"; required?: boolean; description?: string }
  | { type: "strings"; maxChars: number; maxItems: number; description?: string }
  | { type: "numbers"; maxItems: number; description?: string }
  | { type: "items"; fields: Record<string, PropSpec>; maxItems: number; description?: string }
  /** SVG path data, parsed and bounded in code (svg-path.ts); never checked as copy. */
  | { type: "path"; maxChars: number; description?: string }
  /** A picture: "crop:x,y,w,h" (a box in the source screenshot, cut out by the studio), an "asset:" reference or a data URL. */
  | { type: "image"; required?: boolean; description?: string };

export interface ComponentSpec {
  name: string;
  category: "layout" | "navigation" | "input" | "content" | "feedback" | "commerce";
  description: string;
  props: Record<string, PropSpec>;
  /** Accepts child component instances. */
  container?: boolean;
  /** Example instance used by the Components panel. */
  example: Record<string, unknown>;
  exampleChildren?: { component: string; props: Record<string, unknown> }[];
}

const SPACE = ["0", "100", "200", "300", "400", "500", "600", "800"];
const TEXT_STYLE = ["display", "title-lg", "title", "headline", "body", "body-strong", "label", "caption", "caption-strong"];

/**
 * What a Graphic may paint with: the colour roles every system provides (contract.ts), never a
 * hex value, so artwork re-colours with the screen's system and theme.
 */
export const GRAPHIC_COLORS = ["none", ...BUILTIN.tokens.filter((t) => isRolePath(t.path) && (t.type === "color" || t.type === "gradient")).map((t) => t.path)];
export const GRAPHIC_RADII = ["none", "xs", "sm", "md", "lg", "xl", "pill"];
/** Picture shapes (width:height). */
export const ASPECTS = ["1:1", "4:3", "3:2", "16:9", "21:9", "3:4", "2:3", "9:16"];
/** Width ÷ height of an aspect like "4:3"; undefined when it isn't one. */
export function aspectRatio(v: unknown): number | undefined {
  const m = typeof v === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(v.trim()) : null;
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  return Number.isFinite(r) && r > 0 ? r : undefined;
}

export const CATALOG: ComponentSpec[] = [
  {
    name: "Stack",
    category: "layout",
    description: "Invisible layout container. Vertical or horizontal list of children with token-based gap and padding.",
    container: true,
    props: {
      direction: { type: "enum", values: ["vertical", "horizontal"], default: "vertical" },
      gap: { type: "enum", values: SPACE, default: "300", description: "space.* token" },
      padding: { type: "enum", values: SPACE, default: "0", description: "space.* token" },
      align: { type: "enum", values: ["stretch", "start", "center", "end"], default: "stretch" },
      justify: { type: "enum", values: ["start", "center", "end", "between"], default: "start" },
      background: { type: "enum", values: ["none", "surface", "raised", "brand-subtle"], default: "none" },
      radius: { type: "enum", values: ["none", "md", "lg", "xl"], default: "none" },
    },
    example: { direction: "horizontal", gap: "200", padding: "300", background: "surface", radius: "lg" },
    exampleChildren: [
      { component: "Tag", props: { label: "New", tone: "brand" } },
      { component: "Text", props: { text: "Stack children", style: "body" } },
    ],
  },
  {
    name: "Text",
    category: "content",
    description: "A run of text using a type token.",
    props: {
      text: { type: "string", maxChars: 140, required: true },
      style: { type: "enum", values: TEXT_STYLE, default: "body", description: "type.* token" },
      tone: { type: "enum", values: ["primary", "secondary", "link", "success", "error", "inverse"], default: "primary", description: "text.* token" },
      align: { type: "enum", values: ["start", "center", "end"], default: "start" },
      maxLines: { type: "number", min: 1, max: 6 },
    },
    example: { text: "Where to?", style: "title-lg" },
  },
  {
    name: "TopBar",
    category: "navigation",
    description: "Screen header with optional leading navigation and trailing action.",
    props: {
      title: { type: "string", maxChars: 24 },
      leading: { type: "enum", values: ["back", "close", "menu", "none"], default: "back" },
      trailing: { type: "icon", description: "Optional trailing action icon" },
      trailingVariant: { type: "enum", values: ["outline", "brand", "ghost"], default: "outline", description: "brand: a filled brand button (e.g. a menu)" },
      titleIcon: { type: "icon", description: "A brand mark before the title: the title becomes the product's logo lockup (e.g. a shop icon + 'Shops')" },
      variant: { type: "enum", values: ["default", "brand"], default: "default" },
      scrolled: { type: "boolean", description: "Content has scrolled under it: a solid bar with a hairline, a large title collapsed into the bar" },
    },
    example: { title: "Your order", leading: "back", trailing: "help" },
  },
  {
    name: "SearchBar",
    category: "input",
    description: "Search input with a magnifier (where the system puts it). On a dark header backdrop it turns translucent.",
    props: { placeholder: { type: "string", maxChars: 40, required: true } },
    example: { placeholder: "Search restaurants and dishes" },
  },
  {
    name: "Button",
    category: "input",
    description: "Action button. Primary uses the system's strongest brand fill; secondary, tertiary (text-only) and danger variants. Shape and height come from the system's button recipe.",
    props: {
      label: { type: "string", maxChars: 24, required: true },
      variant: { type: "enum", values: ["primary", "secondary", "tertiary", "danger"], default: "primary" },
      size: { type: "enum", values: ["lg", "md", "sm"], default: "lg" },
      icon: { type: "icon" },
      fullWidth: { type: "boolean" },
      disabled: { type: "boolean", description: "Not available yet (a required choice is missing): drawn muted" },
    },
    example: { label: "Confirm pickup", variant: "primary", size: "lg" },
  },
  {
    name: "IconButton",
    category: "input",
    description: "Square icon-only button (44×44 touch target). Requires an accessible label.",
    props: {
      icon: { type: "icon", required: true },
      label: { type: "string", maxChars: 24, required: true, description: "Accessible name" },
      variant: { type: "enum", values: ["outline", "brand", "ghost"], default: "outline" },
    },
    example: { icon: "share-2", label: "Share", variant: "outline" },
  },
  {
    name: "TextField",
    category: "input",
    description: "Labelled text input with helper or error text.",
    props: {
      label: { type: "string", maxChars: 24, required: true },
      value: { type: "string", maxChars: 40 },
      placeholder: { type: "string", maxChars: 40 },
      helper: { type: "string", maxChars: 60 },
      error: { type: "string", maxChars: 60 },
      icon: { type: "icon" },
    },
    example: { label: "Promo code", placeholder: "Enter code", helper: "Codes are case sensitive" },
  },
  {
    name: "ChipGroup",
    category: "input",
    description: "Horizontal filter chips; one can be selected.",
    props: {
      chips: { type: "strings", maxChars: 18, maxItems: 6 },
      selected: { type: "number", min: -1, max: 5 },
    },
    example: { chips: ["All", "4.5+ rated", "Under 30 min", "Offers"], selected: 0 },
  },
  {
    name: "Tag",
    category: "feedback",
    description: "Small status or promo label.",
    props: {
      label: { type: "string", maxChars: 16, required: true },
      tone: { type: "enum", values: ["brand", "plus", "success", "warning", "error", "info", "neutral", "promo", "member"], default: "neutral", description: "promo: an offer (30% off); member: a membership mark (Plus)" },
    },
    example: { label: "25% off", tone: "plus" },
  },
  {
    name: "Card",
    category: "layout",
    description: "Container for grouped content. Corner radius, border and shadow come from the system's card recipe; tone brand-strong is the system's hero card (a gradient in some systems).",
    container: true,
    props: {
      title: { type: "string", maxChars: 32 },
      tone: { type: "enum", values: ["surface", "raised", "brand-subtle", "brand-strong", "inverse"], default: "raised" },
      padding: { type: "enum", values: ["300", "400", "500"], default: "400" },
      fullBleed: { type: "boolean", description: "Edge to edge, past the side margins, with only its top corners rounded: a band under the header (e.g. a city or account strip)" },
    },
    example: { title: "Trip details", tone: "raised" },
    exampleChildren: [{ component: "ListItem", props: { title: "Pickup", subtitle: "Dubai Marina Mall", leadingIcon: "map-pin" } }],
  },
  {
    name: "ListItem",
    category: "content",
    description: "Row with optional leading icon/avatar, title, subtitle and trailing element.",
    props: {
      title: { type: "string", maxChars: 40, required: true },
      subtitle: { type: "string", maxChars: 60 },
      leadingIcon: { type: "icon" },
      avatar: { type: "string", maxChars: 2, description: "Initials instead of an icon" },
      trailing: { type: "enum", values: ["none", "chevron", "text", "toggle", "checkbox", "radio"], default: "none", description: "checkbox: a pick-any option; radio: a pick-one option (a size, a ride type); trailingText (e.g. a price) shows before either" },
      checked: { type: "boolean", description: "For checkbox and toggle rows" },
      trailingText: { type: "string", maxChars: 14 },
      trailingTone: { type: "enum", values: ["primary", "secondary", "success", "error"], default: "primary", description: "Colour of trailingText: success for money in, error for failures" },
      divider: { type: "boolean" },
    },
    example: { title: "Payment method", subtitle: "Visa •••• 6411", leadingIcon: "credit-card", trailing: "chevron" },
  },
  {
    name: "ServiceGrid",
    category: "navigation",
    description: "Grid of super-app service tiles (Rides, Food, Pay…).",
    props: {
      tiles: {
        type: "items",
        maxItems: 12,
        fields: {
          label: { type: "string", maxChars: 12, required: true },
          icon: { type: "icon", required: true },
          image: { type: "image", description: "An illustration instead of the icon" },
          badge: { type: "string", maxChars: 9 },
        },
      },
      columns: { type: "enum", values: ["3", "4"], default: "4" },
      scroll: { type: "boolean", description: "Two rows that scroll sideways: tiles past the columns run off the end edge and the next one peeks in" },
    },
    example: {
      tiles: [
        { label: "Rides", icon: "car" },
        { label: "Food", icon: "utensils", badge: "50% off" },
        { label: "Groceries", icon: "shopping-bag" },
        { label: "Pay", icon: "wallet" },
      ],
      columns: "4",
    },
  },
  {
    name: "PromoBanner",
    category: "content",
    description: "Promotional banner in the brand colour or one of four accent colours (go, get, eat, pay).",
    props: {
      title: { type: "string", maxChars: 32, required: true },
      subtitle: { type: "string", maxChars: 56 },
      cta: { type: "string", maxChars: 16 },
      tone: { type: "enum", values: ["brand", "go", "get", "eat", "pay"], default: "brand" },
      icon: { type: "icon" },
    },
    example: { title: "Get 25% off your bill", subtitle: "With Lumen Plus", cta: "Learn more", tone: "brand", icon: "percent" },
  },
  {
    name: "ProgressTracker",
    category: "feedback",
    description: "Order or trip progress: a bar with ETA, or a vertical timeline.",
    props: {
      variant: { type: "enum", values: ["bar", "timeline"], default: "bar" },
      title: { type: "string", maxChars: 32, description: "e.g. 'Arrives in 12 min'" },
      steps: { type: "strings", maxChars: 22, maxItems: 5 },
      current: { type: "number", min: 0, max: 4 },
    },
    example: { variant: "bar", title: "Arrives in 12 min", steps: ["Confirmed", "Preparing", "On the way", "Delivered"], current: 2 },
  },
  {
    name: "MapPlaceholder",
    category: "content",
    description: "Stylised map with a route and pin. Use for rides and delivery tracking.",
    props: {
      height: { type: "number", min: 120, max: 420 },
      pin: { type: "string", maxChars: 20 },
      eta: { type: "string", maxChars: 12 },
      fullBleed: { type: "boolean" },
    },
    example: { height: 220, pin: "Your location", eta: "4 min" },
  },
  {
    name: "Avatar",
    category: "content",
    description: "Circular initials avatar.",
    props: { initials: { type: "string", maxChars: 2, required: true }, size: { type: "enum", values: ["sm", "md", "lg"], default: "md" } },
    example: { initials: "AH", size: "md" },
  },
  {
    name: "Divider",
    category: "layout",
    description: "Hairline divider in the system's divider colour and thickness.",
    props: {
      fullBleed: { type: "boolean", description: "Run edge to edge across the screen, past the side margins (between full-width list rows)" },
    },
    example: {},
  },
  {
    name: "BottomSheet",
    category: "layout",
    description: "Sheet anchored to the bottom of the screen with a grabber and rounded top corners. Put it in the footer.",
    container: true,
    props: { title: { type: "string", maxChars: 32 } },
    example: { title: "Choose a ride" },
    exampleChildren: [{ component: "ListItem", props: { title: "Comfort", subtitle: "4 seats · 3 min away", leadingIcon: "car", trailing: "text", trailingText: "AED 32" } }],
  },
  {
    name: "BottomNav",
    category: "navigation",
    description: "App tab bar. Put it in the footer.",
    props: {
      items: { type: "items", maxItems: 5, fields: { label: { type: "string", maxChars: 10, required: true }, icon: { type: "icon", required: true } } },
      active: { type: "number", min: 0, max: 4 },
    },
    example: {
      items: [
        { label: "Home", icon: "home" },
        { label: "Orders", icon: "receipt" },
        { label: "Pay", icon: "wallet" },
        { label: "Account", icon: "user" },
      ],
      active: 0,
    },
  },
  {
    name: "EmptyState",
    category: "feedback",
    description: "Centered illustration icon, title, body and optional action.",
    props: {
      icon: { type: "icon", required: true },
      title: { type: "string", maxChars: 32 },
      body: { type: "string", maxChars: 90, description: "Without a title, the body is the message" },
      cta: { type: "string", maxChars: 20 },
    },
    example: { icon: "receipt", title: "No orders yet", body: "Your past rides and orders will show up here.", cta: "Order food" },
  },
  {
    name: "InlineAlert",
    category: "feedback",
    description: "Inline message for success, warning, error or info.",
    props: {
      tone: { type: "enum", values: ["success", "warning", "error", "info"], default: "info" },
      title: { type: "string", maxChars: 40, required: true },
      body: { type: "string", maxChars: 90 },
    },
    example: { tone: "warning", title: "Heavy traffic", body: "Your captain may take a few extra minutes." },
  },
  {
    name: "MediaPlaceholder",
    category: "content",
    description: "Image slot (restaurant, product, hero). Rendered as a tinted placeholder.",
    props: {
      height: { type: "number", min: 80, max: 320 },
      aspect: { type: "enum", values: ["none", ...ASPECTS], default: "none", description: "Width:height kept at any width, instead of height" },
      label: { type: "string", maxChars: 24 },
      icon: { type: "icon" },
    },
    example: { height: 160, label: "Restaurant cover", icon: "utensils" },
  },
  {
    name: "Image",
    category: "content",
    description:
      "A picture: a product photo, a shop logo, an illustration. When rebuilding a screenshot, point at the picture in it with crop:x,y,w,h (pixels of the screenshot as you see it) and the studio cuts it out; otherwise leave src empty for a placeholder. Not for icons (Icon) or for artwork you draw (Graphic).",
    props: {
      src: { type: "image" },
      alt: { type: "string", maxChars: 40, required: true, description: "What it shows; names the layer and is read by screen readers" },
      width: { type: "number", min: 16, max: 400, description: "Width in px; omit to fill the width" },
      height: { type: "number", min: 16, max: 480, description: "Height in px, when it has no aspect" },
      aspect: { type: "enum", values: ["none", ...ASPECTS], default: "none", description: "Width:height kept at any width (the height follows). Pictures in a row, grid or carousel of the same kind share one" },
      radius: { type: "enum", values: ["none", "sm", "md", "lg", "pill"], default: "none", description: "radius.* token" },
      fit: { type: "enum", values: ["cover", "contain"], default: "cover", description: "contain: the whole picture on the background (logos, illustrations)" },
      background: { type: "enum", values: ["none", "surface", "inverse"], default: "none" },
    },
    example: { alt: "Red velvet cake", height: 160, radius: "md", background: "surface" },
  },
  {
    name: "Icon",
    category: "content",
    description: "One icon on its own, e.g. a chevron after 'Deliver to Dubai' or a star before a rating line. Icons inside other components come with them.",
    props: {
      icon: { type: "icon", required: true },
      size: { type: "enum", values: ["16", "20", "24", "32"], default: "20" },
      tone: { type: "enum", values: ["primary", "secondary", "brand", "inverse", "success", "error", "link"], default: "primary" },
    },
    example: { icon: "chevron-down", size: "20" },
  },
  {
    name: "Stepper",
    category: "input",
    description: "Quantity picker: minus, the count, plus. Put it beside the add-to-cart Button in the footer.",
    props: {
      value: { type: "number", min: 0, max: 99, required: true },
    },
    example: { value: 1 },
  },
  {
    name: "Graphic",
    category: "content",
    description:
      "Artwork the catalog has no component for: a payment card face, a brand or product mark, a simple illustration or diagram, and custom-shaped surfaces (a ticket or coupon with notches, a speech bubble, a tag, a seal). Drawn from shapes in the graphic's own box (x from its start edge, y from its top; later shapes paint on top) and painted only with the system's colour roles, radii, shadows and type, so it follows the system. Shapes combine into one outline (combine: union, subtract, intersect, exclude with the shapes before them) and pin to edges so they follow the graphic's size. fit backdrop makes it the surface behind its container's other parts. Not for photos (MediaPlaceholder) and not for UI the catalog has (buttons, fields, lists, tags, text blocks).",
    props: {
      label: { type: "string", maxChars: 40, required: true, description: "What it shows, e.g. 'Cash Card'; names the layer and is read by screen readers" },
      width: { type: "number", min: 24, max: 1440, description: "The width the shapes are drawn at, px; omit to fill the width (shapes then sit from the start edge)" },
      height: { type: "number", min: 1, max: 900, required: true, description: "The height the shapes are drawn at, px (a rule or tear line can be 1–2)" },
      fit: {
        type: "enum",
        values: ["fixed", "fill", "backdrop"],
        default: "fixed",
        description: "fixed: exactly width × height; fill: stretches to the available width (shapes follow their pins); backdrop: fills its container behind its other parts (a custom-shaped surface; the container's padding and children sit on top)",
      },
      shapes: {
        type: "items",
        maxItems: 24,
        description: "Painted in order",
        fields: {
          kind: { type: "enum", values: ["rect", "ellipse", "polygon", "star", "path", "text", "icon"], default: "rect" },
          x: { type: "number", description: "px from the start edge (not for path)" },
          y: { type: "number", description: "px from the top (not for path)" },
          w: { type: "number", description: "width in px (not for path)" },
          h: { type: "number", description: "height in px (not for path; text sizes to its style)" },
          count: { type: "number", min: 3, max: 12, description: "polygon: sides; star: points" },
          ratio: { type: "number", min: 0.2, max: 0.9, description: "star only: inner radius ÷ outer radius" },
          rotation: { type: "number", min: -180, max: 180, description: "polygon and star: degrees clockwise" },
          combine: {
            type: "enum",
            values: ["none", "union", "subtract", "intersect", "exclude"],
            default: "none",
            description: "joins this shape to the outline of the shapes before it (up to the last one with none), painted with that first shape's colours: union adds it, subtract cuts it out, intersect keeps the overlap, exclude keeps all but the overlap. Rect, ellipse, polygon, star and path only",
          },
          pinX: { type: "enum", values: ["start", "end", "center", "stretch", "scale"], default: "start", description: "when the graphic is wider or narrower than width: stay at the start edge, stay at the end edge, stay centred, stretch with it, or scale with it" },
          pinY: { type: "enum", values: ["top", "bottom", "center", "stretch", "scale"], default: "top", description: "when the graphic is taller or shorter than height (a backdrop follows its container)" },
          centerOn: { type: "number", min: 1, max: 12, description: "backdrop only: centre the shape vertically on this part of the container (1 = its first part after the graphic) wherever layout puts it, so it stays lined up as the content changes, e.g. ticket notches on the tear line" },
          d: { type: "path", maxChars: 1200, description: "path only: SVG path data in the graphic's coordinates (M L H V C S Q T A Z)" },
          fill: { type: "enum", values: GRAPHIC_COLORS, default: "none", description: "colour role; text uses text.* roles, icons icon.* roles" },
          stroke: { type: "enum", values: GRAPHIC_COLORS, default: "none", description: "colour role for the outline" },
          strokeWidth: { type: "number", min: 0, max: 8, description: "outline width in px (default 2 when stroked)" },
          dash: { type: "enum", values: ["solid", "dashed", "dotted"], default: "solid", description: "the outline's dashes (a perforation, a tear line)" },
          shadow: { type: "enum", values: ["none", "sm", "md", "lg"], default: "none", description: "shadow.* token, cast by the filled outline" },
          radius: { type: "enum", values: GRAPHIC_RADII, default: "none", description: "rect corners: radius.* token" },
          text: { type: "string", maxChars: 32, description: "text only" },
          style: { type: "enum", values: TEXT_STYLE, default: "body", description: "text only: type.* token" },
          align: { type: "enum", values: ["start", "center", "end"], default: "start", description: "text only, within w" },
          icon: { type: "icon", description: "icon only" },
        },
      },
    },
    example: {
      label: "Wallet card",
      width: 240,
      height: 150,
      shapes: [
        { kind: "rect", x: 0, y: 0, w: 240, h: 150, fill: "bg.brand-strong", radius: "xl" },
        { kind: "ellipse", x: 150, y: -50, w: 150, h: 150, fill: "bg.brand" },
        { kind: "text", x: 20, y: 18, w: 140, text: "Lumen Pay", style: "body-strong", fill: "text.on-brand-strong" },
        { kind: "rect", x: 20, y: 58, w: 36, h: 26, fill: "bg.brand-subtle", radius: "sm" },
        { kind: "path", d: "M198 110a14 14 0 0 1 20 0M202 116a8 8 0 0 1 12 0", stroke: "icon.on-brand-strong", strokeWidth: 2 },
        { kind: "text", x: 20, y: 110, w: 140, text: "•••• 4821", style: "body", fill: "text.on-brand-strong" },
      ],
    },
  },
  {
    name: "SummaryRow",
    category: "commerce",
    description: "Label/value row for receipts and fares.",
    props: {
      label: { type: "string", maxChars: 28, required: true },
      value: { type: "string", maxChars: 14, required: true },
      emphasis: { type: "boolean" },
    },
    example: { label: "Delivery fee", value: "AED 5.00" },
  },
  {
    name: "Rating",
    category: "content",
    description: "Star rating with count.",
    props: { value: { type: "number", min: 0, max: 5, required: true }, count: { type: "string", maxChars: 20 } },
    example: { value: 4.6, count: "(783 ratings)" },
  },
  {
    name: "SegmentedControl",
    category: "input",
    description: "2–4 mutually exclusive options.",
    props: { options: { type: "strings", maxChars: 14, maxItems: 4 }, selected: { type: "number", min: 0, max: 3 } },
    example: { options: ["Delivery", "Pick-up"], selected: 0 },
  },
  {
    name: "Tabs",
    category: "navigation",
    description: "Tabs that switch between views of the same content (e.g. Active / Scheduled / Past). Up to 3 tabs share the width; 4–5 sit side by side from the start edge.",
    props: {
      tabs: { type: "strings", maxChars: 16, maxItems: 5 },
      selected: { type: "number", min: 0, max: 4 },
    },
    example: { tabs: ["Active", "Scheduled", "Past"], selected: 0 },
  },
  {
    name: "Table",
    category: "content",
    description: "Data table for web and dashboards: a header row and up to 8 rows. Numeric columns align to the end edge; a status column is drawn as tags coloured by meaning (paid, pending, failed…). Put it in a Card with a title.",
    props: {
      columns: { type: "strings", maxChars: 16, maxItems: 5, description: "Column headers" },
      rows: {
        type: "items",
        maxItems: 8,
        fields: { cells: { type: "strings", maxChars: 24, maxItems: 5, description: "One cell per column, in column order" } },
      },
      statusColumn: { type: "number", min: -1, max: 4, description: "Index of the status column, drawn as tags; -1 for none" },
    },
    example: {
      columns: ["Order", "Customer", "Status", "Total"],
      rows: [
        { cells: ["#48213", "Mariam Al Suwaidi", "Delivered", "AED 86.50"] },
        { cells: ["#48212", "Omar Haddad", "Preparing", "AED 42.00"] },
        { cells: ["#48209", "Priya Nair", "Cancelled", "AED 118.25"] },
      ],
      statusColumn: 2,
    },
  },
  {
    name: "Chart",
    category: "content",
    description: "Bar chart: vertical bars over their labels, or horizontal bars with values (rankings, breakdowns). Use real, varied values and highlight the bar the screen is about.",
    props: {
      variant: { type: "enum", values: ["bars", "hbars"], default: "bars" },
      title: { type: "string", maxChars: 32 },
      labels: { type: "strings", maxChars: 10, maxItems: 12, description: "One per bar" },
      values: { type: "numbers", maxItems: 12, description: "One per label, same order" },
      highlight: { type: "number", min: -1, max: 11, description: "Index of the bar to emphasise; -1 for none" },
      unit: { type: "string", maxChars: 6, description: "Shown with values, e.g. 'AED', '%', 'k'" },
      height: { type: "number", min: 120, max: 320, description: "Plot height (vertical bars)" },
    },
    example: { variant: "bars", title: "Orders this week", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], values: [182, 204, 176, 231, 298, 342, 267], highlight: 5, height: 160 },
  },
  {
    name: "Carousel",
    category: "layout",
    description: "Horizontally scrolling row of same-width items (Cards, MediaPlaceholders) with an optional title and a 'See all' link. On phones it runs off the end edge so the next item peeks in. Put it directly in the body.",
    container: true,
    props: {
      title: { type: "string", maxChars: 32 },
      action: { type: "string", maxChars: 14, description: "Link on the end edge, e.g. 'See all'" },
      itemWidth: { type: "number", min: 72, max: 320, description: "Width of each item in px (default 240; 72–96 for avatar chips)" },
      gap: { type: "enum", values: SPACE, default: "300", description: "space.* token" },
    },
    example: { title: "Popular near you", action: "See all", itemWidth: 200 },
    exampleChildren: [
      { component: "MediaPlaceholder", props: { height: 120, label: "Al Mallah", icon: "utensils" } },
      { component: "MediaPlaceholder", props: { height: 120, label: "Operation Falafel", icon: "utensils" } },
      { component: "MediaPlaceholder", props: { height: 120, label: "Salt", icon: "utensils" } },
    ],
  },

  // Desktop tools (editors, creative apps): the pieces a workspace is made of.
  {
    name: "Toolbar",
    category: "input",
    description: "Compact row of icon-only tools people switch between in a desktop app (select, cut, text, crop…); the active tool is highlighted. Put it in the app bar or above a Timeline.",
    props: {
      tools: {
        type: "items",
        maxItems: 10,
        fields: { icon: { type: "icon", required: true }, label: { type: "string", maxChars: 24, required: true, description: "Tool name (tooltip and accessible name)" } },
      },
      selected: { type: "number", min: -1, max: 9, description: "Index of the active tool; -1 for none" },
    },
    example: {
      tools: [
        { icon: "mouse-pointer-2", label: "Select" },
        { icon: "scissors", label: "Split" },
        { icon: "type", label: "Text" },
        { icon: "crop", label: "Crop" },
      ],
      selected: 0,
    },
  },
  {
    name: "Player",
    category: "content",
    description: "Video or animation preview for a desktop app's stage: a dark viewer with what's on screen, and a transport bar (skip, play, time, scrubber, volume, full screen). The stage of a video editor.",
    props: {
      label: { type: "string", maxChars: 32, description: "What the viewer shows, e.g. 'Shot 4 · Harbour at dusk'" },
      current: { type: "string", maxChars: 8, description: "Playhead time, e.g. '00:42'" },
      duration: { type: "string", maxChars: 8, description: "Total length, e.g. '02:30'" },
      progress: { type: "number", min: 0, max: 100, description: "How far the playhead is, in %" },
      height: { type: "number", min: 160, max: 560, description: "Viewer height (default 360)" },
      controls: { type: "enum", values: ["bar", "none"], default: "bar" },
    },
    example: { label: "Shot 4 · Harbour at dusk", current: "00:42", duration: "02:30", progress: 28, height: 240 },
  },
  {
    name: "Timeline",
    category: "content",
    description:
      "Multi-track timeline for video, audio or animation: a time ruler, one lane per track with its clips placed by start and end time (audio clips draw a waveform; text tracks hold titles and captions), and the playhead. Put it in a desktop app's footer. Use real clip names and uneven lengths; times are in seconds.",
    props: {
      duration: { type: "number", min: 1, max: 36000, required: true, description: "Length of the project in seconds" },
      playhead: { type: "number", min: 0, max: 36000, description: "Playhead position in seconds" },
      tracks: {
        type: "items",
        maxItems: 6,
        fields: {
          label: { type: "string", maxChars: 14, required: true, description: "Track name, e.g. 'V1', 'Music'" },
          kind: { type: "enum", values: ["video", "audio", "text", "effect"], default: "video" },
          clips: {
            type: "items",
            maxItems: 8,
            fields: {
              label: { type: "string", maxChars: 20 },
              start: { type: "number", min: 0, max: 36000, required: true, description: "Seconds" },
              end: { type: "number", min: 0, max: 36000, required: true, description: "Seconds, after start" },
              selected: { type: "boolean" },
            },
          },
        },
      },
    },
    example: {
      duration: 150,
      playhead: 42,
      tracks: [
        { label: "Titles", kind: "text", clips: [{ label: "Opening title", start: 2, end: 9 }] },
        { label: "V1", kind: "video", clips: [{ label: "Harbour wide", start: 0, end: 38 }, { label: "Dhow close-up", start: 38, end: 71, selected: true }, { label: "Skyline", start: 71, end: 118 }] },
        { label: "Music", kind: "audio", clips: [{ label: "Oud theme", start: 0, end: 132 }] },
      ],
    },
  },
  {
    name: "Slider",
    category: "input",
    description: "Labelled slider for a continuous value (volume, opacity, speed, zoom) with its current value.",
    props: {
      label: { type: "string", maxChars: 24, required: true },
      value: { type: "number", min: 0, max: 100, required: true, description: "Position along the track, in %" },
      valueText: { type: "string", maxChars: 10, description: "The value as shown, e.g. '72%', '1.5×', '-6 dB'" },
    },
    example: { label: "Opacity", value: 72, valueText: "72%" },
  },
  {
    name: "PropertyRow",
    category: "input",
    description: "Compact label and value row for an inspector panel: plain value, an input field, a select, a stepper or a toggle.",
    props: {
      label: { type: "string", maxChars: 18, required: true },
      value: { type: "string", maxChars: 18, description: "Shown for text, field, select and stepper" },
      control: { type: "enum", values: ["text", "field", "select", "stepper", "toggle"], default: "text" },
      on: { type: "boolean", description: "Toggle state" },
    },
    example: { label: "Frame rate", value: "25 fps", control: "select" },
  },
  {
    name: "Panel",
    category: "layout",
    description: "Fixed-width side panel in a desktop app's workspace (an inspector beside the stage), on the surface colour, with an optional title. Put it after the stage in a horizontal Stack.",
    container: true,
    props: {
      title: { type: "string", maxChars: 24 },
      width: { type: "number", min: 200, max: 480, description: "Width in px (default 300)" },
    },
    example: { title: "Clip", width: 300 },
    exampleChildren: [
      { component: "PropertyRow", props: { label: "Duration", value: "00:33", control: "field" } },
      { component: "Slider", props: { label: "Speed", value: 50, valueText: "1.0×" } },
    ],
  },
];

export const CATALOG_BY_NAME = new Map(CATALOG.map((c) => [c.name, c]));

const TAKEN = new Set([...CATALOG.map((c) => componentKey(c.name)), componentKey(CUSTOM_SPEC.name)]);
/** A made component can't be named like a catalog component ("card" is Card). */
export const isReservedName = (name: string) => TAKEN.has(componentKey(name));
export const COMPONENT_NAMES = CATALOG.map((c) => c.name);

/** Compact, model-friendly description of the catalog for prompts. */
export function catalogForPrompt(): string {
  const fmt = (p: PropSpec): string => {
    switch (p.type) {
      case "string":
        return `string≤${p.maxChars}${p.required ? " (required)" : ""}`;
      case "number":
        return `number${p.min !== undefined ? ` ${p.min}–${p.max}` : ""}${p.required ? " (required)" : ""}`;
      case "boolean":
        return "boolean";
      case "enum":
        return `${p.values.map((v) => JSON.stringify(v)).join("|")} (default ${JSON.stringify(p.default)})`;
      case "icon":
        return `icon${p.required ? " (required)" : ""}`;
      case "strings":
        return `string[] (≤${p.maxItems} items, each ≤${p.maxChars})`;
      case "numbers":
        return `number[] (≤${p.maxItems} items)`;
      case "path":
        return `svg path data≤${p.maxChars}`;
      case "image":
        return `image (crop:x,y,w,h | asset:…)${"required" in p && p.required ? " (required)" : ""}`;
      case "items":
        return `{${Object.entries(p.fields)
          .map(([k, f]) => `${k}: ${fmt(f)}`)
          .join(", ")}}[] (≤${p.maxItems})`;
    }
  };
  return [...CATALOG, CUSTOM_SPEC].map(
    (c) =>
      `- ${c.name}${c.container ? " [container: accepts children]" : ""}: ${c.description}\n` +
      Object.entries(c.props)
        .map(([k, p]) => `    ${k}: ${fmt(p)}${p.description ? ` — ${p.description}` : ""}`)
        .join("\n"),
  ).join("\n");
}
