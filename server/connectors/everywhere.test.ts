import { afterEach, describe, expect, it } from "vitest";
import type { Candidate, ToolRun } from "@/connectors/everywhere";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import type { FindDeps } from "@/connectors/suggest";
import { setLab } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import type { OrgStore } from "../org/store";
import { bringIn, findEverywhere, lookEverywhere, type BringDeps, type LookDeps } from "./everywhere";

const state = (id: string, o: Partial<ConnectorState> = {}): ConnectorState =>
  ({ id, label: id[0].toUpperCase() + id.slice(1), group: "docs", feeds: "material", imports: true, status: null, numbers: false, screens: false, claudeCode: null, token: null, canToken: false, tokenHelp: null, canSignIn: true, needsClient: false, account: null, regions: null, ownApp: null, via: "oauth", word: "Connected", tone: "ok", ...o }) as ConnectorState;

const NOTION = state("notion");
const SLACK = state("slack", { group: "voice" });
const POSTHOG = state("posthog", { label: "PostHog", group: "numbers", imports: false, numbers: true, via: "claude-code" });
const INTERCOM = state("intercom", { group: "voice", via: "claude-code" });

const page = (id: string, title: string, o: Partial<Hit> = {}): Hit => ({ id, title, url: `https://example.test/${id}`, ...o });

type Call = { tool: string; step: "search" | "pick"; text: string; again: boolean };

/**
 * A model that writes each tool's searches from a table and picks the results whose titles have a
 * word the test names, and tools whose searches answer from a table: what each searcher was sent is
 * recorded, so a test can say what it heard.
 */
function fake(o: {
  connectors: ConnectorState[];
  searches?: Record<string, string[]>;
  results: Record<string, Record<string, Hit[]>>;
  pickWord?: Record<string, string>;
  again?: Record<string, string[]>;
  texts?: Record<string, string>;
  numbers?: Record<string, InsightNumbers>;
  known?: { id: string; origin?: string }[];
  failSearch?: Record<string, string>;
  hangPick?: string[];
}) {
  const calls: Call[] = [];
  const searched: { tool: string; words: readonly string[] }[] = [];
  const read: string[] = [];
  const traces: Record<string, unknown>[] = [];
  const toolOf = (text: string) => /The tool: (\w+)/.exec(text)?.[1].toLowerCase() ?? "?";
  const deps: LookDeps = {
    structured: (async (call: { content: { text: string }[]; schema: { properties: Record<string, unknown> } }) => {
      const text = call.content[0].text;
      const tool = toolOf(text) === "posthog" ? "posthog" : toolOf(text);
      const step = "searches" in call.schema.properties ? "search" : "pick";
      calls.push({ tool, step, text, again: "again" in call.schema.properties });
      if (step === "search") return { data: { searches: o.searches?.[tool] ?? ["checkout drop-off"] } };
      if (o.hangPick?.includes(tool)) return new Promise(() => {});
      const lines = [...text.matchAll(/^h(\d+): ([^|\n]+)/gm)];
      const word = o.pickWord?.[tool] ?? "checkout";
      const picks = lines.filter((m) => m[2].toLowerCase().includes(word)).map((m) => ({ id: `h${m[1]}`, why: "Its title is about it" }));
      return { data: { picks, again: picks.length ? [] : (o.again?.[tool] ?? []) } };
    }) as unknown as LookDeps["structured"],
    connectors: async () => o.connectors,
    search: async (t, words) => {
      searched.push({ tool: t.id, words });
      if (o.failSearch?.[t.id]) return words.map(() => new Error(o.failSearch![t.id]));
      return words.map((w) => o.results[t.id]?.[w] ?? []);
    },
    read: async (t, hits) => {
      read.push(...hits.map((h) => `${t.id}:${h.id}`));
      return hits.map((h) => o.texts?.[h.id] ?? null);
    },
    numbers: async (_t, hits) => hits.map((h) => o.numbers?.[h.id] ?? null),
    known: async () => o.known ?? [],
    terms: async () => ({ gone: [], terms: [{ id: "t1", term: "Basket", means: "What people put in to order, before they pay.", avoid: ["cart"], by: "you", at: 0 }] }),
    now: Date.now,
    trace: async (t) => void traces.push(t),
  };
  return { deps, calls, searched, read, traces };
}

const look = (deps: LookDeps, about = "What do we know about checkout drop-off?", signal?: AbortSignal) => {
  const lines: ToolRun[] = [];
  return { lines, result: lookEverywhere({ about }, (l) => void lines.push(l.run as ToolRun), signal, deps) };
};

afterEach(() => setLab(true));

