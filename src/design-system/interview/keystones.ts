import type { Inst, ScreenSpec } from "../builders";
import type { Platform } from "../platform";
import { COMPONENTS, COMPONENT_BY_NAME } from "./components";
import type { Domain, ReadBack } from "./knobs";
import { clampSpec, copyFor, initials, scenarios, type Copy } from "./scenarios";

/**
 * The pyramid. Every kind of product has a keystone: its most complex, most characteristic piece
 * (a payments table for finance teams, a booking sheet for a ride app). A keystone is built from
 * smaller components, so shaping those first shapes most of the product: they are the base of the
 * pyramid, ranked by how much of the keystone they make up. Then come the other components the
 * product's screens use, and last the ones it doesn't use yet.
 */

export interface KeystonePart {
  component: string;
  /** Its role in the keystone, in a few words. */
  role: string;
}

export interface Keystone {
  name: string;
  /** Why this is the hardest piece of this kind of product. */
  why: string;
  /** The components it is built from, most of the keystone first. */
  parts: KeystonePart[];
  spec: (c: Copy, platform: Platform) => ScreenSpec;
}

const money = (c: Copy, n: number) => c.money(n);

const tableToolbar = (placeholder: string, action: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "200", align: "center" },
  children: [
    { component: "SearchBar", props: { placeholder } },
    { component: "IconButton", props: { icon: "filter", label: "Filter", variant: "outline" } },
    { component: "IconButton", props: { icon: "download", label: "Export", variant: "outline" } },
    { component: "Button", props: { label: action, variant: "primary", size: "md", icon: "plus" } },
  ],
});

const pager = (text: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "200", align: "center", justify: "between" },
  children: [
    { component: "Text", props: { text, style: "caption", tone: "secondary" } },
    {
      component: "Stack",
      props: { direction: "horizontal", gap: "100" },
      children: [
        { component: "IconButton", props: { icon: "chevron-left", label: "Previous page", variant: "outline" } },
        { component: "IconButton", props: { icon: "chevron-right", label: "Next page", variant: "outline" } },
      ],
    },
  ],
});

/** A dashboard's side navigation: the product's name and its sections. */
const sidebar = (c: Copy, items: [string, string][], active: number): Inst[] => [
  { component: "Text", props: { text: c.brand, style: "headline" } },
  ...items.map(([title, icon], i): Inst => ({ component: "ListItem", props: { title, leadingIcon: icon, ...(i === active ? { trailing: "text", trailingText: "•" } : {}) } })),
];

