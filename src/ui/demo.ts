import type { ScreenSpec } from "@/design-system/builders";
import { insertScreens } from "@/design-system/place";
import { studio } from "@/doc/store";
import { makeFrame, makeIcon, makeShape, makeText } from "@/doc/factory";
import { insertNodes, fitText } from "@/doc/ops";
import { uniformRadius, type Prototype, type SceneNode } from "@/doc/schema";
import { addPart, editRoutes, withRoute } from "@/proto/edit";
import { BASKET_BAR, MENU_SCREEN, OPTIONS_SHEET, menuRoute } from "@/proto/fixtures/food-menu";
import { routeFrom } from "@/proto/fixtures/build";
import { ROUTE_FIXTURES } from "@/proto/fixtures";
import { worldBounds } from "@/doc/geometry";
import { lintNodes } from "@/lint/rules";
import { getController } from "./CanvasView";

export const DEMO_SCREENS: ScreenSpec[] = [
  {
    name: "Order tracking · Map first",
    rationale: "Live location dominates; status and courier in a bottom sheet.",
    header: [{ component: "TopBar", props: { title: "Your order", leading: "back", trailing: "help" } }],
    body: [
      { component: "MapPlaceholder", props: { height: 300, pin: "Home", eta: "12 min", fullBleed: true } },
      { component: "ProgressTracker", props: { variant: "bar", title: "Arrives in 12 min", steps: ["Confirmed", "Preparing", "On the way", "Delivered"], current: 2 } },
    ],
    footer: [
      {
        component: "BottomSheet",
        props: {},
        children: [
          { component: "ListItem", props: { title: "Omar is on the way", subtitle: "Honda Civic · Dubai N 48213", avatar: "OM", trailing: "none" } },
          {
            component: "Stack",
            props: { direction: "horizontal", gap: "300" },
            children: [
              { component: "Button", props: { label: "Call", variant: "secondary", size: "md", icon: "phone", fullWidth: true } },
              { component: "Button", props: { label: "Message", variant: "primary", size: "md", icon: "message", fullWidth: true } },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Order tracking · Timeline",
    rationale: "Step-by-step reassurance for longer prep times.",
    header: [{ component: "TopBar", props: { title: "Order #4821", leading: "close", trailing: "share-2" } }],
    body: [
      { component: "InlineAlert", props: { tone: "info", title: "Kitchen is preparing your food", body: "Karachi Darbar usually takes 15–20 min." } },
      { component: "Card", props: { tone: "raised" }, children: [{ component: "ProgressTracker", props: { variant: "timeline", steps: ["Order confirmed", "Preparing your food", "Captain picking up", "On the way", "Delivered"], current: 1 } }] },
      {
        component: "Card",
        props: { title: "Order summary", tone: "surface" },
        children: [
          { component: "SummaryRow", props: { label: "Chicken biryani × 2", value: "AED 58.00" } },
          { component: "SummaryRow", props: { label: "Delivery fee", value: "AED 5.00" } },
          { component: "Divider", props: {} },
          { component: "SummaryRow", props: { label: "Total", value: "AED 63.00", emphasis: true } },
        ],
      },
    ],
    footer: [{ component: "Button", props: { label: "Contact support", variant: "secondary", fullWidth: true, icon: "headphones" } }],
  },
  {
    name: "Order tracking · Compact",
    rationale: "Glanceable card on home; promo slot for Plus upsell.",
    background: "surface",
    header: [{ component: "TopBar", props: { title: "Food", leading: "back", trailing: "cart" } }],
    body: [
      {
        component: "Card",
        props: { tone: "brand-strong" },
        children: [
          { component: "Text", props: { text: "Arrives in 1 minute", style: "title", tone: "inverse" } },
          { component: "Text", props: { text: "Orange Roof · Toyota Camry 1310", style: "body", tone: "inverse" } },
          { component: "Tag", props: { label: "On time", tone: "brand" } },
        ],
      },
      { component: "ChipGroup", props: { chips: ["All", "4.5+ rated", "Under 30 min"], selected: 0 } },
      { component: "PromoBanner", props: { title: "Get 25% off your bill", subtitle: "Save on every order with Plus", cta: "Try Plus", tone: "get", icon: "percent" } },
      { component: "ListItem", props: { title: "Karachi Darbar", subtitle: "Pakistani · Biryani · 35–45 min", leadingIcon: "utensils", trailing: "chevron" } },
    ],
    footer: [{ component: "BottomNav", props: { items: [{ label: "Home", icon: "home" }, { label: "Orders", icon: "receipt" }, { label: "Pay", icon: "wallet" }, { label: "Account", icon: "user" }], active: 1 } }],
  },
  {
    name: "تتبع الطلب · الخريطة",
    rationale: "Arabic RTL variant of the map-first layout.",
    dir: "rtl",
    lang: "ar",
    header: [{ component: "TopBar", props: { title: "طلبك", leading: "back", trailing: "help" } }],
    body: [
      { component: "MapPlaceholder", props: { height: 300, pin: "المنزل", eta: "١٢ دقيقة", fullBleed: true } },
      { component: "ProgressTracker", props: { variant: "bar", title: "يصل خلال ١٢ دقيقة", steps: ["تم التأكيد", "قيد التحضير", "في الطريق", "تم التوصيل"], current: 2 } },
    ],
    footer: [
      {
        component: "BottomSheet",
        props: {},
        children: [
          { component: "ListItem", props: { title: "عمر في الطريق إليك", subtitle: "هوندا سيفيك · دبي ن ٤٨٢١٣", avatar: "عم", trailing: "chevron" } },
          {
            component: "Stack",
            props: { direction: "horizontal", gap: "300" },
            children: [
              { component: "Button", props: { label: "اتصال", variant: "secondary", size: "md", icon: "phone", fullWidth: true } },
              { component: "Button", props: { label: "رسالة", variant: "primary", size: "md", icon: "message", fullWidth: true } },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * Layered screens: the lead content sits in a hero on the system's backdrop gradient, and the
 * first body section rises over its edge. Loaded with the demo, kept apart from DEMO_SCREENS
 * (the recorded order-tracking sample and the golden snapshot).
 */
export const HERO_DEMO_SCREENS: ScreenSpec[] = [
  {
    name: "Wallet · Home",
    rationale: "The balance leads on the backdrop; the next things to do rise over its edge.",
    header: [{ component: "TopBar", props: { title: "Pay", leading: "none", trailing: "bell" } }],
    hero: [
      { component: "Text", props: { text: "Available balance", style: "body", tone: "secondary" } },
      { component: "Text", props: { text: "AED 1,284.50", style: "display" } },
      { component: "Tag", props: { label: "AED 42 cashback", tone: "brand" } },
    ],
    overlap: "md",
    body: [
      {
        component: "Card",
        props: { tone: "raised", padding: "300" },
        children: [
          {
            component: "ServiceGrid",
            props: {
              tiles: [
                { label: "Top up", icon: "plus" },
                { label: "Send", icon: "send" },
                { label: "Scan to pay", icon: "scan-line" },
                { label: "Bills", icon: "receipt" },
              ],
              columns: "4",
            },
          },
        ],
      },
      {
        component: "Card",
        props: { title: "Recent activity", tone: "raised" },
        children: [
          { component: "ListItem", props: { title: "Karachi Darbar", subtitle: "Food · Today, 13:05", leadingIcon: "utensils", trailing: "text", trailingText: "− AED 63.00", divider: true } },
          { component: "ListItem", props: { title: "Top up", subtitle: "Visa •••• 6411 · Yesterday", leadingIcon: "credit-card", trailing: "text", trailingText: "+ AED 500.00", trailingTone: "success", divider: true } },
          { component: "ListItem", props: { title: "Ride to Dubai Mall", subtitle: "Rides · Mon, 08:12", leadingIcon: "car", trailing: "text", trailingText: "− AED 38.50" } },
        ],
      },
    ],
    footer: [{ component: "BottomNav", props: { items: [{ label: "Home", icon: "home" }, { label: "Orders", icon: "receipt" }, { label: "Pay", icon: "wallet" }, { label: "Account", icon: "user" }], active: 2 } }],
  },
  {
    name: "المحفظة · الرئيسية",
    rationale: "Arabic RTL variant of the layered wallet home.",
    dir: "rtl",
    lang: "ar",
    header: [{ component: "TopBar", props: { title: "الدفع", leading: "none", trailing: "bell" } }],
    hero: [
      { component: "Text", props: { text: "الرصيد المتاح", style: "body", tone: "secondary" } },
      { component: "Text", props: { text: "١٬٢٨٤٫٥٠ د.إ", style: "display" } },
      { component: "Tag", props: { label: "استرداد ٤٢ د.إ", tone: "brand" } },
    ],
    overlap: "md",
    body: [
      {
        component: "Card",
        props: { tone: "raised", padding: "300" },
        children: [
          {
            component: "ServiceGrid",
            props: {
              tiles: [
                { label: "شحن", icon: "plus" },
                { label: "تحويل", icon: "send" },
                { label: "امسح وادفع", icon: "scan-line" },
                { label: "الفواتير", icon: "receipt" },
              ],
              columns: "4",
            },
          },
        ],
      },
      {
        component: "Card",
        props: { title: "آخر العمليات", tone: "raised" },
        children: [
          { component: "ListItem", props: { title: "كراتشي دربار", subtitle: "طعام · اليوم، ١٣:٠٥", leadingIcon: "utensils", trailing: "text", trailingText: "− ٦٣٫٠٠ د.إ", divider: true } },
          { component: "ListItem", props: { title: "شحن الرصيد", subtitle: "فيزا •••• ٦٤١١ · أمس", leadingIcon: "credit-card", trailing: "text", trailingText: "+ ٥٠٠٫٠٠ د.إ", trailingTone: "success", divider: true } },
          { component: "ListItem", props: { title: "رحلة إلى دبي مول", subtitle: "رحلات · الاثنين، ٠٨:١٢", leadingIcon: "car", trailing: "text", trailingText: "− ٣٨٫٥٠ د.إ" } },
        ],
      },
    ],
    footer: [{ component: "BottomNav", props: { items: [{ label: "الرئيسية", icon: "home" }, { label: "الطلبات", icon: "receipt" }, { label: "الدفع", icon: "wallet" }, { label: "الحساب", icon: "user" }], active: 2 } }],
  },
];

/**
 * The order-tracking flow as a prototype (written by hand, the way Qalam AI's choices look): the
 * home card pushes to the live map; the progress section smart-animates into the timeline, whose
 * sections stagger in; tapping the map delivers the order (ProgressTracker current 2 → 3). It all
 * moves natively (as the phone it's played as does); only the timeline's entrance has a timing of
 * its own.
 */
export function demoProto(ids: { mapFirst: string; timeline: string; compact: string }): Prototype {
  const { mapFirst, timeline, compact } = ids;
  return {
    start: compact,
    links: [
      { from: { screen: compact, path: "body.0" }, on: "tap", to: { screen: mapFirst }, transition: { kind: "push", motion: "native" } },
      { from: { screen: mapFirst, path: "header.0" }, on: "tap", to: "back", transition: { kind: "push", motion: "native" } },
      { from: { screen: mapFirst, path: "body.1" }, on: "tap", to: { screen: timeline }, transition: { kind: "smart", motion: "native" } },
      { from: { screen: mapFirst, path: "body.0" }, on: "tap", to: { state: "delivered" }, transition: { kind: "smart", motion: "native" } },
      { from: { screen: timeline, path: "header.0" }, on: "tap", to: "back", transition: { kind: "smart", motion: "native" } },
    ],
    states: { [mapFirst]: { delivered: { "body.1.props.current": 3 } } },
    tracks: [{ target: { screen: timeline, path: "body.*" }, preset: "fade-up", stagger: 70, motion: "medium.emphasized" }],
  };
}

/** Add a prototype to the document's (the demo can be loaded more than once). */
function addProto(p: Prototype) {
  studio().mutate((d) => {
    const cur = d.proto;
    d.proto = cur
      ? { ...cur, links: [...cur.links, ...p.links], tracks: [...cur.tracks, ...p.tracks], states: { ...cur.states, ...p.states }, start: cur.start ?? p.start }
      : p;
  });
}

/** A hand-made frame full of the mistakes the audit should catch. */
function messyFrame(x: number, y: number): SceneNode[] {
  const f = makeFrame({ name: "Legacy checkout (audit me)", x, y, w: 390, h: 520, fill: { color: "#FFFFFF" } });
  const title = makeText({ x: 20, y: 24, fill: { color: "#111111" }, text: { content: "Checkout", fontSize: 22, fontWeight: 700, lineHeight: 28, typeToken: undefined } });
  const sub = makeText({ x: 20, y: 60, fill: { color: "#8A8A8A" }, text: { content: "Delivery to Dubai Marina, Tower 3", fontSize: 14, fontWeight: 400, lineHeight: 20, typeToken: undefined } });
  const card = makeShape("rect", { name: "Card", x: 20, y: 100, w: 350, h: 120, fill: { color: "#F2F2F2" }, radius: uniformRadius(10) });
  const cardTitle = makeText({ x: 36, y: 116, fill: { color: "#A0A0A0" }, text: { content: "Promo code applied", fontSize: 13, fontWeight: 500, lineHeight: 18, typeToken: undefined } });
  const arabic = makeText({ x: 36, y: 150, fill: { color: "#333333" }, text: { content: "خصم ٢٥٪ على طلبك · AED 25", fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 22, letterSpacing: 0.5, direction: "ltr", typeToken: undefined } });
  const back = makeIcon("arrow-left", { x: 330, y: 24, w: 24, h: 24, fill: { color: "#111111" } });
  const close = makeFrame({ name: "Close button", x: 300, y: 20, w: 28, h: 28, fill: null, radius: uniformRadius(6), clip: false, meta: { source: "user", interactive: true } });
  const closeIcon = makeIcon("close", { x: 6, y: 6, w: 16, h: 16, fill: { color: "#666666" } });
  const btn = makeFrame({ name: "Pay button", x: 20, y: 440, w: 350, h: 48, fill: { color: "#8E9CFF" }, radius: uniformRadius(14), clip: false, meta: { source: "user", interactive: true } });
  const btnLabel = makeText({ x: 0, y: 13, w: 350, fill: { color: "#FFFFFF" }, text: { content: "Pay AED 63.00", fontSize: 16, fontWeight: 600, lineHeight: 22, align: "center", autoSize: "height", typeToken: undefined } });
  const pill = makeShape("rect", { name: "Elliptical pill", x: 20, y: 250, w: 160, h: 60, fill: { color: "#E0E5FF", token: "bg.brand-subtle" }, radius: { ...uniformRadius(0), circular: false, tl: { rx: 40, ry: 16 }, tr: { rx: 40, ry: 16 }, br: { rx: 40, ry: 16 }, bl: { rx: 40, ry: 16 } } });

  f.clip = true;
  f.dir = "rtl";
  const kids = [title, sub, card, cardTitle, arabic, back, close, btn, pill];
  for (const k of kids) {
    k.parentId = f.id;
    f.children.push(k.id);
  }
  closeIcon.parentId = close.id;
  close.children.push(closeIcon.id);
  btnLabel.parentId = btn.id;
  btn.children.push(btnLabel.id);
  for (const t of [title, sub, cardTitle, arabic, btnLabel]) fitText(t);
  return [f, ...kids, closeIcon, btnLabel];
}

export async function loadDemo() {
  const ids = await insertScreens([...DEMO_SCREENS, ...HERO_DEMO_SCREENS], "ai");
  addProto(demoProto({ mapFirst: ids[0], timeline: ids[1], compact: ids[2] }));
  const { doc } = studio();
  const last = worldBounds(doc, ids[ids.length - 1]);
  const messy = messyFrame(last.x + last.w + 160, last.y);
  insertNodes(messy, null, undefined, false);
  lintNodes([messy[0].id]);
  await loadMenuRoute();
  requestAnimationFrame(() => getController()?.zoomToFit());
}

/** A restaurant menu as a route: built from recipes over the screen, its options sheet and its basket bar. */
async function loadMenuRoute() {
  const [menu] = await insertScreens([MENU_SCREEN], "ai");
  const sheet = await addPart(menu, "sheet", OPTIONS_SHEET);
  const bar = await addPart(menu, "bar", BASKET_BAR);
  if (!sheet || !bar) return;
  const { route, appVars } = menuRoute(studio().doc, { menu, sheet, bar });
  editRoutes((p) => ({ ...withRoute(p, menu, (r) => ({ ...route, overlays: { ...r.overlays, ...route.overlays }, addOns: { ...r.addOns, ...route.addOns } })), vars: { ...p.vars, ...appVars } }));
}

/**
 * A route fixture on the canvas (development: ride, bank, dashboard, shop, grocery, orders): its
 * screen to the right of everything, its parts under it by the fixture's ids, and the route its
 * recipes make there — steps and all, ready to play; or, bare, the screen alone.
 */
export async function loadRouteFixture(name: string, opts: { bare?: boolean } = {}): Promise<string | null> {
  const def = ROUTE_FIXTURES[name];
  if (!def) return null;
  const [screen] = await insertScreens([def.screen], "ai");
  // Bare: the screen alone, nothing prototyped (for Qalam AI to propose on).
  if (opts.bare) {
    studio().select([screen]);
    return screen;
  }
  const frames: Record<string, string> = {};
  for (const [part, spec] of Object.entries(def.parts)) {
    const added = await addPart(screen, spec.surface ?? "sheet", spec, {}, part);
    if (added) frames[added.part] = added.frame;
  }
  const { route, appVars } = routeFrom(studio().doc, screen, frames, def.steps);
  editRoutes((p) => ({ ...withRoute(p, screen, () => route), vars: { ...p.vars, ...appVars } }));
  studio().select([screen]);
  requestAnimationFrame(() => getController()?.zoomToFit());
  return screen;
}
