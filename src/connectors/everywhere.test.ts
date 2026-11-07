import { afterEach, describe, expect, it } from "vitest";
import { setLab } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import { NUMBER_RECIPES } from "./analytics";
import { canonAddress, chartText, findsOf, firstSearches, LIMITS, looksLikeWrite, mergeFound, readOnly, resultsToSend, stepPicks, stepSearches, toolsToLook, wordsFor, type Candidate } from "./everywhere";
import { RECIPES, type Hit } from "./recipes";

const tool = (id: string, o: Partial<ConnectorState> = {}): ConnectorState =>
  ({ id, label: id[0].toUpperCase() + id.slice(1), group: "docs", feeds: "material", imports: true, status: null, numbers: false, screens: false, claudeCode: null, token: null, canToken: false, tokenHelp: null, canSignIn: true, needsClient: false, account: null, regions: null, ownApp: null, via: "oauth", word: "Connected", tone: "ok", ...o }) as ConnectorState;

const hit = (id: string, title: string, o: Partial<Hit> = {}): Hit => ({ id, title, ...o });

afterEach(() => setLab(true));

describe("which tools a look sends searchers to", () => {
  const all = [tool("notion"), tool("drive", { via: null, tone: "off", word: "Needs setup" }), tool("slack", { group: "voice" }), tool("intercom", { group: "voice", via: "claude-code", word: "Through Claude Code" }), tool("posthog", { group: "numbers", imports: false, numbers: true, via: "claude-code" }), tool("linear", { group: "build", imports: false })];

  it("takes every connected one holding material or numbers, saying which go through Claude Code", () => {
    expect(toolsToLook(all).map((t) => [t.id, t.holds, t.slow])).toEqual([
      ["notion", "docs", false],
      ["slack", "messages", false],
      ["intercom", "conversations", true],
      ["posthog", "charts", true],
    ]);
  });

  it("leaves out what v0.1 hides (customer voice without the connectors switch), and keeps to the tools asked for", () => {
    setLab([]);
    expect(toolsToLook(all).map((t) => t.id)).toEqual(["notion", "posthog"]);
    setLab(true);
    expect(toolsToLook(all, ["slack"]).map((t) => t.id)).toEqual(["slack"]);
  });
});