const KEYSTONES: Record<Domain, Keystone> = {
  "b2b-finance": {
    name: "Payments table",
    why: "Finance teams live in dense tables: search, filters, status and actions on every row.",
    parts: [
      { component: "Table", role: "Rows, header and dividers" },
      { component: "Tag", role: "Status on every row" },
      { component: "ChipGroup", role: "Status filters" },
      { component: "SearchBar", role: "Find a payee or reference" },
      { component: "IconButton", role: "Filter, export and paging" },
      { component: "Button", role: "The main action" },
    ],
    spec: (c, platform) => {
      const rows = [c.people[0], c.places[1], c.people[2], `${c.places[2]} LLC`, c.people[1], c.places[0]].map((p, i) => ({
        cells: platform === "mobile" ? [p, ["Paid", "Pending", "Failed", "Paid", "Scheduled", "Pending"][i], money(c, [18250, 4200, 960, 31780, 2400, 760][i])] : [p, `INV-${2041 + i}`, ["Paid", "Pending", "Failed", "Paid", "Scheduled", "Pending"][i], ["Today", "Tomorrow", "Overdue", "Jun 30", "Jul 02", "Jul 04"][i], money(c, [18250, 4200, 960, 31780, 2400, 760][i])],
      }));
      if (platform === "mobile")
        return {
          name: "Payments table",
          header: [{ component: "TopBar", props: { title: "Payments", leading: "none", trailing: "filter" } }],
          body: [
            { component: "SearchBar", props: { placeholder: "Search payee or reference" } },
            { component: "ChipGroup", props: { chips: ["All", "Pending", "Paid", "Failed"], selected: 1 } },
            { component: "Table", props: { columns: ["Payee", "Status", "Amount"], rows, statusColumn: 1 } },
            pager("1–6 of 284"),
          ],
          footer: [{ component: "Button", props: { label: "New payment", variant: "primary", icon: "plus", fullWidth: true } }],
        };
      return {
        name: "Payments table",
        platform: "dashboard",
        sidebar: sidebar(c, [["Overview", "layout-dashboard"], ["Payments", "arrow-left-right"], ["Approvals", "check-check"], ["Cards", "credit-card"], ["Settings", "settings"]], 1),
        body: [
          { component: "Text", props: { text: "Payments", style: "title-lg" } },
          tableToolbar("Search payee or reference", "New payment"),
          { component: "ChipGroup", props: { chips: ["All", "Pending approval", "Scheduled", "Failed"], selected: 1 } },
          { component: "Table", props: { columns: ["Payee", "Reference", "Status", "Due", "Amount"], rows, statusColumn: 2 } },
          pager("1–6 of 284"),
        ],
      };
    },
  },
  saas: {
    name: "Projects table",
    why: "Work tools are tables and lists of things people own, with status and quick actions.",
    parts: [
      { component: "Table", role: "Rows, header and dividers" },
      { component: "Tag", role: "Status on every row" },
      { component: "Tabs", role: "Views of the same list" },
      { component: "SearchBar", role: "Find a project" },
      { component: "IconButton", role: "Filter, export and paging" },
      { component: "Button", role: "The main action" },
    ],
    spec: (c, platform) => {
      const names = ["Website relaunch", "Q3 planning", "Onboarding flow", "Pricing page", "Mobile app v2", "Help centre"];
      const status = ["On track", "At risk", "Blocked", "Done", "On track", "At risk"];
      const rows = names.map((n, i) => ({ cells: platform === "mobile" ? [n, status[i]] : [n, c.people[i % 3], status[i], ["Jun 28", "Jul 02", "Jul 10", "Jun 14", "Aug 01", "Jul 21"][i]] }));
      if (platform === "mobile")
        return {
          name: "Projects table",
          header: [{ component: "TopBar", props: { title: "Projects", leading: "none", trailing: "plus" } }],
          body: [
            { component: "Tabs", props: { tabs: ["All", "Mine", "Archived"], selected: 0 } },
            { component: "SearchBar", props: { placeholder: "Search projects" } },
            { component: "Table", props: { columns: ["Project", "Status"], rows, statusColumn: 1 } },
            pager("1–6 of 42"),
          ],
          footer: [{ component: "Button", props: { label: "New project", variant: "primary", icon: "plus", fullWidth: true } }],
        };
      return {
        name: "Projects table",
        platform: "dashboard",
        sidebar: sidebar(c, [["Home", "home"], ["Projects", "folder"], ["Inbox", "inbox"], ["Reports", "chart-column"], ["Settings", "settings"]], 1),
        body: [
          { component: "Text", props: { text: "Projects", style: "title-lg" } },
          { component: "Tabs", props: { tabs: ["All", "Mine", "Archived"], selected: 0 } },
          tableToolbar("Search projects", "New project"),
          { component: "Table", props: { columns: ["Project", "Owner", "Status", "Due"], rows, statusColumn: 2 } },
          pager("1–6 of 42"),
        ],
      };
    },
  },
  "consumer-finance": {
    name: "Send money",
    why: "Moving money is the riskiest moment: a form with amounts, a recipient, checks and a clear way back.",
    parts: [
      { component: "TextField", role: "The amount and a note" },
      { component: "Button", role: "Confirm, and a way back" },
      { component: "ListItem", role: "The recipient" },
      { component: "ChipGroup", role: "Quick amounts" },
      { component: "SegmentedControl", role: "Now or later" },
      { component: "InlineAlert", role: "What to check first" },
      { component: "Card", role: "The summary" },
    ],
    spec: (c) => ({
      name: "Send money",
      header: [{ component: "TopBar", props: { title: "Send money", leading: "close" } }],
      body: [
        { component: "Card", props: { tone: "surface" }, children: [{ component: "ListItem", props: { title: c.people[1], subtitle: "Saved recipient · IBAN ••42", avatar: initials(c.people[1]), trailing: "chevron" } }] },
        { component: "TextField", props: { label: "Amount", value: money(c, 25000), error: "That's more than your balance" } },
        { component: "ChipGroup", props: { chips: [money(c, 100), money(c, 500), money(c, 1000)], selected: 1 } },
        { component: "SegmentedControl", props: { options: ["Send now", "Schedule"], selected: 0 } },
        { component: "TextField", props: { label: "Note", placeholder: "What's it for?", helper: "They'll see this" } },
        { component: "InlineAlert", props: { tone: "warning", title: "Check the name", body: "Transfers can't be reversed once they're sent." } },
        { component: "Card", props: { tone: "raised" }, children: [{ component: "SummaryRow", props: { label: "Fee", value: money(c, 0) } }, { component: "SummaryRow", props: { label: "They receive", value: money(c, 500), emphasis: true } }] },
      ],
      footer: [
        { component: "Button", props: { label: "Review transfer", variant: "primary", fullWidth: true } },
        { component: "Button", props: { label: "Cancel", variant: "tertiary", fullWidth: true } },
      ],
    }),
  },
  mobility: {
    name: "Booking sheet",
    why: "Booking happens in one sheet over a map: choose a type, compare options, pay and confirm.",
    parts: [
      { component: "BottomSheet", role: "The surface everything sits on" },
      { component: "ListItem", role: "Each ride option and the payment" },
      { component: "SegmentedControl", role: "Ride types" },
      { component: "Button", role: "Confirm the booking" },
      { component: "Tag", role: "Arrival times and offers" },
      { component: "TopBar", role: "Where to, and back" },
    ],
    spec: (c) => ({
      name: "Booking sheet",
      header: [{ component: "TopBar", props: { title: "Where to?", leading: "back", trailing: "share-2" } }],
      body: [{ component: "MapPlaceholder", props: { height: 300, pin: c.places[0], eta: "4 min", fullBleed: true } }],
      footer: [
        {
          component: "BottomSheet",
          props: { title: "Choose a ride" },
          children: [
            { component: "SegmentedControl", props: { options: ["Economy", "Comfort", "Van"], selected: 0 } },
            { component: "ListItem", props: { title: `${c.brand} Go`, subtitle: "4 min away · 4 seats", leadingIcon: "car", trailing: "text", trailingText: money(c, 23) } },
            { component: "ListItem", props: { title: `${c.brand} Saver`, subtitle: "9 min away · shared", leadingIcon: "users", trailing: "text", trailingText: money(c, 16) } },
            { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [{ component: "Tag", props: { label: "Fastest", tone: "success" } }, { component: "Tag", props: { label: "10% off", tone: "promo" } }] },
            { component: "ListItem", props: { title: "Visa •••• 6411", subtitle: "Payment", leadingIcon: "credit-card", trailing: "chevron" } },
            { component: "Button", props: { label: "Confirm pickup", variant: "primary", fullWidth: true } },
          ],
        },
      ],
    }),
  },
  commerce: {
    name: "Product listing",
    why: "Shopping is browsing: filters, product cards with prices and offers, and a quick way to add.",
    parts: [
      { component: "Card", role: "Each product" },
      { component: "Button", role: "Add to bag" },
      { component: "Tag", role: "Offers and stock" },
      { component: "ChipGroup", role: "Category filters" },
      { component: "SearchBar", role: "Find a product" },
      { component: "BottomNav", role: "Shop, search, orders" },
    ],
    spec: (c) => ({
      name: "Product listing",
      header: [{ component: "TopBar", props: { title: c.brand, leading: "none", trailing: "shopping-bag" } }],
      body: [
        { component: "SearchBar", props: { placeholder: "Search products and brands" } },
        { component: "ChipGroup", props: { chips: ["All", "New", "Deals", "Home"], selected: 2 } },
        ...[
          ["Linen throw pillow", 89, "20% off"],
          ["Ceramic mug set", 120, "Only 2 left"],
        ].map(([name, price, tag]): Inst => ({
          component: "Card",
          props: { tone: "raised" },
          children: [
            { component: "MediaPlaceholder", props: { height: 120, label: String(name), icon: "image" } },
            { component: "Stack", props: { direction: "horizontal", gap: "200", align: "center", justify: "between" }, children: [{ component: "Text", props: { text: String(name), style: "headline" } }, { component: "Tag", props: { label: String(tag), tone: tag === "20% off" ? "promo" : "warning" } }] },
            { component: "Stack", props: { direction: "horizontal", gap: "200", align: "center", justify: "between" }, children: [{ component: "Text", props: { text: money(c, Number(price)), style: "body-strong" } }, { component: "Button", props: { label: "Add to bag", variant: "secondary", size: "sm", icon: "plus" } }] },
          ],
        })),
      ],
      footer: [{ component: "BottomNav", props: { items: [{ label: "Shop", icon: "home" }, { label: "Search", icon: "search" }, { label: "Orders", icon: "package" }, { label: "Account", icon: "user" }], active: 0 } }],
    }),
  },
  other: {
    name: "Sign-up form",
    why: "Every product starts with a form: fields, choices, errors and one clear way forward.",
    parts: [
      { component: "TextField", role: "Name, email and password" },
      { component: "Button", role: "Create the account, or sign in" },
      { component: "SegmentedControl", role: "Personal or business" },
      { component: "ListItem", role: "Agreeing to the terms" },
      { component: "InlineAlert", role: "Help when something's off" },
      { component: "TopBar", role: "The way back" },
    ],
    spec: (c) => ({
      name: "Sign-up form",
      header: [{ component: "TopBar", props: { title: `Join ${c.brand}`, leading: "back" } }],
      body: [
        { component: "SegmentedControl", props: { options: ["Personal", "Business"], selected: 0 } },
        { component: "TextField", props: { label: "Full name", value: c.people[0] } },
        { component: "TextField", props: { label: "Email", value: `${c.people[0].split(" ")[0].toLowerCase()}@`, error: "Enter a full email address" } },
        { component: "TextField", props: { label: "Password", placeholder: "At least 8 characters", helper: "Use a few words you'll remember" } },
        { component: "ListItem", props: { title: "I agree to the terms", subtitle: "And the privacy notice", trailing: "checkbox", checked: false } },
        { component: "InlineAlert", props: { tone: "info", title: "Your details stay private", body: "We never share them without asking." } },
      ],
      footer: [
        { component: "Button", props: { label: "Create account", variant: "primary", fullWidth: true } },
        { component: "Button", props: { label: "I already have an account", variant: "tertiary", fullWidth: true } },
      ],
    }),
  },
};

