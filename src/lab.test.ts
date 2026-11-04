import { afterEach, describe, expect, it } from "vitest";
import { engineShown, lab, labState, setLab } from "./lab";
import { sourcesFor } from "./ui/chat/attach";
import { PLACES, placeShown } from "./ui/frame/places";
import type { ConnectorState } from "./org/connectors";

afterEach(() => setLab(true));

describe("what's on", () => {
  it("reads a setting or variable as everything, some features or nothing", () => {
    for (const all of [true, "1", "true", "all"]) expect(labState(all)).toBe(true);
    expect(labState(["feeds", "seen", "nope"])).toEqual(["feeds", "seen"]);
    expect(labState("feeds, design")).toEqual(["feeds", "design"]);
    for (const none of [false, undefined, null, "", "0", 3]) expect(labState(none)).toEqual([]);
  });

  it("turns on only the features named", () => {
    setLab(["feeds"]);
    expect(lab("feeds")).toBe(true);
    expect(lab("design")).toBe(false);
    setLab([]);
    expect(lab("feeds")).toBe(false);
  });
});

describe("with everything hidden (v0.1)", () => {
  it("offers Claude Code, Codex and an Anthropic key", () => {
    setLab([]);
    expect(["cli", "api", "codex", "openai", "gemini", "openrouter", "ollama", "lmstudio"].filter(engineShown)).toEqual(["cli", "api", "codex"]);
    setLab(true);
    expect(engineShown("ollama")).toBe(true);
  });

  it("leaves Decisions out of the sidebar", () => {
    setLab([]);
    expect(PLACES.filter((p) => placeShown(p.id)).map((p) => p.id)).toEqual(["home", "connections"]);
  });

  it("brings material in from docs tools, and customers' voice only with the lab", () => {
    const notion = { id: "notion", group: "docs", feeds: "material", imports: true } as ConnectorState;
    const slack = { id: "slack", group: "voice", feeds: "material", imports: true } as ConnectorState;
    expect(sourcesFor("customers", [notion, slack])).toHaveLength(2);
    setLab([]);
    expect(sourcesFor("customers", [notion, slack])).toEqual([notion]);
  });
});
