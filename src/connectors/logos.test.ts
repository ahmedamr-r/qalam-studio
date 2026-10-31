import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { wcagContrast } from "culori";
import { brandOn, connectorOfOrigin, glyphTone, logoFor, TILE } from "./logos";

describe("connector logos", () => {
  it("draws a brand colour on the tile, and one too pale for it in ink", () => {
    // Intercom's aqua is under 3:1 on the light tile; Notion's black, Figma's red and Drive's blue aren't.
    expect(glyphTone("6AFDEF")).toBe("ink");
    expect(glyphTone("#6AFDEF")).toBe("ink");
    expect(glyphTone("000000")).toBe("brand");
    expect(glyphTone("F24E1E")).toBe("brand");
    expect(glyphTone("4285F4")).toBe("brand");
    expect(glyphTone("FFFFFF")).toBe("ink");
    expect(glyphTone("not a colour")).toBe("ink");
    expect(logoFor("intercom")).toMatchObject({ kind: "mark", title: "Intercom", hex: "6AFDEF", tone: "ink" });
    expect(logoFor("notion")).toMatchObject({ kind: "mark", title: "Notion", hex: "000000", tone: "brand" });
  });

  it("keeps a brand's hue on a board's dark tile, lighter where it wouldn't read, and draws a near-grey one in ink", () => {
    const dark = "#2A2926";
    expect(brandOn("F24E1E", dark)).toBe("#F24E1E");
    expect(brandOn("000000", dark)).toBeNull();
    expect(brandOn("181717", dark)).toBeNull();
    for (const hex of ["0052CC", "172B4D", "03363D"]) {
      const on = brandOn(hex, dark)!;
      expect(on).not.toBe(`#${hex}`);
      expect(wcagContrast(on, dark)).toBeGreaterThanOrEqual(3);
    }
    // On a light ground a pale one goes darker instead.
    expect(wcagContrast(brandOn("6AFDEF", "#FFFFFF")!, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  it("has the tile's colour as the stage token, in both themes", () => {
    const css = readFileSync(new URL("../ui/globals.css", import.meta.url), "utf8");
    const stages = [...css.matchAll(/--color-stage:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stages)).toEqual(new Set([TILE]));
  });

  it("finds a mark for every connector but call recordings, which draw an audio glyph", () => {
    expect(logoFor("drive")).toMatchObject({ kind: "mark", title: "Google Drive" });
    expect(logoFor("calls")).toEqual({ kind: "audio", title: "Call recordings" });
    for (const c of CATALOG.filter((x) => x.id !== "calls")) expect(logoFor(c.id)).toMatchObject({ kind: "mark", path: expect.stringMatching(/^M/), hex: expect.stringMatching(/^[0-9A-F]{6}$/) });
    // Slack and Amplitude come from their media kits, drawn in the colour their guidelines give.
    expect(logoFor("slack")).toMatchObject({ title: "Slack", hex: "000000", tone: "brand" });
    expect(logoFor("amplitude")).toMatchObject({ title: "Amplitude", hex: "0052F2", tone: "brand" });
    expect(logoFor("someday")).toEqual({ kind: "letter", title: "someday", letter: "S" });
  });

  it("finds the connector a source came from", () => {
    expect(connectorOfOrigin("https://www.notion.so/acme/Interview-Dana-3b1c")).toBe("notion");
    expect(connectorOfOrigin("https://acme.notion.site/Interview")).toBe("notion");
    expect(connectorOfOrigin("https://docs.google.com/document/d/1x/edit")).toBe("drive");
    expect(connectorOfOrigin("https://acme.slack.com/archives/C01/p1790771415332219")).toBe("slack");
    expect(connectorOfOrigin("https://app.intercom.com/a/inbox/x/inbox/conversation/42")).toBe("intercom");
    expect(connectorOfOrigin("https://acme.zendesk.com/agent/tickets/7")).toBe("zendesk");
    expect(connectorOfOrigin("https://app.gong.io/call?id=1")).toBe("calls");
    expect(connectorOfOrigin("https://basket.atlassian.net/wiki/spaces/CX/pages/98305")).toBe("confluence");
    expect(connectorOfOrigin("https://basket.atlassian.net/browse/APP-9")).toBe("jira");
    expect(connectorOfOrigin("https://basket.atlassian.net/servicedesk")).toBeNull();
    expect(connectorOfOrigin("https://github.com/basket/app/issues/7")).toBe("github");
    // `<connector>:<item>` when the tool gave no address, and a tool's label as Claude Code names it.
    expect(connectorOfOrigin("notion:3b1c")).toBe("notion");
    expect(connectorOfOrigin("claude.ai Notion")).toBe("notion");
    expect(connectorOfOrigin("Google Drive")).toBe("drive");
    // A page a search tool found, a tool Qalam doesn't list, nothing.
    expect(connectorOfOrigin("https://example.com/notion-alternatives")).toBeNull();
    expect(connectorOfOrigin("https://notion.so.example.com/x")).toBeNull();
    expect(connectorOfOrigin("Tavily")).toBeNull();
    expect(connectorOfOrigin("https://")).toBeNull();
    expect(connectorOfOrigin(undefined)).toBeNull();
    expect(connectorOfOrigin("")).toBeNull();
  });
});
