import type { Inst, ScreenSpec } from "../builders";
import type { Knobs } from "./knobs";
import type { Entry } from "./recipes";

/**
 * Components the designer can shape one by one. Each has a few options of its own (shape, size,
 * style…) on top of the system: an option left on "system" follows the system's knobs; any other
 * value overrides that component's recipe tokens only. Options are tables of token values, so a
 * choice is easy to read here and to test.
 */

export interface ComponentOption {
  id: string;
  label: string;
  /** "system" first: follow the system. */
  values: { value: string; label: string }[];
  /** The token values for a choice (never called with "system"). */
  entries: (value: string, k: Knobs) => Entry[];
}

export interface ShapeableComponent {
  /** Catalog component name (what screens are built from). */
  name: string;
  label: string;
  /** What it is, in a few words. */
  what: string;
  options: ComponentOption[];
  /** The component on its own: its variants and states. */
  sheet: () => ScreenSpec;
}

export const SYSTEM = "system";
const sys = { value: SYSTEM, label: "Follow the system" };
const ref = (p: string) => `{${p}}`;
const alias = (path: string, to: string): Entry => [path, { $value: ref(to) }];
const dim = (path: string, n: number): Entry => [path, { $type: "dimension", $value: `${n}px` }];
const str = (path: string, v: string): Entry => [path, { $type: "string", $value: v }];
const opts = (...list: [string, string][]) => [sys, ...list.map(([value, label]) => ({ value, label }))];

/** Corner choices on a component's radius token. */
function shape(path: string, choices: [string, string, string][]): ComponentOption {
  return { id: "shape", label: "Corners", values: opts(...choices.map(([v, l]) => [v, l] as [string, string])), entries: (v) => [alias(path, choices.find((c) => c[0] === v)![2])] };
}

const header = (title: string, trailing?: string): Inst[] => [{ component: "TopBar", props: { title, leading: "back", ...(trailing ? { trailing } : {}) } }];
const row = (children: Inst[], gap = "200"): Inst => ({ component: "Stack", props: { direction: "horizontal", gap, align: "center" }, children });
const caption = (text: string): Inst => ({ component: "Text", props: { text, style: "caption-strong", tone: "secondary" } });

