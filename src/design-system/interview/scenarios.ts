import type { Inst, ScreenSpec } from "../builders";
import { CATALOG_BY_NAME } from "../components";
import type { Domain, ReadBack, Slots } from "./knobs";

/**
 * The screens the interview previews a system on: for each kind of product, a hero screen and two
 * "stress" screens that exercise many tokens at once (a form with errors, dense lists and tables,
 * an empty state, a sheet). Content comes from the brief (brand, currency, names), so the screens
 * read like the product; they stay fixed while knobs change, so every change is the system's.
 */

export interface Copy {
  brand: string;
  currency: string;
  city: string;
  people: string[];
  places: string[];
  lang: "en" | "ar";
  /** English or Arabic copy, by the screen's language. */
  t: (en: string, ar: string) => string;
  money: (n: number, sign?: "+" | "-") => string;
}

type Builder = (c: Copy) => ScreenSpec;

/** The product's screens, plus the components step's keystone and one sheet per component. */
export type ScenarioId = "hero" | "stress1" | "stress2" | "dashboard" | "rtl" | "strip" | "keystone" | `component:${string}`;
export interface Scenario {
  id: ScenarioId;
  label: string;
  spec: ScreenSpec;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

const nav = (c: Copy, items: [string, string, string][], active = 0): Inst => ({
  component: "BottomNav",
  props: { items: items.map(([en, ar, icon]) => ({ label: c.t(en, ar), icon })), active },
});

// ---------------------------------------------------------------------------
// Finance for people

const consumerFinance: { hero: Builder; stress: [Builder, Builder] } = {
  hero: (c) => ({
    name: c.t("Home", "الرئيسية"),
    header: [{ component: "TopBar", props: { title: c.brand, leading: "none", trailing: "bell" } }],
    body: [
      {
        component: "Card",
        props: { tone: "raised" },
        children: [
          { component: "Text", props: { text: c.t("Total balance", "الرصيد الإجمالي"), style: "caption", tone: "secondary" } },
          { component: "Text", props: { text: c.money(12480.5), style: "title-lg" } },
          {
            component: "Stack",
            props: { direction: "horizontal", gap: "300" },
            children: [
              { component: "Button", props: { label: c.t("Add money", "إضافة أموال"), variant: "primary", size: "md", icon: "plus", fullWidth: true } },
              { component: "Button", props: { label: c.t("Send", "تحويل"), variant: "secondary", size: "md", icon: "send", fullWidth: true } },
            ],
          },
        ],
      },
      { component: "SegmentedControl", props: { options: [c.t("Activity", "النشاط"), c.t("Insights", "التحليلات")], selected: 0 } },
      {
        component: "Card",
        props: { title: c.t("Today", "اليوم"), tone: "surface" },
        children: [
          { component: "ListItem", props: { title: c.people[0], subtitle: c.t("Transfer", "تحويل"), avatar: initials(c.people[0]), trailing: "text", trailingText: c.money(120, "-") } },
          { component: "ListItem", props: { title: c.t("Salary", "الراتب"), subtitle: c.t("Monthly", "شهري"), leadingIcon: "briefcase", trailing: "text", trailingText: c.money(9500, "+"), trailingTone: "success" } },
          { component: "ListItem", props: { title: c.places[0], subtitle: c.t("Card payment", "دفع بالبطاقة"), leadingIcon: "shopping-bag", trailing: "text", trailingText: c.money(64.25, "-") } },
        ],
      },
    ],
    footer: [nav(c, [["Home", "الرئيسية", "home"], ["Cards", "البطاقات", "credit-card"], ["Pay", "الدفع", "wallet"], ["Profile", "الحساب", "user"]])],
  }),
  stress: [
    (c) => ({
      name: "Send money",
      header: [{ component: "TopBar", props: { title: "Send money", leading: "back" } }],
      body: [
        { component: "TextField", props: { label: "To", value: c.people[1], icon: "user" } },
        { component: "TextField", props: { label: "Amount", value: c.money(25000), error: "That's more than your balance" } },
        { component: "ChipGroup", props: { chips: [c.money(100), c.money(500), c.money(1000)], selected: 1 } },
        { component: "InlineAlert", props: { tone: "warning", title: "Check the name", body: "Transfers can't be reversed once they're sent." } },
        {
          component: "Card",
          props: { tone: "surface" },
          children: [
            { component: "SummaryRow", props: { label: "Fee", value: c.money(0) } },
            { component: "SummaryRow", props: { label: "Arrives", value: "Instantly" } },
          ],
        },
      ],
      footer: [
        { component: "Button", props: { label: "Review transfer", variant: "primary", fullWidth: true } },
        { component: "Button", props: { label: "Cancel", variant: "tertiary", fullWidth: true } },
      ],
    }),
    (c) => ({
      name: "Settings",
      header: [{ component: "TopBar", props: { title: "Security", leading: "back" } }],
      body: [
        { component: "Tabs", props: { tabs: ["Security", "Limits", "Devices"], selected: 0 } },
        { component: "ListItem", props: { title: "Face ID", subtitle: "Sign in with your face", leadingIcon: "scan-face", trailing: "toggle", checked: true, divider: true } },
        { component: "ListItem", props: { title: "Card freeze", subtitle: "Pause all card payments", leadingIcon: "snowflake", trailing: "toggle", checked: false, divider: true } },
        { component: "ListItem", props: { title: "Change PIN", leadingIcon: "key-round", trailing: "chevron" } },
        { component: "EmptyState", props: { icon: "smartphone", title: "No other devices", body: `You're only signed in to ${c.brand} on this phone.` } },
        { component: "Button", props: { label: "Close account", variant: "danger", size: "md" } },
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Finance for businesses

const PAYEES = (c: Copy) => [c.people[0], c.places[1], c.people[2], `${c.places[2]} LLC`];

const b2bFinance: { hero: Builder; stress: [Builder, Builder]; dashboard: Builder } = {
  hero: (c) => ({
    name: c.t("Payments", "المدفوعات"),
    header: [{ component: "TopBar", props: { title: c.t("Payments", "المدفوعات"), leading: "none", trailing: "filter" } }],
    body: [
      { component: "SegmentedControl", props: { options: [c.t("Outgoing", "الصادرة"), c.t("Incoming", "الواردة"), c.t("Scheduled", "المجدولة")], selected: 0 } },
      { component: "Chart", props: { variant: "bars", title: c.t("This week", "هذا الأسبوع"), labels: ["M", "T", "W", "T", "F"], values: [42, 58, 31, 77, 64], highlight: 3, unit: "k" } },
      {
        component: "Table",
        props: {
          columns: [c.t("Payee", "المستفيد"), c.t("Status", "الحالة"), c.t("Amount", "المبلغ")],
          rows: PAYEES(c).map((p, i) => ({ cells: [p, [c.t("Paid", "مدفوع"), c.t("Pending", "قيد الانتظار"), c.t("Failed", "فشل"), c.t("Paid", "مدفوع")][i], c.money([18250, 4200, 960, 31780][i])] })),
          statusColumn: 1,
        },
      },
    ],
    footer: [{ component: "Button", props: { label: c.t("New payment", "دفعة جديدة"), variant: "primary", icon: "plus", fullWidth: true } }],
  }),
  stress: [
    (c) => ({
      name: "Approve payment",
      header: [{ component: "TopBar", props: { title: "Approve payment", leading: "close" } }],
      body: [
        { component: "InlineAlert", props: { tone: "error", title: "IBAN doesn't match the payee", body: "Check the account details before you approve." } },
        { component: "TextField", props: { label: "Payee", value: `${c.places[2]} LLC` } },
        { component: "TextField", props: { label: "IBAN", value: "AE07 0331 2345 6789", error: "Doesn't match this payee" } },
        { component: "TextField", props: { label: "Reference", placeholder: "Invoice number", helper: "Shown on their statement" } },
        { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [{ component: "Tag", props: { label: "Needs 2 approvals", tone: "warning" } }, { component: "Tag", props: { label: "Vendor", tone: "neutral" } }] },
        { component: "Card", props: { tone: "surface" }, children: [{ component: "SummaryRow", props: { label: "Amount", value: c.money(31780), emphasis: true } }] },
      ],
      footer: [
        { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [
          { component: "Button", props: { label: "Reject", variant: "danger", size: "md", fullWidth: true } },
          { component: "Button", props: { label: "Approve", variant: "primary", size: "md", fullWidth: true } },
        ] },
      ],
    }),
    (c) => ({
      name: "Team",
      header: [{ component: "TopBar", props: { title: "Team", leading: "back", trailing: "user-plus" } }],
      body: [
        { component: "SearchBar", props: { placeholder: "Search people" } },
        { component: "ChipGroup", props: { chips: ["All", "Admins", "Approvers", "Viewers"], selected: 0 } },
        ...c.people.slice(0, 3).map((p, i): Inst => ({ component: "ListItem", props: { title: p, subtitle: ["Admin · Finance", "Approver · Operations", "Viewer · Sales"][i], avatar: initials(p), trailing: "chevron", divider: true } })),
        { component: "ListItem", props: { title: "Require two approvers", subtitle: `Payments over ${c.money(10000)}`, trailing: "toggle", checked: true } },
      ],
    }),
  ],
  dashboard: (c) => ({
    name: "Overview",
    platform: "dashboard",
    sidebar: [
      { component: "Text", props: { text: c.brand, style: "headline" } },
      ...[["Overview", "layout-dashboard"], ["Payments", "arrow-left-right"], ["Cards", "credit-card"], ["Team", "users"], ["Settings", "settings"]].map(([t, icon], i): Inst => ({ component: "ListItem", props: { title: t, leadingIcon: icon, trailing: "none" } })),
    ],
    body: [
      { component: "Text", props: { text: "Overview", style: "title-lg" } },
      {
        component: "Stack",
        props: { direction: "horizontal", gap: "400" },
        children: [
          { component: "Card", props: { title: "Cash", tone: "raised" }, children: [{ component: "Text", props: { text: c.money(482900), style: "title" } }, { component: "Tag", props: { label: "+4.2% this month", tone: "success" } }] },
          { component: "Card", props: { title: "Outgoing", tone: "raised" }, children: [{ component: "Text", props: { text: c.money(96340), style: "title" } }, { component: "Tag", props: { label: "12 pending", tone: "warning" } }] },
          { component: "Card", props: { title: "Incoming", tone: "raised" }, children: [{ component: "Text", props: { text: c.money(131050), style: "title" } }, { component: "Tag", props: { label: "On track", tone: "info" } }] },
        ],
      },
      { component: "Chart", props: { variant: "bars", title: "Cash flow", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], values: [320, 360, 340, 410, 455, 483], unit: "k" } },
      {
        component: "Table",
        props: { columns: ["Payee", "Status", "Due", "Amount"], rows: PAYEES(c).map((p, i) => ({ cells: [p, ["Paid", "Pending", "Failed", "Scheduled"][i], ["Today", "Tomorrow", "Overdue", "Jun 30"][i], c.money([18250, 4200, 960, 31780][i])] })), statusColumn: 1 },
      },
    ],
  }),
};

// ---------------------------------------------------------------------------
// Mobility and delivery

const mobility: { hero: Builder; stress: [Builder, Builder] } = {
  hero: (c) => ({
    name: c.t("Book a ride", "احجز رحلة"),
    header: [{ component: "TopBar", props: { title: c.t("Where to?", "إلى أين؟"), leading: "back" } }],
    body: [{ component: "MapPlaceholder", props: { height: 330, pin: c.places[0], eta: c.t("4 min", "٤ د"), fullBleed: true } }],
    footer: [
      {
        component: "BottomSheet",
        props: {},
        children: [
          { component: "SegmentedControl", props: { options: [c.t("Economy", "اقتصادي"), c.t("Comfort", "مريح"), c.t("Van", "عائلي")], selected: 0 } },
          { component: "ListItem", props: { title: `${c.brand} ${c.t("Go", "جو")}`, subtitle: c.t("4 min away · 4 seats", "على بعد ٤ د · ٤ مقاعد"), leadingIcon: "car", trailing: "text", trailingText: c.money(23) } },
          { component: "ListItem", props: { title: c.t("Pay with card", "الدفع بالبطاقة"), subtitle: "Visa •••• 6411", leadingIcon: "credit-card", trailing: "chevron" } },
          { component: "Button", props: { label: c.t("Confirm pickup", "تأكيد الالتقاط"), variant: "primary", fullWidth: true } },
        ],
      },
    ],
  }),
  stress: [
    (c) => ({
      name: "On the way",
      header: [{ component: "TopBar", props: { title: "Your ride", leading: "close", trailing: "share-2" } }],
      body: [
        { component: "ProgressTracker", props: { variant: "bar", title: "Arriving in 3 min", steps: ["Confirmed", "On the way", "Arrived", "Trip"], current: 1 } },
        { component: "InlineAlert", props: { tone: "info", title: "Meet at the main entrance", body: `${c.people[1]} can't stop on the service road.` } },
        { component: "Card", props: { tone: "raised" }, children: [
          { component: "ListItem", props: { title: c.people[1], subtitle: "Toyota Camry · Dubai N 48213", avatar: initials(c.people[1]), trailing: "text", trailingText: "4.9 rating" } },
          { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [
            { component: "Button", props: { label: "Call", variant: "secondary", size: "md", icon: "phone", fullWidth: true } },
            { component: "Button", props: { label: "Message", variant: "secondary", size: "md", icon: "message-circle", fullWidth: true } },
          ] },
        ] },
        { component: "Button", props: { label: "Cancel ride", variant: "danger", size: "md" } },
      ],
    }),
    (c) => ({
      name: "Rate your trip",
      header: [{ component: "TopBar", props: { title: "Trip receipt", leading: "close" } }],
      body: [
        { component: "Rating", props: { value: 4, count: `How was ${c.people[1].split(" ")[0]}?` } },
        { component: "ChipGroup", props: { chips: ["Clean car", "Great route", "Friendly"], selected: 1 } },
        { component: "TextField", props: { label: "Tip", value: c.money(150), error: "Tips are up to 50% of the fare" } },
        { component: "Card", props: { title: "Fare", tone: "surface" }, children: [
          { component: "SummaryRow", props: { label: "Trip", value: c.money(21) } },
          { component: "SummaryRow", props: { label: "Booking fee", value: c.money(2) } },
          { component: "Divider", props: {} },
          { component: "SummaryRow", props: { label: "Total", value: c.money(23), emphasis: true } },
        ] },
      ],
      footer: [{ component: "Button", props: { label: "Done", variant: "primary", fullWidth: true } }],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Shopping and commerce

const commerce: { hero: Builder; stress: [Builder, Builder] } = {
  hero: (c) => ({
    name: c.t("Shop", "التسوق"),
    header: [{ component: "TopBar", props: { title: c.brand, leading: "none", trailing: "shopping-cart" } }],
    body: [
      { component: "SearchBar", props: { placeholder: c.t("Search products and brands", "ابحث عن المنتجات والعلامات") } },
      { component: "ChipGroup", props: { chips: [c.t("All", "الكل"), c.t("New", "جديد"), c.t("Deals", "عروض"), c.t("Home", "المنزل")], selected: 0 } },
      { component: "PromoBanner", props: { title: c.t("20% off your first order", "خصم ٢٠٪ على طلبك الأول"), subtitle: c.t("On orders over ", "على الطلبات فوق ") + c.money(100), cta: c.t("Shop now", "تسوق الآن"), tone: "brand", icon: "percent" } },
      { component: "ListItem", props: { title: c.t("Linen throw pillow", "وسادة كتان"), subtitle: c.t("Sand · In stock", "رملي · متوفر"), leadingIcon: "sofa", trailing: "text", trailingText: c.money(89) } },
      { component: "ListItem", props: { title: c.t("Ceramic mug set", "طقم أكواب خزف"), subtitle: c.t("4 pieces · Only 2 left", "٤ قطع · بقي ٢"), leadingIcon: "coffee", trailing: "text", trailingText: c.money(120) } },
    ],
    footer: [nav(c, [["Home", "الرئيسية", "home"], ["Search", "البحث", "search"], ["Orders", "الطلبات", "package"], ["Account", "الحساب", "user"]])],
  }),
  stress: [
    (c) => ({
      name: "Checkout",
      header: [{ component: "TopBar", props: { title: "Checkout", leading: "back" } }],
      body: [
        { component: "TextField", props: { label: "Delivery address", value: `${c.places[0]}, ${c.city}`, icon: "map-pin" } },
        { component: "TextField", props: { label: "Phone", value: "+971 50 12", error: "Enter a full phone number" } },
        { component: "ListItem", props: { title: "Visa •••• 6411", subtitle: "Expires 09/28", leadingIcon: "credit-card", trailing: "chevron" } },
        { component: "InlineAlert", props: { tone: "success", title: "Free delivery applied", body: "Your order is over the minimum." } },
        { component: "Card", props: { tone: "surface" }, children: [
          { component: "SummaryRow", props: { label: "Items (3)", value: c.money(298) } },
          { component: "SummaryRow", props: { label: "Discount", value: c.money(59.6, "-") } },
          { component: "Divider", props: {} },
          { component: "SummaryRow", props: { label: "Total", value: c.money(238.4), emphasis: true } },
        ] },
      ],
      footer: [{ component: "Button", props: { label: "Place order", variant: "primary", fullWidth: true } }],
    }),
    (c) => ({
      name: "Orders",
      header: [{ component: "TopBar", props: { title: "Orders", leading: "back" } }],
      body: [
        { component: "Tabs", props: { tabs: ["Active", "Delivered", "Returns"], selected: 2 } },
        { component: "EmptyState", props: { icon: "package-open", title: "No returns", body: `Items from ${c.brand} can be returned within 30 days.`, cta: "Start a return" } },
        { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [{ component: "Tag", props: { label: "Free returns", tone: "success" } }, { component: "Tag", props: { label: "Members", tone: "member" } }] },
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Software tools

const saas: { hero: Builder; stress: [Builder, Builder]; dashboard: Builder } = {
  hero: (c) => ({
    name: c.t("Projects", "المشاريع"),
    header: [{ component: "TopBar", props: { title: c.t("Projects", "المشاريع"), leading: "none", trailing: "plus" } }],
    body: [
      { component: "SearchBar", props: { placeholder: c.t("Search projects", "ابحث في المشاريع") } },
      { component: "Tabs", props: { tabs: [c.t("All", "الكل"), c.t("Mine", "مشاريعي"), c.t("Archived", "المؤرشفة")], selected: 0 } },
      { component: "ListItem", props: { title: c.t("Website relaunch", "إعادة إطلاق الموقع"), subtitle: c.t("12 tasks · Due Friday", "١٢ مهمة · الجمعة"), leadingIcon: "globe", trailing: "chevron", divider: true } },
      { component: "ListItem", props: { title: c.t("Q3 planning", "خطة الربع الثالث"), subtitle: c.t("4 tasks · On track", "٤ مهام · في الموعد"), leadingIcon: "calendar", trailing: "chevron", divider: true } },
      { component: "ListItem", props: { title: c.t("Onboarding flow", "رحلة التسجيل"), subtitle: c.t("Blocked by review", "بانتظار المراجعة"), leadingIcon: "workflow", trailing: "chevron" } },
      { component: "InlineAlert", props: { tone: "warning", title: c.t("2 tasks are overdue", "مهمتان متأخرتان"), body: c.t("Reassign them or move the dates.", "أعد إسنادها أو غيّر مواعيدها.") } },
    ],
    footer: [{ component: "Button", props: { label: c.t("New project", "مشروع جديد"), variant: "primary", icon: "plus", fullWidth: true } }],
  }),
  stress: [
    (c) => ({
      name: "Workspace settings",
      header: [{ component: "TopBar", props: { title: "Settings", leading: "back" } }],
      body: [
        { component: "TextField", props: { label: "Workspace name", value: c.brand } },
        { component: "TextField", props: { label: "Workspace URL", value: `${c.brand.toLowerCase().replace(/\W+/g, "")}.app/team`, error: "That address is taken" } },
        { component: "ListItem", props: { title: "Email digests", subtitle: "A summary every morning", trailing: "toggle", checked: true, divider: true } },
        { component: "ListItem", props: { title: "Two-factor sign-in", subtitle: "Required for admins", trailing: "toggle", checked: false } },
        { component: "Button", props: { label: "Delete workspace", variant: "danger", size: "md" } },
      ],
    }),
    (c) => ({
      name: "Invite your team",
      header: [{ component: "TopBar", props: { title: "Members", leading: "back" } }],
      body: [
        { component: "EmptyState", props: { icon: "users", title: "Just you so far", body: `Invite people to work in ${c.brand} together.` } },
        { component: "TextField", props: { label: "Email", placeholder: "name@company.com", helper: "Separate several with commas" } },
        { component: "ChipGroup", props: { chips: ["Member", "Admin", "Guest"], selected: 0 } },
      ],
      footer: [{ component: "Button", props: { label: "Send invites", variant: "primary", fullWidth: true } }],
    }),
  ],
  dashboard: (c) => ({
    name: "Projects",
    platform: "dashboard",
    sidebar: [
      { component: "Text", props: { text: c.brand, style: "headline" } },
      ...[["Home", "home"], ["Projects", "folder"], ["Inbox", "inbox"], ["Reports", "chart-column"], ["Settings", "settings"]].map(([t, icon]): Inst => ({ component: "ListItem", props: { title: t, leadingIcon: icon } })),
    ],
    body: [
      { component: "Text", props: { text: "Projects", style: "title-lg" } },
      { component: "Tabs", props: { tabs: ["All", "Mine", "Archived"], selected: 0 } },
      { component: "Table", props: { columns: ["Project", "Owner", "Status", "Due"], rows: [
        { cells: ["Website relaunch", c.people[0], "On track", "Jun 28"] },
        { cells: ["Q3 planning", c.people[1], "At risk", "Jul 02"] },
        { cells: ["Onboarding flow", c.people[2], "Blocked", "Jul 10"] },
        { cells: ["Pricing page", c.people[0], "Done", "Jun 14"] },
      ], statusColumn: 2 } },
      { component: "Chart", props: { variant: "bars", title: "Tasks closed", labels: ["W1", "W2", "W3", "W4"], values: [18, 24, 21, 30], highlight: 3 } },
    ],
  }),
};

// ---------------------------------------------------------------------------
// Anything else: a general app

const general: { hero: Builder; stress: [Builder, Builder] } = {
  hero: (c) => ({
    name: c.t("Home", "الرئيسية"),
    header: [{ component: "TopBar", props: { title: c.brand, leading: "none", trailing: "bell" } }],
    body: [
      { component: "SearchBar", props: { placeholder: c.t("Search", "بحث") } },
      { component: "Card", props: { title: c.t("Up next", "التالي"), tone: "raised" }, children: [
        { component: "ListItem", props: { title: c.t("Morning check-in", "متابعة الصباح"), subtitle: `${c.places[0]} · 9:30`, leadingIcon: "calendar", trailing: "chevron" } },
        { component: "Button", props: { label: c.t("Get started", "ابدأ الآن"), variant: "primary", size: "md", fullWidth: true } },
      ] },
      { component: "ChipGroup", props: { chips: [c.t("Today", "اليوم"), c.t("This week", "هذا الأسبوع"), c.t("Later", "لاحقًا")], selected: 0 } },
      { component: "ListItem", props: { title: c.people[0], subtitle: c.t("Shared a file", "شارك ملفًا"), avatar: initials(c.people[0]), trailing: "text", trailingText: "2m" } },
      { component: "ListItem", props: { title: c.people[1], subtitle: c.t("Left a comment", "أضاف تعليقًا"), avatar: initials(c.people[1]), trailing: "text", trailingText: "1h" } },
    ],
    footer: [nav(c, [["Home", "الرئيسية", "home"], ["Explore", "استكشف", "compass"], ["Saved", "المحفوظات", "bookmark"], ["Profile", "الحساب", "user"]])],
  }),
  stress: [
    (c) => ({
      name: "Edit profile",
      header: [{ component: "TopBar", props: { title: "Edit profile", leading: "back" } }],
      body: [
        { component: "TextField", props: { label: "Name", value: c.people[0], icon: "user" } },
        { component: "TextField", props: { label: "Email", value: `${c.people[0].split(" ")[0].toLowerCase()}@`, error: "Enter a full email address" } },
        { component: "TextField", props: { label: "City", value: c.city, helper: `Used to suggest things near you in ${c.city}` } },
        { component: "SegmentedControl", props: { options: ["Beginner", "Regular", "Expert"], selected: 1 } },
        { component: "InlineAlert", props: { tone: "info", title: "Your profile is private", body: "Only you can see your history." } },
      ],
      footer: [
        { component: "Button", props: { label: "Save changes", variant: "primary", fullWidth: true } },
        { component: "Button", props: { label: "Cancel", variant: "tertiary", fullWidth: true } },
      ],
    }),
    (c) => ({
      name: "Notifications",
      header: [{ component: "TopBar", props: { title: "Notifications", leading: "back" } }],
      body: [
        { component: "Tabs", props: { tabs: ["All", "Reminders", "Updates"], selected: 1 } },
        { component: "ListItem", props: { title: "Daily reminder", subtitle: "Every morning at 8:00", leadingIcon: "bell", trailing: "toggle", checked: true, divider: true } },
        { component: "ListItem", props: { title: "Weekly summary", subtitle: "Sundays", leadingIcon: "calendar", trailing: "toggle", checked: false, divider: true } },
        { component: "EmptyState", props: { icon: "bell-off", title: "No reminders yet", body: `Set one and ${c.brand} will nudge you at the right time.`, cta: "Add a reminder" } },
        { component: "Button", props: { label: "Turn all off", variant: "danger", size: "md" } },
      ],
    }),
  ],
};

const PACKS: Record<Domain, { hero: Builder; stress: [Builder, Builder]; dashboard?: Builder }> = {
  "b2b-finance": b2bFinance,
  "consumer-finance": consumerFinance,
  mobility,
  commerce,
  saas,
  other: general,
};

/** Every component the system offers, in one screen: the "living style tile". */
const strip: Builder = () => ({
  name: "Components",
  header: [{ component: "TopBar", props: { title: "Components", leading: "back", trailing: "more-horizontal" } }],
  body: [
    { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [
      { component: "Button", props: { label: "Primary", variant: "primary", size: "md" } },
      { component: "Button", props: { label: "Secondary", variant: "secondary", size: "md" } },
      { component: "IconButton", props: { icon: "heart", label: "Like", variant: "outline" } },
    ] },
    { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [
      { component: "Button", props: { label: "Tertiary", variant: "tertiary", size: "sm" } },
      { component: "Button", props: { label: "Delete", variant: "danger", size: "sm" } },
    ] },
    { component: "TextField", props: { label: "Email", value: "sara@lumen", error: "Enter a full email address" } },
    { component: "SearchBar", props: { placeholder: "Search" } },
    { component: "SegmentedControl", props: { options: ["Day", "Week", "Month"], selected: 1 } },
    { component: "ChipGroup", props: { chips: ["All", "Active", "Archived"], selected: 1 } },
    { component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [
      { component: "Tag", props: { label: "New", tone: "brand" } },
      { component: "Tag", props: { label: "Paid", tone: "success" } },
      { component: "Tag", props: { label: "Pending", tone: "warning" } },
      { component: "Tag", props: { label: "Failed", tone: "error" } },
    ] },
    { component: "Card", props: { title: "Card", tone: "raised" }, children: [{ component: "ListItem", props: { title: "List item", subtitle: "Supporting text", leadingIcon: "star", trailing: "chevron" } }] },
    { component: "InlineAlert", props: { tone: "success", title: "Saved", body: "Your changes are live." } },
    { component: "Tabs", props: { tabs: ["Overview", "Activity", "Files"], selected: 0 } },
  ],
});

// ---------------------------------------------------------------------------

export function copyFor(slots: Slots, lang: "en" | "ar"): Copy {
  const ar = lang === "ar" && slots.ar ? slots.ar : null;
  const people = (ar?.people.length ? ar.people : slots.people).concat(["Sara Haddad", "Omar Nasser", "Lina Farouk"]).slice(0, 3);
  const places = slots.places.concat(["Marina", "Downtown", "Business Bay"]).slice(0, 3);
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return {
    brand: ar?.brand || slots.brand || "Lumen",
    currency: slots.currency,
    city: ar?.city || slots.city,
    people,
    places,
    lang,
    t: (en, arText) => (lang === "ar" ? arText : en),
    money: (n, sign) => `${sign === "-" ? "−" : sign === "+" ? "+" : ""}${slots.currency} ${fmt.format(n)}`,
  };
}

/** Trim every string to what its component allows (brand names and places can be long). */
export function clampProps(inst: Inst): Inst {
  const spec = CATALOG_BY_NAME.get(inst.component);
  const props = { ...(inst.props ?? {}) };
  for (const [name, p] of Object.entries(spec?.props ?? {})) {
    const v = props[name];
    const max = (p as { maxChars?: number }).maxChars;
    if (typeof v === "string" && max) props[name] = v.slice(0, max);
    else if (Array.isArray(v) && max && (p as { type: string }).type === "strings") props[name] = v.map((x) => (typeof x === "string" ? x.slice(0, max) : x));
    else if (Array.isArray(v) && (p as { type: string }).type === "items") {
      const fields = (p as { fields?: Record<string, { type: string; maxChars?: number }> }).fields ?? {};
      props[name] = v.map((item) => {
        const out = { ...(item as Record<string, unknown>) };
        for (const [f, fs] of Object.entries(fields)) {
          const fv = out[f];
          if (typeof fv === "string" && fs.maxChars) out[f] = fv.slice(0, fs.maxChars);
          else if (Array.isArray(fv) && fs.maxChars) out[f] = fv.map((x) => (typeof x === "string" ? x.slice(0, fs.maxChars) : x));
        }
        return out;
      });
    }
  }
  return { ...inst, props, ...(inst.children ? { children: inst.children.map(clampProps) } : {}) };
}

export const clampSpec = (s: ScreenSpec): ScreenSpec => ({
  ...s,
  ...(s.header ? { header: s.header.map(clampProps) } : {}),
  ...(s.sidebar ? { sidebar: s.sidebar.map(clampProps) } : {}),
  ...(s.hero ? { hero: s.hero.map(clampProps) } : {}),
  body: s.body.map(clampProps),
  ...(s.footer ? { footer: s.footer.map(clampProps) } : {}),
});

/** The preview screens for a brief: hero, two stress screens, a dashboard for desktop tools, the hero in Arabic when the product needs it, and the component tile. */
export function scenarios(read: Pick<ReadBack, "domain" | "platform" | "scripts" | "slots">): Scenario[] {
  const pack = PACKS[read.domain] ?? general;
  const en = copyFor(read.slots, "en");
  const out: Scenario[] = [
    { id: "hero", label: "Home", spec: clampSpec(pack.hero(en)) },
    { id: "stress1", label: pack.stress[0](en).name, spec: clampSpec(pack.stress[0](en)) },
    { id: "stress2", label: pack.stress[1](en).name, spec: clampSpec(pack.stress[1](en)) },
  ];
  if (pack.dashboard && read.platform !== "mobile") out.splice(1, 0, { id: "dashboard", label: "Desktop", spec: clampSpec(pack.dashboard(en)) });
  if (read.scripts.includes("arabic")) {
    const ar = copyFor(read.slots, "ar");
    out.push({ id: "rtl", label: "العربية", spec: clampSpec({ ...pack.hero(ar), dir: "rtl", lang: "ar" }) });
  }
  out.push({ id: "strip", label: "Components", spec: clampSpec(strip(en)) });
  return out;
}