describe("a look across every connected tool", () => {
  it("sends each tool its own searcher, which hears only its own tool and results", async () => {
    const f = fake({
      connectors: [NOTION, SLACK, POSTHOG, state("linear", { group: "build", imports: false })],
      searches: { notion: ["checkout research"], slack: ["checkout broken"], posthog: ["checkout funnel"] },
      results: {
        notion: { "checkout research": [page("n1", "Checkout research Q3"), page("n2", "Pricing page notes")] },
        slack: { "checkout broken": [page("s1", "#growth: checkout keeps timing out")] },
        posthog: { "checkout funnel": [page("42", "Checkout funnel", { url: undefined })] },
      },
      texts: { n1: "Some background on the quarter.\n\n38% of people leave at the address step of checkout, the research found.", s1: "Anyone seen checkout time out on the address step again today?" },
      numbers: { "42": { name: "Checkout funnel", series: [{ label: "Paid", value: 3050 }] } },
    });
    const { lines, result } = look(f.deps);
    const r = await result;
    // Linear holds work, not material: no searcher.
    expect(r.runs.map((x) => [x.tool, x.state, x.calls])).toEqual([
      ["notion", "done", 2],
      ["slack", "done", 2],
      ["posthog", "done", 2],
    ]);
    for (const c of f.calls.filter((x) => x.tool === "notion")) expect(c.text).not.toMatch(/Slack|timing out|Checkout funnel/);
    for (const c of f.calls.filter((x) => x.tool === "slack")) expect(c.text).not.toMatch(/Notion|Checkout research Q3|Checkout funnel/);
    // Picks are ticked; what the tool found that the searcher left comes after, unticked.
    expect(r.candidates.map((c) => [c.key, c.picked])).toEqual([
      ["notion:n1", true],
      ["notion:n2", false],
      ["slack:s1", true],
      ["posthog:42", true],
    ]);
    expect(r.candidates[0].passages).toEqual(["38% of people leave at the address step of checkout, the research found."]);
    expect(r.candidates[3].numbers).toEqual([{ label: "Paid", value: 3050 }]);
    // PostHog is reached through Claude Code: its picks aren't read for passages, only its chart's number.
    expect(f.read).toEqual(["notion:n1", "slack:s1"]);
    // Started (writing its searches), searching, what came back, picking, reading, done.
    expect(lines.filter((l) => l.tool === "notion").map((l) => [l.state, l.seen])).toEqual([
      ["searching", 0],
      ["searching", 0],
      ["searching", 2],
      ["picking", 2],
      ["reading", 2],
      ["done", 2],
    ]);
    expect(f.traces[0]).toMatchObject({ kind: "look", about: "What do we know about checkout drop-off?" });
  });

  it("runs them side by side, not one after another", async () => {
    let started = 0;
    let both!: () => void;
    const together = new Promise<void>((r) => (both = r));
    const f = fake({ connectors: [NOTION, SLACK], results: {} });
    f.deps.search = async (_t, words) => {
      if (++started === 2) both();
      await Promise.race([together, new Promise((_, no) => setTimeout(() => no(new Error("one at a time")), 1000))]);
      return words.map(() => []);
    };
    const r = await look(f.deps).result;
    expect(r.runs.map((x) => x.state)).toEqual(["done", "done"]);
  });

  it("hears the project's words the question uses", async () => {
    const f = fake({ connectors: [NOTION], results: {} });
    await look(f.deps, "Why do carts get abandoned?").result;
    expect(f.calls[0].text).toContain("Basket (not: cart)");
  });

  it("searches again once, only when nothing fits, and stops at three calls", async () => {
    const f = fake({
      connectors: [NOTION],
      searches: { notion: ["checkout drop-off"] },
      results: { notion: { "checkout drop-off": [page("n1", "Pricing page notes")], "basket abandonment": [page("n2", "Basket abandonment study")] } },
      pickWord: { notion: "basket" },
      again: { notion: ["basket abandonment"] },
    });
    const r = await look(f.deps).result;
    expect(f.searched.map((s) => s.words)).toEqual([["checkout drop-off"], ["basket abandonment"]]);
    expect(f.calls.map((c) => [c.step, c.again])).toEqual([
      ["search", false],
      ["pick", true],
      ["pick", false],
    ]);
    expect(r.runs[0]).toMatchObject({ state: "done", calls: 3, picked: 1, searched: ["checkout drop-off", "basket abandonment"] });
    expect(r.candidates.filter((c) => c.picked).map((c) => c.hit.title)).toEqual(["Basket abandonment study"]);
  });

  it("doesn't search again through Claude Code, where each round of searches is a minute's run", async () => {
    const f = fake({ connectors: [state("notion", { via: "claude-code" })], results: { notion: { "checkout drop-off": [page("n1", "Pricing page notes")] } }, pickWord: { notion: "basket" }, again: { notion: ["basket abandonment"] } });
    const r = await look(f.deps).result;
    expect(f.calls.map((c) => [c.step, c.again])).toEqual([
      ["search", false],
      ["pick", false],
    ]);
    expect(r.runs[0]).toMatchObject({ state: "done", calls: 2, picked: 0 });
    expect(r.candidates.map((c) => [c.key, c.picked])).toEqual([["notion:n1", false]]);
  });

  it("goes on when a tool fails, saying why in its own words", async () => {
    const f = fake({ connectors: [NOTION, SLACK], results: { notion: { "checkout drop-off": [page("n1", "Checkout research")] } }, failSearch: { slack: "Slack says the app isn't allowed in this workspace." } });
    const r = await look(f.deps).result;
    expect(r.runs.map((x) => [x.tool, x.state, x.why])).toEqual([
      ["notion", "done", undefined],
      ["slack", "failed", "Slack says the app isn't allowed in this workspace."],
    ]);
    expect(r.candidates.map((c) => c.key)).toEqual(["notion:n1"]);
  });

  it("hands back what a searcher found by its time, unticked", async () => {
    const f = fake({ connectors: [NOTION, SLACK], results: { notion: { "checkout drop-off": [page("n1", "Checkout research")] }, slack: { "checkout drop-off": [page("s1", "checkout thread")] } }, hangPick: ["slack"] });
    f.deps.times = { directMs: 150 };
    const r = await look(f.deps).result;
    expect(r.runs.map((x) => [x.tool, x.state])).toEqual([
      ["notion", "done"],
      ["slack", "late"],
    ]);
    expect(r.candidates.map((c) => [c.key, c.picked])).toEqual([
      ["notion:n1", true],
      ["slack:s1", false],
    ]);
  });

  it("stops every searcher when the person stops it", async () => {
    const f = fake({ connectors: [NOTION, SLACK], results: {}, hangPick: ["notion", "slack"] });
    f.deps.search = async (_t, words) => words.map(() => [page("x", "checkout")]);
    const stop = new AbortController();
    const { lines, result } = look(f.deps, "checkout drop-off", stop.signal);
    setTimeout(() => stop.abort(), 50);
    await expect(result).rejects.toThrow(/Stopped/);
    expect(lines.filter((l) => l.state === "stopped").map((l) => l.tool).sort()).toEqual(["notion", "slack"]);
  });

  it("keeps the same item once and marks what's already a source", async () => {
    const shared = "https://www.notion.so/Checkout-research-1a2b3c";
    const f = fake({
      connectors: [NOTION, SLACK],
      results: { notion: { "checkout drop-off": [page("n1", "Checkout research", { url: shared }), page("n2", "Checkout FAQ")] }, slack: { "checkout drop-off": [page("s1", "Checkout research", { url: `${shared}?pvs=4` })] } },
      known: [{ id: "src_faq", origin: "https://example.test/n2" }],
    });
    const r = await look(f.deps).result;
    const pick = (key: string) => r.candidates.find((c) => c.key === key) as Candidate;
    expect(r.candidates.map((c) => c.key)).toEqual(["notion:n1", "notion:n2"]);
    expect(pick("notion:n1").also).toEqual(["Slack"]);
    expect([pick("notion:n2").inSources, pick("notion:n2").picked]).toEqual(["src_faq", false]);
  });

  it("says so when no tool is connected to look in", async () => {
    const f = fake({ connectors: [state("notion", { via: null, tone: "off" })], results: {} });
    await expect(look(f.deps).result).rejects.toThrow(/No tool is connected/);
  });

  it("leaves out tools v0.1 hides", async () => {
    setLab([]);
    const f = fake({ connectors: [NOTION, SLACK, INTERCOM], results: {} });
    expect((await look(f.deps).result).runs.map((r) => r.tool)).toEqual(["notion"]);
  });
});