export const COMPONENTS: ShapeableComponent[] = [
  {
    name: "Button",
    label: "Buttons",
    what: "Every action: primary, secondary, tertiary and destructive",
    options: [
      shape("component.button.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"], ["soft", "Soft", "radius.md"], ["pill", "Pill", "radius.pill"]]),
      {
        id: "size",
        label: "Size",
        values: opts(["compact", "Compact"], ["regular", "Regular"], ["large", "Large"]),
        entries: (v) => {
          const [sm, md, lg] = v === "compact" ? [32, 40, 48] : v === "large" ? [40, 48, 56] : [36, 44, 52];
          return [dim("component.button.height-sm", sm), dim("component.button.height-md", md), dim("component.button.height-lg", lg)];
        },
      },
      {
        id: "secondary",
        label: "Secondary",
        values: opts(["solid", "Quiet fill"], ["tonal", "Brand tint"], ["outline", "Outline"]),
        entries: (v) => [
          alias("component.button.secondary.fill", v === "tonal" ? "bg.brand-subtle" : v === "outline" ? "bg.canvas" : "bg.surface"),
          alias("component.button.secondary.label", v === "tonal" ? "text.link" : "text.primary"),
          alias("component.button.secondary.icon", v === "tonal" ? "icon.brand" : "icon.primary"),
          alias("component.button.secondary.border-width", v === "outline" ? "border-width.default" : "border-width.none"),
        ],
      },
    ],
    sheet: () => ({
      name: "Buttons",
      header: header("Buttons"),
      body: [
        caption("Primary and secondary"),
        row([
          { component: "Button", props: { label: "Continue", variant: "primary", size: "md" } },
          { component: "Button", props: { label: "Not now", variant: "secondary", size: "md" } },
        ]),
        caption("Tertiary and destructive"),
        row([
          { component: "Button", props: { label: "Learn more", variant: "tertiary", size: "md" } },
          { component: "Button", props: { label: "Delete", variant: "danger", size: "md", icon: "trash-2" } },
        ]),
        caption("Sizes"),
        row([
          { component: "Button", props: { label: "Small", variant: "secondary", size: "sm" } },
          { component: "Button", props: { label: "Medium", variant: "secondary", size: "md" } },
        ]),
        { component: "Button", props: { label: "Large, full width", variant: "secondary", size: "lg", icon: "arrow-right", fullWidth: true } },
      ],
      footer: [{ component: "Button", props: { label: "Primary, full width", variant: "primary", fullWidth: true } }],
    }),
  },
  {
    name: "IconButton",
    label: "Icon buttons",
    what: "Compact actions in bars, toolbars and rows",
    options: [
      shape("component.icon-button.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"], ["circle", "Circle", "radius.pill"]]),
      {
        id: "style",
        label: "Style",
        values: opts(["quiet", "Quiet fill"], ["tonal", "Brand tint"], ["outline", "Outline"]),
        entries: (v) => [
          alias("component.icon-button.outline-fill", v === "tonal" ? "bg.brand-subtle" : v === "outline" ? "bg.canvas" : "bg.surface"),
          alias("component.icon-button.icon", v === "tonal" ? "icon.brand" : "icon.primary"),
          alias("component.icon-button.border-width", v === "outline" ? "border-width.default" : "border-width.none"),
        ],
      },
      { id: "size", label: "Size", values: opts(["36", "36px"], ["40", "40px"], ["44", "44px"]), entries: (v) => [dim("component.icon-button.size", Number(v))] },
    ],
    sheet: () => ({
      name: "Icon buttons",
      header: header("Icon buttons", "share-2"),
      body: [
        caption("Outline, brand and ghost"),
        row([
          { component: "IconButton", props: { icon: "heart", label: "Save", variant: "outline" } },
          { component: "IconButton", props: { icon: "plus", label: "Add", variant: "brand" } },
          { component: "IconButton", props: { icon: "more-horizontal", label: "More", variant: "ghost" } },
          { component: "IconButton", props: { icon: "filter", label: "Filter", variant: "outline" } },
        ]),
      ],
    }),
  },
  {
    name: "TextField",
    label: "Text fields",
    what: "Forms: labels, values, help and errors",
    options: [
      shape("component.input.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"], ["soft", "Soft", "radius.md"], ["pill", "Pill", "radius.pill"]]),
      {
        id: "style",
        label: "Style",
        values: opts(["outlined", "Outlined"], ["filled", "Filled"]),
        entries: (v) => [
          alias("component.input.fill", v === "filled" ? "bg.surface" : "bg.canvas"),
          alias("component.input.border-width", v === "filled" ? "border-width.none" : "border-width.default"),
        ],
      },
      { id: "height", label: "Height", values: opts(["40", "Compact"], ["48", "Regular"], ["56", "Large"]), entries: (v) => [dim("component.input.height", Number(v))] },
    ],
    sheet: () => ({
      name: "Text fields",
      header: header("Text fields"),
      body: [
        { component: "TextField", props: { label: "Full name", placeholder: "As on your ID" } },
        { component: "TextField", props: { label: "Email", value: "sara@lumen.app", icon: "mail" } },
        { component: "TextField", props: { label: "Phone", value: "+971 50 12", error: "Enter a full phone number" } },
        { component: "TextField", props: { label: "Referral code", placeholder: "Optional", helper: "From a friend's invite" } },
      ],
    }),
  },
  {
    name: "SearchBar",
    label: "Search",
    what: "Finding things: the search field",
    options: [
      { id: "icon", label: "Icon", values: opts(["start", "Before the text"], ["end", "After the text"]), entries: (v) => [str("component.search.style.icon", v)] },
      { id: "style", label: "Style", values: opts(["field", "Like text fields"], ["filled", "Filled"]), entries: (v) => [alias("component.search.fill", v === "filled" ? "bg.surface" : "component.input.fill")] },
      { id: "height", label: "Height", values: opts(["36", "Compact"], ["44", "Regular"], ["52", "Large"]), entries: (v) => [dim("component.search.height", Number(v))] },
    ],
    sheet: () => ({
      name: "Search",
      header: header("Search"),
      body: [{ component: "SearchBar", props: { placeholder: "Search people, places and more" } }, { component: "SearchBar", props: { placeholder: "Search" } }],
    }),
  },
  {
    name: "ChipGroup",
    label: "Chips",
    what: "Filters and quick choices",
    options: [
      shape("component.chip.radius", [["square", "Square", "radius.xs"], ["rounded", "Rounded", "radius.sm"], ["pill", "Pill", "radius.pill"]]),
      {
        id: "selected",
        label: "Selected",
        values: opts(["solid", "Brand fill"], ["tonal", "Brand tint"], ["inverse", "Dark fill"]),
        entries: (v) => [
          alias("component.chip.selected.fill", v === "tonal" ? "bg.brand-subtle" : v === "inverse" ? "bg.inverse" : "bg.brand-strong"),
          alias("component.chip.selected.label", v === "tonal" ? "text.link" : v === "inverse" ? "text.inverse" : "text.on-brand-strong"),
        ],
      },
      {
        id: "idle",
        label: "Unselected",
        values: opts(["filled", "Filled"], ["outlined", "Outlined"]),
        entries: (v) => [alias("component.chip.fill", v === "outlined" ? "bg.canvas" : "bg.surface"), alias("component.chip.border-width", v === "outlined" ? "border-width.default" : "border-width.none")],
      },
    ],
    sheet: () => ({
      name: "Chips",
      header: header("Chips"),
      body: [
        caption("Filters"),
        { component: "ChipGroup", props: { chips: ["All", "Pending", "Paid", "Failed"], selected: 1 } },
        caption("Quick choices"),
        { component: "ChipGroup", props: { chips: ["Today", "This week", "This month"], selected: 0 } },
      ],
    }),
  },
  {
    name: "Tag",
    label: "Badges and tags",
    what: "Status, counts and labels on other components",
    options: [
      shape("component.tag.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.xs"], ["pill", "Pill", "radius.pill"]]),
      { id: "size", label: "Size", values: opts(["20", "Small"], ["24", "Regular"], ["28", "Large"]), entries: (v) => [dim("component.tag.height", Number(v))] },
    ],
    sheet: () => ({
      name: "Badges and tags",
      header: header("Badges and tags"),
      body: [
        caption("Status"),
        row([
          { component: "Tag", props: { label: "Paid", tone: "success" } },
          { component: "Tag", props: { label: "Pending", tone: "warning" } },
          { component: "Tag", props: { label: "Failed", tone: "error" } },
          { component: "Tag", props: { label: "Info", tone: "info" } },
        ]),
        caption("Labels"),
        row([
          { component: "Tag", props: { label: "New", tone: "brand" } },
          { component: "Tag", props: { label: "Draft", tone: "neutral" } },
          { component: "Tag", props: { label: "20% off", tone: "promo" } },
          { component: "Tag", props: { label: "Member", tone: "member" } },
        ]),
      ],
    }),
  },
  {
    name: "SegmentedControl",
    label: "Segmented controls",
    what: "Switching between a few views",
    options: [
      shape("component.segmented.radius", [["rounded", "Rounded", "radius.sm"], ["soft", "Soft", "radius.md"], ["pill", "Pill", "radius.pill"]]),
      {
        id: "selected",
        label: "Selected",
        values: opts(["raised", "Raised"], ["flat", "Flat"], ["tinted", "Brand tint"]),
        entries: (v) => [
          alias("component.segmented.selected.fill", v === "tinted" ? "bg.brand-subtle" : "bg.surface-raised"),
          alias("component.segmented.selected.shadow", v === "raised" ? "shadow.sm" : "shadow.none"),
        ],
      },
    ],
    sheet: () => ({
      name: "Segmented controls",
      header: header("Segmented controls"),
      body: [
        { component: "SegmentedControl", props: { options: ["Day", "Week", "Month"], selected: 1 } },
        { component: "SegmentedControl", props: { options: ["Delivery", "Pick-up"], selected: 0 } },
      ],
    }),
  },
  {
    name: "Tabs",
    label: "Tabs",
    what: "Sections of one screen",
    options: [
      { id: "indicator", label: "Selected tab", values: opts(["underline", "Underline"], ["pill", "Filled pill"]), entries: (v) => [str("component.tabs.style.indicator", v)] },
      { id: "divider", label: "Divider", values: opts(["shown", "Shown"], ["hidden", "Hidden"]), entries: (v) => [alias("component.tabs.border-width", v === "hidden" ? "border-width.none" : "border-width.hairline")] },
    ],
    sheet: () => ({
      name: "Tabs",
      header: header("Tabs"),
      body: [{ component: "Tabs", props: { tabs: ["Overview", "Activity", "Files"], selected: 0 } }, { component: "Tabs", props: { tabs: ["All", "Unread"], selected: 1 } }],
    }),
  },
  {
    name: "Card",
    label: "Cards",
    what: "Grouped content on a surface",
    options: [
      shape("component.card.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"], ["soft", "Soft", "radius.md"], ["round", "Round", "radius.lg"]]),
      {
        id: "depth",
        label: "Depth",
        values: opts(["flat", "Flat"], ["bordered", "Bordered"], ["raised", "Raised"]),
        entries: (v) => [
          alias("component.card.raised.shadow", v === "raised" ? "shadow.sm" : "shadow.none"),
          alias("component.card.raised.border-width", v === "bordered" ? "border-width.hairline" : "border-width.none"),
          alias("component.card.flat.border-width", v === "bordered" ? "border-width.hairline" : "border-width.none"),
        ],
      },
    ],
    sheet: () => ({
      name: "Cards",
      header: header("Cards"),
      body: [
        { component: "Card", props: { title: "Raised card", tone: "raised" }, children: [{ component: "ListItem", props: { title: "Monthly plan", subtitle: "Renews on the 1st", leadingIcon: "calendar", trailing: "chevron" } }] },
        { component: "Card", props: { title: "Surface card", tone: "surface" }, children: [{ component: "Text", props: { text: "Grouped content sits on the surface colour.", style: "body", tone: "secondary" } }] },
        { component: "Card", props: { title: "Brand card", tone: "brand-subtle" }, children: [{ component: "Text", props: { text: "For highlights and promotions.", style: "body" } }] },
      ],
    }),
  },
  {
    name: "ListItem",
    label: "List rows",
    what: "Rows in lists, settings and menus",
    options: [
      { id: "leading", label: "Icon", values: opts(["contained", "In a shape"], ["bare", "Plain"]), entries: (v) => [str("component.list-item.style.leading", v)] },
      { id: "divider", label: "Dividers", values: opts(["none", "None"], ["full", "Full width"], ["inset", "Inset"]), entries: (v) => [str("component.list-item.style.divider", v)] },
      { id: "chevron", label: "Chevron", values: opts(["hidden", "Hidden"], ["shown", "Shown"]), entries: (v) => [str("component.list-item.style.chevron", v)] },
      { id: "height", label: "Height", values: opts(["48", "Compact"], ["56", "Regular"], ["64", "Comfortable"]), entries: (v) => [dim("component.list-item.min-height", Number(v))] },
    ],
    sheet: () => ({
      name: "List rows",
      header: header("List rows"),
      body: [
        { component: "ListItem", props: { title: "Notifications", subtitle: "Reminders and updates", leadingIcon: "bell", trailing: "chevron" } },
        { component: "ListItem", props: { title: "Face ID", subtitle: "Sign in with your face", leadingIcon: "scan-face", trailing: "toggle", checked: true } },
        { component: "ListItem", props: { title: "Sara Haddad", subtitle: "Transfer · Today", avatar: "SH", trailing: "text", trailingText: "AED 120" } },
        { component: "ListItem", props: { title: "Extra cheese", subtitle: "Add-on", trailing: "checkbox", trailingText: "+AED 4", checked: true } },
      ],
    }),
  },
  {
    name: "Table",
    label: "Tables",
    what: "Rows of data with headers and status",
    options: [
      { id: "rows", label: "Row height", values: opts(["40", "Compact"], ["52", "Regular"], ["60", "Comfortable"]), entries: (v) => [dim("component.table.row-height", Number(v))] },
      { id: "header", label: "Header", values: opts(["filled", "Filled"], ["plain", "Plain"], ["tinted", "Brand tint"]), entries: (v) => [alias("component.table.header-fill", v === "plain" ? "bg.canvas" : v === "tinted" ? "bg.brand-subtle" : "bg.surface")] },
      { id: "dividers", label: "Dividers", values: opts(["subtle", "Subtle"], ["strong", "Strong"], ["none", "None"]), entries: (v) => [alias("component.table.divider", v === "strong" ? "border.default" : v === "none" ? "bg.canvas" : "border.subtle")] },
      shape("component.table.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"]]),
    ],
    sheet: () => ({
      name: "Tables",
      header: header("Tables"),
      body: [
        {
          component: "Table",
          props: {
            columns: ["Payee", "Status", "Amount"],
            rows: [
              { cells: ["Sara Haddad", "Paid", "AED 1,250"] },
              { cells: ["Marina Café", "Pending", "AED 86"] },
              { cells: ["Omar Nasser", "Failed", "AED 420"] },
              { cells: ["Lina Farouk", "Paid", "AED 3,900"] },
            ],
            statusColumn: 1,
          },
        },
      ],
    }),
  },
  {
    name: "InlineAlert",
    label: "Alerts",
    what: "Messages about the screen: success, warnings, errors",
    options: [
      shape("component.alert.radius", [["square", "Square", "radius.none"], ["rounded", "Rounded", "radius.sm"], ["soft", "Soft", "radius.md"]]),
      { id: "border", label: "Border", values: opts(["none", "None"], ["outlined", "Outlined"]), entries: (v) => [alias("component.alert.border-width", v === "outlined" ? "border-width.default" : "border-width.none")] },
    ],
    sheet: () => ({
      name: "Alerts",
      header: header("Alerts"),
      body: (["success", "info", "warning", "error"] as const).map((tone) => ({
        component: "InlineAlert",
        props: { tone, title: { success: "Payment sent", info: "New statement ready", warning: "Card expires soon", error: "Couldn't connect" }[tone], body: "A short line on what happened and what to do next." },
      })),
    }),
  },
  {
    name: "BottomNav",
    label: "Tab bar",
    what: "Top-level destinations at the bottom of the screen",
    options: [
      { id: "placement", label: "Placement", values: opts(["docked", "Docked"], ["floating", "Floating"]), entries: (v) => [str("component.nav-bar.style.placement", v)] },
      { id: "labels", label: "Labels", values: opts(["all", "Every tab"], ["active", "Active tab"], ["none", "Icons only"]), entries: (v) => [str("component.nav-bar.style.labels", v)] },
      { id: "indicator", label: "Active tab", values: opts(["none", "Colour only"], ["pill", "Pill"], ["dot", "Dot"], ["line", "Line"]), entries: (v) => [str("component.nav-bar.style.indicator", v)] },
    ],
    sheet: () => ({
      name: "Tab bar",
      header: header("Tab bar"),
      body: [{ component: "Text", props: { text: "The tab bar sits at the bottom of every top-level screen.", style: "body", tone: "secondary" } }],
      footer: [{ component: "BottomNav", props: { items: [{ label: "Home", icon: "home" }, { label: "Search", icon: "search" }, { label: "Orders", icon: "receipt" }, { label: "Account", icon: "user" }], active: 0 } }],
    }),
  },
  {
    name: "TopBar",
    label: "Top bar",
    what: "The title and actions at the top of a screen",
    options: [
      { id: "title", label: "Title", values: opts(["center", "Centred"], ["start", "At the start"], ["large", "Large, below"]), entries: (v) => [str("component.top-bar.style.title", v)] },
      { id: "divider", label: "Divider", values: opts(["none", "None"], ["hairline", "Hairline"]), entries: (v) => [alias("component.top-bar.border-width", v === "hairline" ? "border-width.hairline" : "border-width.none")] },
    ],
    sheet: () => ({
      name: "Top bar",
      header: [{ component: "TopBar", props: { title: "Account", leading: "back", trailing: "settings" } }],
      body: [{ component: "Text", props: { text: "The top bar holds the screen's title, the way back, and one or two actions.", style: "body", tone: "secondary" } }],
    }),
  },
  {
    name: "BottomSheet",
    label: "Sheets",
    what: "Focused tasks that rise from the bottom",
    options: [shape("component.sheet.radius", [["square", "Square", "radius.sm"], ["soft", "Soft", "radius.lg"], ["round", "Round", "radius.xl"]])],
    sheet: () => ({
      name: "Sheets",
      header: header("Sheets"),
      body: [{ component: "MediaPlaceholder", props: { height: 220, label: "Content behind the sheet", icon: "image" } }],
      footer: [
        {
          component: "BottomSheet",
          props: { title: "Choose a plan" },
          children: [
            { component: "ListItem", props: { title: "Monthly", subtitle: "Cancel any time", leadingIcon: "calendar", trailing: "text", trailingText: "AED 29" } },
            { component: "Button", props: { label: "Continue", variant: "primary", fullWidth: true } },
          ],
        },
      ],
    }),
  },
];

