import { afterEach, describe, expect, it } from "vitest";
import { engineShown, lab, labState, setLab } from "./lab";
import { sourcesFor } from "./ui/chat/attach";
import { PLACES, placeShown } from "./ui/frame/places";
import { firstRunLeft, stepAfter, stepsFor } from "./ui/welcome/steps";
import type { ConnectorState } from "./org/connectors";

afterEach(() => setLab(true));

describe("what's on", () => {
  it("reads a setting or variable as everything, some features or nothing", () => {
    for (const all of [true, "1", "true", "all"]) expect(labState(all)).toBe(true);
    expect(labState(["feeds", "voice", "nope"])).toEqual(["feeds", "voice"]);
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

  it("asks only for Qalam AI, a name and a start, then finishes", () => {
    setLab([]);
    expect(stepsFor("team").map((s) => s.id)).toEqual(["engine", "name", "goals"]);
    expect(stepAfter("name", "team")).toBe("goals");
    expect(stepAfter("goals", "team")).toBeNull();
    // Picked up from the home: still the goals, never a step that isn't asked.
    expect(firstRunLeft({ you: false, voice: false, goals: 2, settingUp: false, picked: false, finished: false, shape: "team" })).toEqual({ step: "goals", done: 2, of: 3 });
  });

  it("asks every step with everything on, and no Yours on your own", () => {
    expect(stepsFor("team").map((s) => s.id)).toEqual(["engine", "name", "you", "voice", "goals", "yours", "connect"]);
    expect(stepAfter("goals", "solo")).toBe("connect");
    expect(stepAfter("goals", "team")).toBe("yours");
  });

  it("leaves Decisions out of the sidebar", () => {
    setLab([]);
    expect(PLACES.filter((p) => placeShown(p.id)).map((p) => p.id)).toEqual(["home", "goals", "problems", "evidence", "connections"]);
  });

  it("brings material in from this computer only", () => {
    const notion = { id: "notion", group: "docs", feeds: "material", imports: true } as ConnectorState;
    expect(sourcesFor("docs", [notion])).toHaveLength(1);
    setLab([]);
    expect(sourcesFor("docs", [notion])).toEqual([]);
  });
});