describe("bringing the picks in", () => {
  const store = {} as OrgStore;
  const deps = (o: { numbers?: InsightNumbers; failImport?: boolean } = {}) => {
    const imported: { tool: string; ids: string[]; scope?: unknown }[] = [];
    const captured: { title: string; origin?: string; text: string; basis?: string; scope?: unknown }[] = [];
    const d: BringDeps = {
      importItems: (async (_s: OrgStore, tool: string, hits: Hit[], _emit: unknown, opts: { scope?: unknown }) => {
        if (o.failImport) throw new Error("Slack stopped taking Qalam's sign-in.");
        imported.push({ tool, ids: hits.map((h) => h.id), ...(opts.scope ? { scope: opts.scope } : {}) });
        return { added: hits.map((h) => h.title), skipped: [], failed: [], sources: hits.map((h) => `src_${h.id}`), pages: ["checkout-drop-off"] };
      }) as unknown as BringDeps["importItems"],
      readChart: async () => o.numbers ?? { series: [] },
      capture: (async (_s: OrgStore, ing: { title: string; origin?: string; text: string }, opts: { basis?: string; scope?: unknown }) => {
        captured.push({ ...ing, ...(opts.basis ? { basis: opts.basis } : {}), ...(opts.scope ? { scope: opts.scope } : {}) });
        return { sourceId: "src_chart", title: ing.title, quotes: 0, needs: 0, points: {}, placed: [], filed: { pages: [{ id: "checkout-drop-off", title: "Checkout drop-off" }] } };
      }) as unknown as BringDeps["capture"],
      now: () => Date.UTC(2026, 10, 7),
    };
    return { d, imported, captured };
  };

  it("takes them in tool by tool, a card's look only under its card", async () => {
    const { d, imported } = deps();
    const scope = { b1: ["card1"] };
    const r = await bringIn(store, [{ tool: "notion", hit: page("n1", "Checkout research") }, { tool: "slack", hit: page("s1", "#growth thread") }, { tool: "notion", hit: page("n2", "Checkout FAQ") }], () => {}, { scope }, d);
    expect(imported).toEqual([
      { tool: "notion", ids: ["n1", "n2"], scope },
      { tool: "slack", ids: ["s1"], scope },
    ]);
    expect(r).toMatchObject({ added: ["Checkout research", "Checkout FAQ", "#growth thread"], sources: ["src_n1", "src_n2", "src_s1"], pages: ["checkout-drop-off"] });
  });

  it("keeps a saved chart as a source of what was measured, read again as it's taken in", async () => {
    const { d, captured } = deps({ numbers: { name: "Checkout funnel", series: [{ label: "Paid", value: 3050 }] } });
    const r = await bringIn(store, [{ tool: "posthog", hit: { id: "42", title: "Checkout funnel" } }], () => {}, {}, d);
    expect(captured).toEqual([{ kind: "connector", title: "Checkout funnel", origin: "posthog:42", text: "Checkout funnel: a saved chart in PostHog, read on 7 November 2026.\nPaid: 3050", basis: "measured" }]);
    expect(r).toMatchObject({ added: ["Checkout funnel"], sources: ["src_chart"], pages: ["checkout-drop-off"] });
  });

  it("says why when a chart has no number or a tool can't give its items", async () => {
    const { d } = deps({ failImport: true });
    const r = await bringIn(store, [{ tool: "amplitude", hit: { id: "c9", title: "Retention" } }, { tool: "slack", hit: page("s1", "#growth thread") }], () => {}, {}, d);
    expect(r.failed).toEqual([
      { title: "Retention", why: "It has no number Qalam can read." },
      { title: "#growth thread", why: "Slack stopped taking Qalam's sign-in." },
    ]);
  });
});