describe("a searcher's steps, as code keeps them", () => {
  it("keeps its own searches, each once, none it ran already, cut to size", () => {
    expect(stepSearches({ searches: ["checkout drop-off", "Checkout drop-off", "x", "payment errors", "basket abandonment", "address step"] }, { max: 3, searched: ["payment errors"] })).toEqual(["checkout drop-off", "basket abandonment", "address step"]);
    expect(stepSearches({ searches: "not a list" }, { max: 3, searched: [] })).toEqual([]);
  });

  it("falls back on the question's own words when the first step writes none", () => {
    expect(firstSearches({ searches: [] }, "  what do we know about\ncheckout drop-off? ")).toEqual(["what do we know about checkout drop-off?"]);
    expect(firstSearches({ searches: ["a1", "b2", "c3", "d4"] }, "q")).toHaveLength(LIMITS.first);
  });

  const sent = [hit("p1", "Checkout research Q3", { snippet: "38% leave at the address step" }), hit("p2", "Pricing page notes"), hit("p3", "Payment errors log")];

  it("keeps a pick only as a result it was sent, each once, with a why whose numbers are in the result", () => {
    const { picks, again } = stepPicks({ picks: [{ id: "h1", why: "Says 38% leave at the address step" }, { id: "h1", why: "again" }, { id: "h9", why: "made up" }, { id: "h3", why: "Errors, 12% of payments" }], again: ["other words"] }, sent, { max: 5, again: 2, searched: [] });
    expect(picks.map((p) => [p.hit.id, p.why])).toEqual([
      ["p1", "Says 38% leave at the address step"],
      ["p3", undefined],
    ]);
    // Something fit, so it doesn't search again.
    expect(again).toEqual([]);
  });

  it("searches again only when nothing fits and it still may, with words it hasn't run", () => {
    expect(stepPicks({ picks: [], again: ["checkout drop-off", "cart abandonment"] }, sent, { max: 5, again: 2, searched: ["checkout drop-off"] }).again).toEqual(["cart abandonment"]);
    expect(stepPicks({ picks: [], again: ["cart abandonment"] }, sent, { max: 5, again: 0, searched: [] }).again).toEqual([]);
  });

  it("holds the picks to the step's limit", () => {
    expect(stepPicks({ picks: [{ id: "h1", why: "" }, { id: "h2", why: "" }, { id: "h3", why: "" }] }, sent, { max: 2, again: 0, searched: [] }).picks).toHaveLength(2);
  });

  it("sends each result once, never a folder or what it can't read, at most the limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => hit(`m${i}`, `Doc ${i}`));
    const sentNow = resultsToSend([[hit("a", "A"), hit("f", "Folder", { folder: true }), hit("x", "Database", { type: "other" })], [hit("a", "A again"), ...many]]);
    expect(sentNow[0]).toEqual(hit("a", "A"));
    expect(sentNow.some((h) => h.id === "f" || h.id === "x")).toBe(false);
    expect(sentNow).toHaveLength(LIMITS.seen);
  });

  it("hears the project's words the question uses, a term or a word to avoid for it", () => {
    const terms = { gone: [], terms: [{ id: "t1", term: "Basket", means: "What people put in to order, before they pay.", avoid: ["cart"], by: "you" as const, at: 0 }, { id: "t2", term: "Slot", means: "A delivery window.", avoid: [], by: "you" as const, at: 0 }] };
    expect(wordsFor(terms, "Why do carts get abandoned at checkout?")).toEqual(["Basket (not: cart): What people put in to order, before they pay."]);
    expect(wordsFor(terms, "What scarted it?")).toEqual([]);
    expect(wordsFor(null, "anything")).toEqual([]);
  });
});

describe("what a look found, merged", () => {
  const c = (tool: string, h: Hit, picked = true): Candidate => ({ key: `${tool}:${h.id}`, tool, hit: h, origin: h.url ?? `${tool}:${h.id}`, picked });

  it("knows the same address however it's written", () => {
    expect(canonAddress("https://WWW.Notion.so/Checkout-1a2b?pvs=4#top")).toBe("https://www.notion.so/Checkout-1a2b");
    expect(canonAddress("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing")).toBe(canonAddress("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/view"));
    expect(canonAddress("https://acme.slack.com/archives/C1/p1700000000000100?thread_ts=1700000000.000100&utm_source=x")).toBe("https://acme.slack.com/archives/C1/p1700000000000100?thread_ts=1700000000.000100");
    expect(canonAddress("intercom:conversation_9")).toBe("intercom:conversation_9");
  });

  it("keeps the same item once, saying where else it was found, in the tools' order", () => {
    const merged = mergeFound(
      [
        [c("notion", hit("n1", "Checkout research", { url: "https://www.notion.so/Checkout-1a2b" })), c("notion", hit("n2", "Pricing", { url: "https://www.notion.so/Pricing-3c4d" }), false)],
        [c("slack", hit("s1", "Checkout research", { url: "https://www.notion.so/Checkout-1a2b?pvs=4" })), c("slack", hit("s2", "#growth thread", { url: "https://acme.slack.com/archives/C1/p1700000000000100" }))],
      ],
      [],
      (t) => (t === "slack" ? "Slack" : "Notion"),
    );
    expect(merged.map((x) => [x.key, x.also])).toEqual([
      ["notion:n1", ["Slack"]],
      ["notion:n2", undefined],
      ["slack:s2", undefined],
    ]);
  });

  it("marks what's already a source and leaves it unticked", () => {
    const [had] = mergeFound([[c("notion", hit("n1", "Checkout research", { url: "https://www.notion.so/Checkout-1a2b" }))]], [{ id: "src_1", origin: "https://www.notion.so/Checkout-1a2b?pvs=4" }]);
    expect([had.inSources, had.picked]).toEqual(["src_1", false]);
  });

  it("lists a searcher's picks ticked, then what its tool found that it left, folded and unticked", () => {
    const seen = [hit("a", "A"), hit("b", "B"), ...Array.from({ length: 8 }, (_, i) => hit(`m${i}`, `M${i}`))];
    const finds = findsOf("notion", [{ hit: seen[1], why: "fits" }], seen);
    expect(finds.slice(0, 2).map((x) => [x.hit.id, x.picked, x.why])).toEqual([
      ["b", true, "fits"],
      ["a", false, undefined],
    ]);
    expect(finds.filter((x) => !x.picked)).toHaveLength(LIMITS.more);
  });
});

