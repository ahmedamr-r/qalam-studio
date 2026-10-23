import type { ScreenSpec } from "@/design-system/builders";
import { CATALOG } from "@/design-system/components";
import type { TextMeasurer } from "./measure";

/** Test measurer that wraps words at the available width (the default fallback never wraps). */
export const wrappingMeasurer: TextMeasurer = (t, maxW) => {
  const cw = t.fontSize * 0.55 + t.letterSpacing;
  const lh = t.lineHeight || t.fontSize;
  const full = Math.max(1, t.content.length * cw);
  if (maxW === null || full <= maxW) return { w: full, h: lh };
  let lines = 1;
  let line = 0;
  let widest = 0;
  for (const word of t.content.split(/\s+/).filter(Boolean)) {
    const ww = word.length * cw;
    if (line && line + cw + ww > maxW) {
      lines++;
      widest = Math.max(widest, line);
      line = ww;
    } else line += line ? cw + ww : ww;
  }
  widest = Math.max(widest, line);
  if (t.maxLines) lines = Math.min(lines, t.maxLines);
  return { w: Math.min(maxW, widest), h: lines * lh };
};

const examples = CATALOG.filter((c) => c.name !== "TopBar" && c.name !== "BottomNav" && c.name !== "BottomSheet").map((c) => ({
  component: c.name,
  props: c.example,
  children: c.exampleChildren,
}));

/** Every catalog component plus the variants that stress layout (wrap, full bleed, 0% progress, badges, hug CTAs). */
export const KITCHEN_SINK: ScreenSpec[] = [
  {
    name: "Kitchen sink",
    header: [{ component: "TopBar", props: { title: "Everything, all at once", leading: "back", trailing: "help" } }],
    body: [
      ...examples,
      { component: "Button", props: { label: "Full width", fullWidth: true, icon: "check" } },
      { component: "Button", props: { label: "Small", size: "sm", variant: "tertiary" } },
      { component: "ProgressTracker", props: { variant: "bar", title: "Just started", steps: ["One", "Two", "Three"], current: 0 } },
      { component: "ProgressTracker", props: { variant: "timeline", title: "Timeline", steps: ["Confirmed", "Preparing a very long step name", "Done"], current: 1 } },
      { component: "MapPlaceholder", props: { height: 200, pin: "Pickup", eta: "3 min", fullBleed: true } },
      {
        component: "Stack",
        props: { direction: "horizontal", gap: "200", align: "center", justify: "between" },
        children: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((label) => ({ component: "Tag", props: { label, tone: "info" } })),
      },
      {
        component: "Card",
        props: { title: "Nested", tone: "surface", padding: "300" },
        children: [
          { component: "SummaryRow", props: { label: "A label long enough to wrap onto a second line maybe", value: "AED 12.00", emphasis: true } },
          { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [{ component: "Button", props: { label: "One", variant: "secondary", size: "md", fullWidth: true } }, { component: "Button", props: { label: "Two", size: "md", fullWidth: true } }] },
        ],
      },
    ],
    footer: [
      {
        component: "BottomNav",
        props: { items: [{ label: "Home", icon: "home" }, { label: "Orders", icon: "receipt" }, { label: "Account", icon: "user" }], active: 1 },
      },
    ],
  },
  {
    name: "Sheet",
    header: [{ component: "TopBar", props: { title: "Brand", leading: "close", variant: "brand" } }],
    body: [{ component: "EmptyState", props: { icon: "receipt", title: "No orders yet", body: "Your past rides and orders will show up here.", cta: "Order food" } }],
    footer: [{ component: "BottomSheet", props: { title: "Choose a ride" }, children: [{ component: "ListItem", props: { title: "Comfort", subtitle: "4 seats · 3 min away", leadingIcon: "car", trailing: "text", trailingText: "AED 32", divider: true } }] }],
  },
];

/** Layered screens: a hero on the backdrop and a first section rising over its edge. */
export const HERO_FIXTURES: ScreenSpec[] = [
  {
    name: "Web hero",
    platform: "web",
    header: [
      { component: "Text", props: { text: "Qalam Pay", style: "title" } },
      { component: "Stack", props: { direction: "horizontal", gap: "600" }, children: [{ component: "Text", props: { text: "Business", style: "body" } }, { component: "Text", props: { text: "Pricing", style: "body" } }, { component: "Text", props: { text: "Help", style: "body" } }] },
      { component: "Button", props: { label: "Get the app", size: "md" } },
    ],
    hero: [
      { component: "Text", props: { text: "Pay bills, split rides and send money in one place", style: "display" } },
      { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [{ component: "Button", props: { label: "Get the app", size: "md" } }, { component: "Button", props: { label: "See fees", variant: "secondary", size: "md" } }] },
    ],
    overlap: "lg",
    body: [
      {
        component: "Stack",
        props: { direction: "horizontal", gap: "500" },
        children: [
          { component: "Card", props: { title: "Bills", tone: "raised" }, children: [{ component: "Text", props: { text: "DEWA, du and Salik in one list, paid on the due date.", style: "body" } }] },
          { component: "Card", props: { title: "Transfers", tone: "raised" }, children: [{ component: "Text", props: { text: "Send AED to any Lumen account for free.", style: "body" } }] },
          { component: "Card", props: { title: "Cashback", tone: "raised" }, children: [{ component: "Text", props: { text: "Up to 5% back on rides and food.", style: "body" } }] },
        ],
      },
    ],
  },
  {
    name: "Map hero",
    header: [{ component: "TopBar", props: { title: "Your ride", leading: "back", variant: "brand" } }],
    hero: [{ component: "MapPlaceholder", props: { height: 280, pin: "Dubai Mall", eta: "4 min", fullBleed: true } }],
    overlap: "lg",
    body: [{ component: "Card", props: { title: "Omar is 4 min away", tone: "raised" }, children: [{ component: "ListItem", props: { title: "Toyota Camry", subtitle: "White · Dubai N 48213", avatar: "OM" } }] }],
    footer: [{ component: "Button", props: { label: "Cancel ride", variant: "secondary", fullWidth: true } }],
  },
];
