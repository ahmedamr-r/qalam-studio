import { describe, expect, it } from "vitest";
import { funnelOf, mapFromMarkdown, mapToMarkdown, repoPath, verifyAnswer, verifyFlows, type ProductMap } from "./map";
import { routeOf, scanCode } from "./scan";

const files = [
  { path: "app/(shop)/orders/page.tsx", text: 'export default function Orders() {\n  posthog.capture("orders_viewed")\n  return <OrderList />\n}' },
  { path: "app/(shop)/orders/[id]/page.tsx", text: 'export default function Order() {\n  const reorder = () => {\n    posthog?.capture(\'reorder_clicked\', { from: "order" })\n    addAll(items)\n  }\n}' },
  { path: "app/layout.tsx", text: "export default function Layout() {}" },
  { path: "pages/_app.tsx", text: "export default function App() {}" },
  { path: "pages/checkout.tsx", text: "export default function Checkout() {\n  analytics.track(\"checkout_started\")\n  gtag('event', 'begin_checkout')\n}" },
  { path: "src/nav.tsx", text: '<Stack.Screen name="Basket" component={Basket} />\n<Route path="/help" element={<Help />} />' },
  { path: "ios/BasketView.swift", text: 'struct BasketView: View {\n  func done() { Analytics.logEvent("basket_saved", parameters: nil) }\n}' },
  { path: "android/CheckoutScreen.kt", text: "@Composable fun CheckoutScreen() { mixpanel.track(\"checkout_viewed\") }" },
];

describe("what the code says it does", () => {
  it("finds the events it sends and its screens, each where it is", () => {
    const s = scanCode(files);
    expect(s.events.map((e) => [e.name, e.sdk, e.file, e.line])).toEqual([
      ["orders_viewed", "posthog", "app/(shop)/orders/page.tsx", 2],
      ["reorder_clicked", "posthog", "app/(shop)/orders/[id]/page.tsx", 3],
      ["checkout_started", "segment", "pages/checkout.tsx", 2],
      ["begin_checkout", "gtag", "pages/checkout.tsx", 3],
      ["basket_saved", "firebase", "ios/BasketView.swift", 2],
      ["checkout_viewed", "mixpanel", "android/CheckoutScreen.kt", 1],
    ]);
    expect(s.screens.map((x) => [x.kind, x.route ?? x.name, x.file])).toEqual([
      ["page", "/orders", "app/(shop)/orders/page.tsx"],
      ["page", "/orders/:id", "app/(shop)/orders/[id]/page.tsx"],
      ["page", "/checkout", "pages/checkout.tsx"],
      ["route", "/help", "src/nav.tsx"],
      ["screen", "Basket", "src/nav.tsx"],
      ["screen", "BasketView", "ios/BasketView.swift"],
      ["screen", "CheckoutScreen", "android/CheckoutScreen.kt"],
    ]);
  });

  it("reads a file router's address: groups out, [id] as :id, layouts and api routes aren't pages", () => {
    expect(routeOf("src/app/page.tsx")).toBe("/");
    expect(routeOf("app/(tabs)/settings/index.tsx")).toBe("/settings");
    expect(routeOf("app/blog/[...slug]/page.tsx")).toBe("/blog/*slug");
    expect(routeOf("app/_layout.tsx")).toBeNull();
    expect(routeOf("pages/api/orders.ts")).toBeNull();
    expect(routeOf("lib/page.tsx")).toBeNull();
  });
});