describe("under a question: every tool searched with its words, no model call", () => {
  it("searches each tool Qalam reaches itself in one request, showing a passage two tools both have once", async () => {
    const passage = "Most people who leave checkout do it at the address step, where the form asks for too much.";
    const deps: FindDeps = {
      browse: async (id) => (id === "notion" ? [page("n1", "Checkout research")] : id === "drive" ? [page("d1", "Checkout research (copy)")] : Promise.reject(new Error("refused"))),
      read: async (_id, hits) => hits.map((h) => ({ id: h.id, text: `${passage}\n\nAnother part about pricing.` })),
      charts: async () => [],
      numbers: async () => ({ series: [] }),
    };
    const found = await findEverywhere({ kind: "docs", lookFor: "checkout address step" }, "Where do people leave checkout?", {
      connectors: async () => [NOTION, state("drive", { label: "Google Drive", via: "google" }), state("confluence", { via: "oauth" }), state("slack", { group: "voice" }), state("intercom", { via: "claude-code" })],
      deps,
    });
    // Slack isn't a docs tool, and a tool reached through Claude Code waits for a press.
    expect(found.map((f) => [f.tool, f.finds?.map((x) => x.text) ?? null])).toEqual([
      ["notion", [passage]],
      ["drive", []],
      ["confluence", null],
    ]);
  });
});