describe("Qalam only reads", () => {
  it("refuses a tool whose name says it writes, whatever its server", () => {
    for (const name of ["notion-update-page", "notion-create-pages", "notion-delete-pages", "save_chart_edits", "rename_chart", "createJiraIssue", "use_amp_flags_update", "notion-create-comment"]) expect(looksLikeWrite(name)).toBe(true);
    for (const name of ["notion-search", "notion-list-shared-pages", "getAccessibleAtlassianResources", "searchConfluenceUsingCql", "query_amplitude_data", "slack_read_thread", "Get-Report"]) expect(looksLikeWrite(name)).toBe(false);
  });

  it("calls only a tool's read tools, and PostHog's one tool only with a read command", () => {
    expect(readOnly("notion", { tool: "notion-search", args: { query: "x" } })).toBe(true);
    expect(readOnly("notion", { tool: "notion-move-pages", args: {} })).toBe(false);
    expect(readOnly("amplitude", { tool: "use_amp_experiments", args: {} })).toBe(false);
    expect(readOnly("posthog", { tool: "exec", args: { command: 'call --json insights-list {"search":"x"}' } })).toBe(true);
    expect(readOnly("posthog", { tool: "exec", args: { command: 'call --json insight-update {"id":1}' } })).toBe(false);
    // Mixpanel's real names aren't known yet: only what a name says is checked.
    expect(readOnly("mixpanel", { tool: "Run-Segmentation-Query", args: {} })).toBe(true);
    expect(readOnly("mixpanel", { tool: "Delete-Report", args: {} })).toBe(false);
  });

  it("lets through every call the recipes plan", () => {
    const hitFor = { id: "x1", title: "X", site: "site-1" };
    for (const [id, r] of Object.entries(RECIPES)) {
      const calls = [r.search("words", "site-1"), r.fetch(hitFor), ...(r.recent ? [r.recent()] : []), ...(r.list ? [r.list(null), r.list("shared"), r.list("private"), r.list("page-id")] : []), ...(r.site ? [r.site.call] : [])];
      for (const call of calls) expect(readOnly(id, call), `${id} ${call.tool}`).toBe(true);
    }
    for (const [id, r] of Object.entries(NUMBER_RECIPES)) {
      const calls = [r.search("words", "p1"), r.read("42", "p1"), ...(r.project ? [r.project.call] : []), ...(r.events ? [r.events.search("signup"), r.events.count({ event: "signup", days: 30, project: "p1" }), ...(r.events.places ? [r.events.places.call] : [])] : [])];
      for (const call of calls) expect(readOnly(id, call), `${id} ${call.tool}`).toBe(true);
    }
  });
});

describe("a saved chart as a source", () => {
  it("holds its name and numbers as the tool gave them, and when they were read", () => {
    const text = chartText({ title: "Checkout funnel", tool: "PostHog", at: Date.UTC(2026, 10, 7), description: "Cart to paid, last 30 days", numbers: { name: "Checkout funnel", series: [{ label: "Paid", value: 3050 }], steps: [{ label: "Viewed cart", count: 12340 }, { label: "Paid", count: 3050 }] } });
    expect(text.split("\n")).toEqual(["Checkout funnel: a saved chart in PostHog, read on 7 November 2026.", "Cart to paid, last 30 days", "Paid: 3050", "Its steps: Viewed cart 12340, Paid 3050"]);
  });
});
