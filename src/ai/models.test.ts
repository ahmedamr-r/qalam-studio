import { describe, expect, expectTypeOf, it } from "vitest";
import { isCallKind, modelFamily, modelFor, supportsFallback, TIER_OF, tierOf, type CallKind, type Tier } from "./models";
import { extractCall, synthesizeCall } from "./discovery";
import { topicsCall } from "./topics";
import { setupCall } from "./setup";
import { claimsCall } from "./outside";
import { breakdownCall } from "./breakdown";
import { jobsCall } from "./jobs";
import { bearingsCall } from "./goals";
import { readerCall } from "./code";

const api = { backend: "api" as const, mix: "balanced" as const, env: {} };
const cli = { backend: "cli" as const, mix: "balanced" as const, env: {} };

describe("the model each call runs on", () => {
  it("reads on Sonnet, decides on Opus and fetches on Haiku, by default on each engine", () => {
    expect((["decide", "read", "fetch"] as Tier[]).map((t) => modelFor(t, api))).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    // Claude Code takes its own aliases for the cheaper tiers.
    expect((["decide", "read", "fetch"] as Tier[]).map((t) => modelFor(t, cli))).toEqual(["claude-opus-5-5", "sonnet", "haiku"]);
  });

  it('runs reads on the decide model with "best", and leaves fetch where it is', () => {
    expect(modelFor("read", { ...api, mix: "best" })).toBe("claude-opus-5-5");
    expect(modelFor("read", { ...cli, mix: "best", env: { CLAUDE_MODEL: "claude-fable-5-1" } })).toBe("claude-fable-5-1");
    expect(modelFor("fetch", { ...api, mix: "best" })).toBe("claude-haiku-5-5");
  });

  it("lets the environment win: the tier's own variable, then the older ones, in their order", () => {
    expect(modelFor("decide", { ...api, env: { QALAM_MODEL_DECIDE: "a", DISCOVERY_MODEL: "b", GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("a");
    expect(modelFor("decide", { ...api, env: { DISCOVERY_MODEL: "b", GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("b");
    expect(modelFor("decide", { ...api, env: { GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("c");
    expect(modelFor("decide", { ...cli, env: { CLAUDE_MODEL: "d" } })).toBe("d");
    expect(modelFor("read", { ...api, mix: "best", env: { QALAM_MODEL_READ: "r", DISCOVERY_MODEL: "b" } })).toBe("r");
    // The older variables set decide, not a balanced read.
    expect(modelFor("read", { ...api, env: { DISCOVERY_MODEL: "b" } })).toBe("claude-sonnet-5-5");
    expect(modelFor("fetch", { ...cli, env: { CONNECTOR_MODEL: "sonnet" } })).toBe("sonnet");
    expect(modelFor("fetch", { ...cli, env: { QALAM_MODEL_FETCH: "f", CONNECTOR_MODEL: "sonnet" } })).toBe("f");
    // An empty variable is as good as none.
    expect(modelFor("decide", { ...api, env: { QALAM_MODEL_DECIDE: "" } })).toBe("claude-opus-5-5");
  });

  it("offers the API's server-side fallback on Opus 5, Fable 5 and Sonnet 5.5, never Haiku", () => {
    for (const m of ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]) expect(supportsFallback(m)).toBe(true);
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-opus-4-8", "sonnet", "opus"]) expect(supportsFallback(m)).toBe(false);
  });

  it("gives every kind of call a tier, as the plan has it", () => {
    const by = (t: Tier) => (Object.keys(TIER_OF) as CallKind[]).filter((k) => TIER_OF[k] === t).sort();
    expect(by("read")).toEqual(["claims", "extract", "reader", "research", "setup-shape", "topics"]);
    expect(by("fetch")).toEqual(["connector", "numbers"]);
    expect(by("decide")).toEqual(["ask", "bearings", "breakdown", "draft", "dump-followup", "dump-place", "dump-read", "followups", "jobs", "review", "setup-followup", "setup-place", "setup-read", "synthesize"]);
    expect(tierOf(undefined)).toBe("decide");
    expect([isCallKind("extract"), isCallKind("toString"), isCallKind(3)]).toEqual([true, false, false]);
  });

  it("names a model's family for people, from an id or an alias", () => {
    expect(["claude-opus-5-5", "claude-sonnet-5-5[1m]", "haiku", "claude-fable-5-1", "gpt-x"].map(modelFamily)).toEqual(["Opus", "Sonnet", "Haiku", "Fable", "gpt-x"]);
  });
});

describe("each shared call says what it's for", () => {
  it("carries its kind, so the server picks its model", () => {
    const kinds = [
      extractCall({ stage: "extract", product: "", chunks: [] } as never).kind,
      synthesizeCall({ stage: "synthesize", product: "", tree: [], quotes: [], needs: [] } as never).kind,
      topicsCall({ product: "", topics: [], pages: [], material: [], needs: [] } as never).kind,
      readerCall({ content: "", excerpts: [], goals: [] }).kind,
    ];
    expect(kinds).toEqual(["extract", "synthesize", "topics", "reader"]);
    for (const k of kinds) expect(isCallKind(k)).toBe(true);
    // The goal calls take material built from a whole tree; the compiler holds their kinds.
    expectTypeOf<ReturnType<typeof claimsCall>["kind"]>().toEqualTypeOf<"claims">();
    expectTypeOf<ReturnType<typeof breakdownCall>["kind"]>().toEqualTypeOf<"breakdown">();
    expectTypeOf<ReturnType<typeof jobsCall>["kind"]>().toEqualTypeOf<"jobs">();
    expectTypeOf<ReturnType<typeof bearingsCall>["kind"]>().toEqualTypeOf<"bearings">();
  });

  it("names each setup stage", () => {
    const empty = { audience: "", goals: [], context: "", segments: [] };
    const base = { name: "Basket", about: empty, products: [], goals: [], dump: "Basket is a grocery delivery app in Dubai.", understanding: "", fragments: [], challenges: [], answers: [], rounds: [], last: true };
    expect((["shape", "read", "followup", "place"] as const).map((stage) => setupCall({ ...base, stage } as never).kind)).toEqual(["setup-shape", "setup-read", "setup-followup", "setup-place"]);
  });
});
