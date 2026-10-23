import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_PROFILE, addCreated, agentFor, appendThought, bubbleText, endAgent, narrate, setStep, startAgent, useAgents } from "./agents";

describe("agents", () => {
  beforeEach(() => useAgents.setState({ agents: [], following: null }));

  it("gives agents running at the same time different colours, reusing freed ones", () => {
    const a = startAgent({ turnId: "a", chatId: "1", kind: "designer" });
    const b = startAgent({ turnId: "b", chatId: "2", kind: "designer" });
    const c = startAgent({ turnId: "c", chatId: "3", kind: "designer" });
    expect(new Set([a.color, b.color, c.color]).size).toBe(3);
    endAgent("b");
    expect(startAgent({ turnId: "d", chatId: "4", kind: "designer" }).color).toBe(b.color);
  });

  it("keeps only the latest thinking and shows whichever changed last", async () => {
    startAgent({ turnId: "a", chatId: "1", kind: "designer" });
    appendThought("a", "x".repeat(500));
    expect(agentFor("a")!.thought).toHaveLength(400);
    await new Promise((r) => setTimeout(r, 2));
    narrate("a", "Adding the order card");
    expect(bubbleText(agentFor("a")!)).toBe("Adding the order card");
  });

  it("shows the last three lines of the bubble text", () => {
    expect(bubbleText({ thought: "1\n2\n3\n4", thoughtAt: 2, narration: "", narrationAt: 1, activity: "Thinking" })).toBe("2\n3\n4");
    expect(bubbleText({ thought: "", thoughtAt: 0, narration: "", narrationAt: 0, activity: "Thinking" })).toBe("Thinking…");
  });

  it("lists what was built under its step", () => {
    startAgent({ turnId: "a", chatId: "1", kind: "designer" });
    setStep("a", "variant-0", "Map first", false);
    addCreated("a", "variant-0", { variant: 0, specPath: "body.0", name: "Map", component: "MapPlaceholder" }, { x: 0, y: 0, w: 10, h: 10 });
    const a = agentFor("a")!;
    expect(a.steps[0].created.map((c) => c.specPath)).toEqual(["body.0"]);
    expect(a.glows).toHaveLength(1);
  });

  it("names each agent for its job, not its chat, and in its own colour", () => {
    const d = startAgent({ turnId: "a", chatId: "1", kind: "designer", task: "Wallet top-up with saved cards and offers" });
    const s = startAgent({ turnId: "b", chatId: "2", kind: "systems" });
    const c = startAgent({ turnId: "c", chatId: "3", kind: "critic" });
    expect([d.name, s.name, c.name]).toEqual(["Designer", "System builder", "Critic"]);
    expect([d.color, s.color, c.color]).toEqual([AGENT_PROFILE.designer.color, AGENT_PROFILE.systems.color, AGENT_PROFILE.critic.color]);
  });

  it("numbers agents of the same kind working at once, reusing freed names", () => {
    startAgent({ turnId: "a", chatId: "1", kind: "designer" });
    expect(startAgent({ turnId: "b", chatId: "2", kind: "designer" }).name).toBe("Designer 2");
    endAgent("a");
    expect(startAgent({ turnId: "c", chatId: "3", kind: "designer" }).name).toBe("Designer");
    expect(startAgent({ turnId: "d", chatId: "4", kind: "designer" }).name).toBe("Designer 3");
  });

  it("stops following an agent when it finishes", () => {
    startAgent({ turnId: "a", chatId: "1", kind: "critic" });
    startAgent({ turnId: "b", chatId: "2", kind: "designer" });
    useAgents.setState({ following: "a" });
    endAgent("b");
    expect(useAgents.getState().following).toBe("a");
    endAgent("a");
    expect(useAgents.getState().following).toBeNull();
  });
});