describe("what the code reader writes, as code keeps it", () => {
  const root = "/tmp/copy/acme__basket";
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const events = new Set(scanCode(files).events.map((e) => e.name));

  it("keeps a step only when its file is in the copy, its snippet in that file, its events ones the code sends", () => {
    const dropped: string[] = [];
    const flows = verifyFlows(
      {
        flows: [
          {
            name: "Reordering",
            goal: "g1",
            steps: [
              { title: "Opens past orders", file: `${root}/app/(shop)/orders/page.tsx`, snippet: 'posthog.capture("orders_viewed")', events: ["orders_viewed"] },
              { title: "Reorders an old order", file: "./app/(shop)/orders/[id]/page.tsx", snippet: "addAll(items)", events: ["reorder_clicked", "reorder_done"] },
              { title: "A file it made up", file: "app/reorder.tsx", snippet: "reorder()", events: [] },
              { title: "Words not in the file", file: "pages/checkout.tsx", snippet: "applyCoupon(code)", events: [] },
            ],
          },
          { name: "One step only", goal: "g9", steps: [{ title: "Checks out", file: "pages/checkout.tsx", snippet: 'analytics.track("checkout_started")', events: ["checkout_started"] }] },
        ],
      },
      { root, files: byPath, events, goals: new Set(["g1"]) },
      (why) => dropped.push(why),
    );
    expect(flows).toEqual([
      {
        name: "Reordering",
        goal: "g1",
        steps: [
          { title: "Opens past orders", file: "app/(shop)/orders/page.tsx", snippet: 'posthog.capture("orders_viewed")', events: ["orders_viewed"] },
          { title: "Reorders an old order", file: "app/(shop)/orders/[id]/page.tsx", snippet: "addAll(items)", events: ["reorder_clicked"] },
        ],
      },
    ]);
    expect(dropped).toEqual(["an event the code doesn't send: reorder_done", "a file not in the copy", "its snippet isn't in its file", "fewer than two steps hold"]);
    expect(repoPath("C:\\copy\\a.ts", "C:\\copy")).toBe("a.ts");
  });

  it("keeps an answer about the code only when what it cites is there and its quoted words are in it", () => {
    expect(verifyAnswer({ answer: { text: "Reordering adds every item at once: “addAll(items)”.", cites: [{ file: "app/(shop)/orders/[id]/page.tsx", snippet: "addAll(items)" }] } }, { root, files: byPath })).toEqual({ text: "Reordering adds every item at once: “addAll(items)”.", cites: [{ file: "app/(shop)/orders/[id]/page.tsx", snippet: "addAll(items)" }] });
    expect(verifyAnswer({ answer: { text: "It never reorders.", cites: [{ file: "app/nowhere.tsx", snippet: "never()" }] } }, { root, files: byPath })).toBeNull();
    expect(verifyAnswer({ answer: { text: "It says “reorderEverything()”.", cites: [{ file: "app/(shop)/orders/[id]/page.tsx", snippet: "addAll(items)" }] } }, { root, files: byPath })).toBeNull();
  });

  it("writes the map as a page people can read, and reads it back with their words as titles", () => {
    const map: ProductMap = { key: "acme__basket", repo: "acme/basket", commit: "abc1234def", product: "grocery", readAt: Date.UTC(2026, 9, 28), events: ["orders_viewed", "reorder_clicked"], flows: [{ name: "Reordering", goal: "g1", steps: [{ title: "Opens past orders", file: "app/orders/page.tsx", snippet: 'posthog.capture("orders_viewed")', events: ["orders_viewed"] }, { title: "Reorders an old order", file: "app/orders/[id]/page.tsx", snippet: "addAll(items)", events: [] }] }] };
    const md = mapToMarkdown(map, { productName: "Grocery app", goalTitle: (id) => (id === "g1" ? "More customers reorder weekly" : undefined) });
    expect(md).toContain("# What Grocery app does today");
    expect(md).toContain("## Reordering · measures “More customers reorder weekly” <!-- qalam {\"goal\":\"g1\"} -->");
    expect(md).toContain("1. Opens past orders · `app/orders/page.tsx` · sends `orders_viewed` <!-- qalam");
    expect(mapFromMarkdown(md)).toEqual(map);
    expect(mapFromMarkdown(md.replace("1. Opens past orders", "1. Looks at what they ordered before"))?.flows[0].steps[0].title).toBe("Looks at what they ordered before");
    expect(mapFromMarkdown("# Not a map")).toBeNull();
    expect(funnelOf({ id: "g1", product: "grocery" }, [map])?.flow.name).toBe("Reordering");
    expect(funnelOf({ id: "g1", product: "business" }, [map])).toBeNull();
  });
});
