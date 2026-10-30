import { describe, expect, expectTypeOf, it } from "vitest";
import { isCallKind, modelFamily, modelFor, READS_THAT_HOLD, supportsFallback, TIER_OF, tierFor, tierOf, type CallKind, type Tier } from "./models";
import { extractCall, synthesizeCall } from "./discovery";
import { topicsCall } from "./topics";
import { setupCall } from "./setup";
import { claimsCall } from "./outside";
import { breakdownCall } from "./breakdown";
import { jobsCall } from "./jobs";
import { bearingsCall } from "./goals";
import { readerCall } from "./code";
import { stepsCall } from "./steps";
import { placeCall, readCall } from "./seen";

const api = { backend: "api" as const, env: {} };
const cli = { backend: "cli" as const, env: {} };

describe("the model each call runs on", () => {
  it("reads on Sonnet, decides on Opus and fetches on Haiku, by default on each engine", () => {
    expect((["decide", "read", "fetch"] as Tier[]).map((t) => modelFor(t, api))).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    // Claude Code takes its own aliases for the cheaper tiers.
    expect((["decide", "read", "fetch"] as Tier[]).map((t) => modelFor(t, cli))).toEqual(["claude-opus-5-5", "sonnet", "haiku"]);
  });

  it('sends every read to the read tier with "balanced", and with "best" only the reads that held there in the eval', () => {
    const reads = (Object.keys(TIER_OF) as CallKind[]).filter((k) => TIER_OF[k] === "read");
    expect(reads.map((k) => tierFor(k, "balanced"))).toEqual(reads.map(() => "read"));
    expect(Object.fromEntries(reads.map((k) => [k, tierFor(k, "best")]))).toEqual({ extract: "decide", topics: "decide", "setup-shape": "read", claims: "read", reader: "decide", research: "decide", "seen-read": "decide" });
    expect([...READS_THAT_HOLD].every((k) => TIER_OF[k] === "read")).toBe(true);
    // Deciding and fetching stay where they are with either mix; a call with no kind decides.
    for (const mix of ["balanced", "best"] as const) expect([tierFor("synthesize", mix), tierFor("connector", mix), tierFor(undefined, mix)]).toEqual(["decide", "fetch", "decide"]);
  });

  it("lets the environment win: the tier's own variable, then the older ones, in their order", () => {
    expect(modelFor("decide", { ...api, env: { QALAM_MODEL_DECIDE: "a", DISCOVERY_MODEL: "b", GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("a");
    expect(modelFor("decide", { ...api, env: { DISCOVERY_MODEL: "b", GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("b");
    expect(modelFor("decide", { ...api, env: { GENERATE_MODEL: "c", CLAUDE_MODEL: "d" } })).toBe("c");
    expect(modelFor("decide", { ...cli, env: { CLAUDE_MODEL: "d" } })).toBe("d");
    expect(modelFor("read", { ...api, env: { QALAM_MODEL_READ: "r", DISCOVERY_MODEL: "b" } })).toBe("r");
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
    expect(by("read")).toEqual(["claims", "extract", "reader", "research", "seen-read", "setup-shape", "topics"]);
    expect(by("fetch")).toEqual(["connector", "numbers"]);
    expect(by("decide")).toEqual(["ask", "bearings", "breakdown", "draft", "dump-followup", "dump-place", "dump-read", "followups", "jobs", "review", "seen-place", "setup-followup", "setup-place", "setup-read", "steps", "synthesize"]);
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
    expectTypeOf<ReturnType<typeof stepsCall>["kind"]>().toEqualTypeOf<"steps">();
    expectTypeOf<ReturnType<typeof readCall>["kind"]>().toEqualTypeOf<"seen-read">();
    expectTypeOf<ReturnType<typeof placeCall>["kind"]>().toEqualTypeOf<"seen-place">();
  });

  it("names each setup stage", () => {
    const empty = { audience: "", goals: [], context: "", segments: [] };
    const base = { name: "Basket", about: empty, products: [], goals: [], dump: "Basket is a grocery delivery app in Dubai.", understanding: "", fragments: [], challenges: [], answers: [], rounds: [], last: true };
    expect((["shape", "read", "followup", "place"] as const).map((stage) => setupCall({ ...base, stage } as never).kind)).toEqual(["setup-shape", "setup-read", "setup-followup", "setup-place"]);
  });
});
