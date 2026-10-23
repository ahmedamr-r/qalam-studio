import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadPrototype } from "@/ui/prototype/runtime";
import Prototype, { qalamCSS } from "./__golden__/order-tracking";

/**
 * The exported code runs: the golden module as a project would import it, and the same code the
 * way Prototype mode runs it (transpiled in the browser, against the studio's React and Motion).
 */
describe("compiled prototype code", () => {
  it("renders its start screen, and any other it's asked to start on", () => {
    const home = renderToString(createElement(Prototype));
    expect(home).toContain("Arrives in 1 minute");
    expect(home).toContain(`class="q-screen"`);
    const map = renderToString(createElement(Prototype, { start: "mapFirst" }));
    expect(map).toContain("Your order");
    expect(map).toContain("On the way");
    expect(qalamCSS).toContain("--bg-canvas: #FFFFFF;");
  });

  it("runs through Prototype mode's runtime: sucrase, the studio's packages, Lucide drawn from its data", () => {
    const code = readFileSync(new URL("./__golden__/order-tracking.tsx", import.meta.url), "utf8");
    const Played = loadPrototype(code);
    const html = renderToString(createElement(Played, { start: "timeline" }));
    expect(html).toContain("Order #4821");
    expect(html).toContain("Preparing your food");
    // lucide-react's X icon, drawn as the canvas draws it.
    expect(html).toMatch(/<svg[^>]*class="lucide"[^>]*>/);
  });
});