export const COMPONENT_BY_NAME = new Map(COMPONENTS.map((c) => [c.name, c]));

/** The token overrides the knobs' component choices make (applied over the system's recipes). */
export function overrideEntries(k: Knobs): Entry[] {
  const out: Entry[] = [];
  for (const [name, choices] of Object.entries(k.components ?? {})) {
    const c = COMPONENT_BY_NAME.get(name);
    if (!c) continue;
    for (const o of c.options) {
      const v = choices[o.id];
      if (v && v !== SYSTEM && o.values.some((x) => x.value === v)) out.push(...o.entries(v, k));
    }
  }
  return out;
}

/** How many of a component's options differ from the system. */
export const customised = (k: Knobs, name: string) => Object.values(k.components?.[name] ?? {}).filter((v) => v && v !== SYSTEM).length;

/** The knobs with one component option set ("system" clears it). */
export function withComponentChoice(k: Knobs, name: string, option: string, value: string): Knobs {
  const current = { ...(k.components?.[name] ?? {}) };
  if (value === SYSTEM) delete current[option];
  else current[option] = value;
  const components = { ...(k.components ?? {}) };
  if (Object.keys(current).length) components[name] = current;
  else delete components[name];
  const next: Knobs = { ...k, components };
  if (!Object.keys(components).length) delete next.components;
  return next;
}