export const keystoneFor = (domain: Domain): Keystone => KEYSTONES[domain] ?? KEYSTONES.other;

/** The keystone drawn for this product (its content, its platform). */
export function keystoneSpec(read: Pick<ReadBack, "domain" | "platform" | "slots">): ScreenSpec {
  const k = keystoneFor(read.domain);
  return clampSpec(k.spec(copyFor(read.slots, "en"), read.platform));
}

/** Every component instance in a spec, by name. */
export function countComponents(spec: ScreenSpec): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (list: Inst[] | undefined) => {
    for (const i of list ?? []) {
      out.set(i.component, (out.get(i.component) ?? 0) + 1);
      // A table draws a status tag in every row.
      if (i.component === "Table" && Number(i.props?.statusColumn ?? -1) >= 0) out.set("Tag", (out.get("Tag") ?? 0) + ((i.props?.rows as unknown[]) ?? []).length);
      walk(i.children);
    }
  };
  for (const region of [spec.header, spec.sidebar, spec.hero, spec.body, spec.footer]) walk(region);
  return out;
}

export interface PyramidTier {
  id: "base" | "next" | "later";
  title: string;
  note: string;
  components: string[];
}

/**
 * The pyramid for a product: the keystone's parts first (they make up most of it), then the other
 * components the product's screens use (most used first), then the rest.
 */
export function pyramid(read: Pick<ReadBack, "domain" | "platform" | "scripts" | "slots">): { keystone: Keystone; tiers: PyramidTier[] } {
  const keystone = keystoneFor(read.domain);
  const base = keystone.parts.map((p) => p.component).filter((c) => COMPONENT_BY_NAME.has(c));
  const used = new Map<string, number>();
  for (const s of scenarios(read)) {
    if (s.id === "strip") continue;
    for (const [c, n] of countComponents(s.spec)) used.set(c, (used.get(c) ?? 0) + n);
  }
  const next = [...used.entries()]
    .filter(([c]) => COMPONENT_BY_NAME.has(c) && !base.includes(c))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);
  const later = COMPONENTS.map((c) => c.name).filter((c) => !base.includes(c) && !next.includes(c));
  return {
    keystone,
    tiers: [
      { id: "base", title: `What the ${keystone.name.toLowerCase()} is made of`, note: "Start here: shaping these shapes most of your product.", components: base },
      { id: "next", title: "Also on your screens", note: "The rest of what your product's screens use.", components: next },
      { id: "later", title: "Not on your screens yet", note: "For later, as the product grows.", components: later },
    ].filter((t) => t.components.length) as PyramidTier[],
  };
}
