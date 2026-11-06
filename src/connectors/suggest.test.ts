import { afterEach, describe, expect, it, vi } from "vitest";
import { setLab } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import { fillAnswer, OTHER, type Question } from "@/ui/ai/questionFlow";
import { sanitizeQuestions, toQuestion } from "@/ui/ai/plan";
import { amplitudeCount, amplitudeEvents, amplitudeNumbers, amplitudePlaces, chartNumbers, countsEvents, eventRef, firstProject, fitCall, NUMBER_RECIPES, posthogEvents, readEventRef, savedCharts } from "./analytics";
import { sanitizePicks, sanitizeSearches } from "./look";
import { notionHits, notionText } from "./recipes";
import { findIn, numberLine, passagesFor, searchedAlone, toolAsk, toolsForAsk } from "./suggest";
import type { Hit } from "./recipes";

const tool = (o: Partial<ConnectorState>) => ({ id: "x", label: "X", group: "docs", imports: false, numbers: false, needsClient: false, via: null, tone: "off", claudeCode: null, ...o }) as ConnectorState;

afterEach(() => setLab(true));

describe("a tool that could answer a question", () => {
  it("keeps only a kind it knows, and the words to search for", () => {
    expect(toolAsk("numbers", "  activation   funnel ")).toEqual({ kind: "numbers", lookFor: "activation funnel" });
    expect(toolAsk("docs", "")).toEqual({ kind: "docs" });
    expect(toolAsk("none", "x")).toBeUndefined();
    expect(toolAsk("slack", "x")).toBeUndefined();
  });

  it("reaches a question through the model's fields, and leaves it open for what comes back", () => {
    const [q] = sanitizeQuestions([{ id: "a", title: "Where does it stand?", why: "", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], recommended: [], allowOther: false, from: "numbers", look_for: "activation" }]);
    expect(q.tool).toEqual({ kind: "numbers", lookFor: "activation" });
    const asked = toQuestion(q);
    expect(asked.tool).toEqual({ kind: "numbers", lookFor: "activation" });
    expect(asked.kind === "single" && asked.other).toBeTruthy();
    expect(sanitizeQuestions([{ id: "b", title: "Which do you prefer?", from: "none" }])[0].tool).toBeUndefined();
  });

  it("offers analytics for numbers and docs for docs, connected first, never what this copy can't reach", () => {
    const list = [
      tool({ id: "posthog", group: "numbers", numbers: true }),
      tool({ id: "amplitude", group: "numbers", numbers: true, via: "oauth", tone: "ok" }),
      tool({ id: "notion", group: "docs", imports: true }),
      tool({ id: "drive", group: "docs", imports: true, needsClient: true }),
      tool({ id: "slack", group: "voice", imports: true }),
    ];
    expect(toolsForAsk({ kind: "numbers" }, list).map((c) => c.id)).toEqual(["amplitude", "posthog"]);
    expect(toolsForAsk({ kind: "docs" }, list).map((c) => c.id)).toEqual(["notion"]);
    setLab([]);
    expect(toolsForAsk({ kind: "numbers" }, list).map((c) => c.id)).toEqual(["amplitude", "posthog"]);
  });

  it("finds the passages nearest what was asked, in their own words", () => {
    const text = "Our office moved to a new building last spring, near the river.\n\nActivation fell to 31% after the signup change in March.\n\nshort";
    expect(passagesFor(text, "Where does activation stand after signup?")[0]).toBe("Activation fell to 31% after the signup change in March.");
    expect(passagesFor(text, "x")).not.toContain("short");
  });

  it("puts what came back in the answer, however the question takes words", () => {
    const text: Question = { id: "t", kind: "text", title: "T", maxLength: 1200 };
    expect(fillAnswer(text, { kind: "text", text: "We think so" }, "31 (Activation, from PostHog)")).toEqual({ kind: "text", text: "We think so\n31 (Activation, from PostHog)" });
    const single: Question = { id: "s", kind: "single", title: "S", options: [{ value: "a", label: "A" }] };
    expect(fillAnswer(single, { kind: "single", value: "a" }, "31")).toEqual({ kind: "single", value: OTHER, other: "31" });
    const multi: Question = { id: "m", kind: "multi", title: "M", groups: [] };
    expect(fillAnswer(multi, { kind: "multi", values: ["a"], custom: [] }, "31")).toEqual({ kind: "multi", values: ["a"], custom: ["31"] });
  });

  it("says the number first, since that's what's read back", () => {
    expect(numberLine(31.5, { series: "Conversion", chart: "D7 activation", tool: "Mixpanel" })).toBe("31.5 (Conversion, D7 activation, from Mixpanel)");
  });
});

describe("analytics tools we can't see the schema of", () => {
  const call = { tool: "query_amplitude_data", also: ["query_chart"], args: { chartId: "c1", project: "9" }, aliases: { chartId: ["chart_id"], project: ["projectId"] } };

  it("fits a call to the schema the server gives", () => {
    expect(fitCall(call, { query_chart: { properties: { chart_id: {}, projectId: {} } } })).toEqual({ tool: "query_chart", args: { chart_id: "c1", projectId: "9" } });
  });

  it("finds a tool by what its name looks like when it goes by another name", () => {
    expect(fitCall({ tool: "search", like: /search/i, args: { query: "x" }, aliases: { query: ["q"] } }, { amplitude_search: { properties: { q: {} } }, get_charts: { properties: {} } })).toEqual({ tool: "amplitude_search", args: { q: "x" } });
  });

  it("leaves out an argument the tool doesn't take, and sends it as planned with no schema", () => {
    expect(fitCall(call, { query_amplitude_data: { properties: { chartId: {} } } }).args).toEqual({ chartId: "c1" });
    expect(fitCall(call)).toEqual({ tool: "query_amplitude_data", args: { chartId: "c1", project: "9" } });
  });

  it("finds saved charts, not other things with names", () => {
    const answer = JSON.stringify({ results: [{ id: "c1", name: "Activation", type: "chart" }, { id: "e1", name: "Signed up", type: "event" }, { bookmark_id: 7, title: "Weekly funnel", entity_type: "funnels" }] });
    expect(savedCharts(answer).map((h) => [h.id, h.title])).toEqual([["c1", "Activation"], ["7", "Weekly funnel"]]);
  });

  it("finds the first project", () => {
    expect(firstProject(JSON.stringify({ projects: [{ project_id: 12, name: "App" }, { project_id: 13 }] }))).toBe("12");
  });

  it("reads a series by date as its latest day, and skips ids and paging", () => {
    const answer = JSON.stringify({ name: "Signups", id: 99, page: 1, series: { "Signed up": { "2026-10-02": 40, "2026-10-01": 30 } } });
    const read = chartNumbers(answer);
    expect(read.name).toBe("Signups");
    expect(read.series).toEqual([{ label: "Signed up", value: 40 }]);
  });

  it("reads a list's last number, and a field named for a value", () => {
    expect(chartNumbers(JSON.stringify({ data: { series: [[1, 2, 3]] } })).series[0].value).toBe(3);
    expect(chartNumbers(JSON.stringify({ overall_conv_ratio: 0.42, limit: 50 })).series).toEqual([{ label: "overall_conv_ratio", value: 0.42 }]);
  });

  it("finds no number in words", () => {
    expect(chartNumbers("The chart has no data.").series).toEqual([]);
  });
});

// The shapes Amplitude's server answered with (November 2026), shortened.
describe("reading Amplitude", () => {
  it("finds a saved chart among search results, and not an event", () => {
    const answer = JSON.stringify({ results: [{ score: 0, entity: { id: "abc123", type: "CHART", name: "Weekly budgets", description: "", entityRef: { orgId: 1, appId: 2, value: "abc123" } } }, { score: 0, entity: { id: "Budget Created", type: "EVENT", name: "Budget Created", entityRef: { orgId: 1, appId: 2, value: "Budget Created" } } }], totalHits: 2 });
    expect(savedCharts(answer)).toEqual([{ id: "abc123", title: "Weekly budgets" }]);
  });

  it("asks for what its server lists, with no project", () => {
    expect(NUMBER_RECIPES.amplitude.project).toBeUndefined();
    const tools = { search_amp_data_taxonomy: { properties: {} }, search_amp_entities: { properties: { queries: {}, entityTypes: {}, limitPerQuery: {}, rationale: {} } }, get_amplitude_charts: { properties: { chartIds: {}, include: {}, excludeIncompleteDatapoints: {}, rationale: {} } } };
    expect(fitCall(NUMBER_RECIPES.amplitude.search("budgets"), tools)).toMatchObject({ tool: "search_amp_entities", args: { queries: ["budgets"], entityTypes: ["CHART"] } });
    expect(fitCall(NUMBER_RECIPES.amplitude.search(""), tools).args).not.toHaveProperty("queries");
    expect(fitCall(NUMBER_RECIPES.amplitude.read("abc123"), tools)).toMatchObject({ tool: "get_amplitude_charts", args: { chartIds: ["abc123"], include: "data" } });
  });

  it("reads an event chart's total over its range first, then its latest point", () => {
    const answer = JSON.stringify({ success: true, results: [{ success: true, url: "https://app.amplitude.com/analytics/x/chart/new/e1?utm_source=mcp", definition: { params: { range: "Last 365 Days", events: [{ event_type: "Budget Created" }] } }, data: { isCsvResponse: false, jsonResponse: { timeSeries: [[{ setId: "a", value: 4 }, { setId: "a", value: 0 }]], overallSeries: [[{ setId: "b", value: 12 }]], seriesLabels: [0], seriesMetadata: [{ segmentIndex: 0, eventIndex: 0 }], xValuesForTimeSeries: ["2026-11-01T00:00:00", "2026-11-02T00:00:00"] }, seriesNames: ["All Users"] } }] });
    const read = amplitudeNumbers(answer);
    expect(read.url).toBe("https://app.amplitude.com/analytics/x/chart/new/e1");
    expect(read.series).toEqual([{ label: "Budget Created · Last 365 Days", value: 12 }, { label: "Budget Created · 2026-11-02", value: 0 }]);
  });

  it("reads a funnel's Total row, working out conversion from its steps' counts", () => {
    const answer = JSON.stringify({ title: "Untitled funnel", data: { isCsvResponse: true, csvResponse: { data: [["Untitled funnel"], [], [], ["Segment", "Date", "Conversion", "Viewed", "Average Time (s)", "Median Time (s)", "Bought", "Is complete"], ["All Users", "Total", 0.25, 200, 9, 8, 50], ["All Users", "Nov 03, 2025", 0, 0, 0, 0, 0, true]] } } });
    const read = amplitudeNumbers(answer);
    expect(read.series).toEqual([{ label: "Conversion %", value: 25 }, { label: "Viewed", value: 200 }, { label: "Bought", value: 50 }]);
    expect(read.steps).toEqual([{ label: "Viewed", count: 200 }, { label: "Bought", count: 50 }]);
  });

  it("reads retention's overall percent on the days people mean", () => {
    const head = ["Segment", "Start Date", "Users", ...Array.from({ length: 31 }, (_, i) => `Day ${i}`)];
    const percent = ["All Users", "Overall", "Retained %", ...Array.from({ length: 31 }, (_, i) => `${100 - i}.0%`)];
    const answer = JSON.stringify({ data: { isCsvResponse: true, csvResponse: { data: [["Untitled retention"], [], head, ["All Users", "Overall", "Retained", 9, 8], percent, ["All Users", "Nov 03, 2026", 0, 0]] } } });
    expect(amplitudeNumbers(answer).series).toEqual([{ label: "Retained % · Day 1", value: 99 }, { label: "Retained % · Day 7", value: 93 }, { label: "Retained % · Day 30", value: 70 }]);
  });

  it("finds nothing in an answer with no numbers", () => {
    expect(amplitudeNumbers(JSON.stringify({ results: [{ success: false, error: "Not found" }] })).series).toEqual([]);
  });
});

// The shapes their servers answered with (November 2026), shortened.
describe("counting an event, with no saved chart that fits", () => {
  const counted = { event: "Budget Created", project: "796963", days: 90 };

  it("keeps it as a ref that reads again, an event's colons and all", () => {
    expect(readEventRef(eventRef(counted))).toEqual(counted);
    expect(readEventRef(eventRef({ event: "a:b c", days: 30 }))).toEqual({ event: "a:b c", days: 30 });
    expect(readEventRef("event:1:7:Made up range")).toBeNull();
    expect(readEventRef("7mlKKF3J")).toBeNull();
  });

  it("is offered only where the answers were checked on a real account", () => {
    expect([countsEvents("amplitude"), countsEvents("posthog"), countsEvents("mixpanel")]).toEqual([true, true, false]);
  });

  it("lists Amplitude's events, naming the project only when there are several", () => {
    const answer = JSON.stringify({ results: [{ score: 0, entity: { id: "Budget Created", type: "EVENT", name: "Budget Created", description: "", entityRef: { orgId: 1, appId: 796963, value: "Budget Created" } } }, { score: 0, entity: { id: "c1", type: "CHART", name: "A chart" } }] });
    const places = amplitudePlaces(JSON.stringify({ projects: [{ appId: "460207", appName: "personal" }, { appId: "796963", appName: "amptest-dev" }] }));
    expect(amplitudeEvents(answer, { places })).toEqual([{ id: "796963:Budget Created", title: "Budget Created", site: "796963", snippet: "amptest-dev" }]);
    expect(amplitudeEvents(answer, { places: { "796963": "amptest-dev" } })[0]).not.toHaveProperty("snippet");
  });

  it("reads Amplitude's total, and no number when nobody did it", () => {
    const answer = JSON.stringify({ success: true, data: { isCsvResponse: false, jsonResponse: { timeSeries: [[{ value: 0 }]], overallSeries: [[{ setId: "x", value: 12 }]] }, seriesNames: ["All Users"] } });
    expect(amplitudeCount(answer, counted)).toEqual({ name: "Budget Created", series: [{ label: "Unique users, last 90 days", value: 12 }] });
    const nobody = JSON.stringify({ success: true, data: { jsonResponse: { timeSeries: [], overallSeries: [], seriesLabels: [] } } });
    expect(amplitudeCount(nobody, counted).series).toEqual([]);
  });

  it("asks Amplitude for the event in its project over the range", () => {
    expect(NUMBER_RECIPES.amplitude.events!.count(counted).args).toMatchObject({ projectId: "796963", chart: { kind: "segmentation", events: [{ event: "Budget Created" }], date_range: { relative: "Last 90 Days" } } });
  });

  // PostHog answers this as Markdown in a quoted string, even asked for JSON.
  const schema = '"events:\\n- \x60All events\x60 - All events. A wildcard.\\n- \x60$pageview\x60 - Pageview. When a user loads a page.\\n- \x60protected_case_study_unlocked\x60\\n\\n# More events available."';

  it("lists PostHog's events from its Markdown, near the words asked for, and not its wildcard", () => {
    expect(posthogEvents(schema, { query: "" }).map((h) => h.title)).toEqual(["$pageview", "protected_case_study_unlocked"]);
    expect(posthogEvents(schema, { query: "UNLOCKED" }).map((h) => h.title)).toEqual(["protected_case_study_unlocked"]);
  });

  it("reads PostHog's bold number as the unique users", () => {
    const answer = `${JSON.stringify({ _posthogUrl: "https://ph/i", query: { kind: "TrendsQuery" }, results: [{ data: [], days: [], count: 0, aggregated_value: 5, label: "protected_case_study_unlocked" }] })}\n{"conversation_id":"x"}`;
    expect(NUMBER_RECIPES.posthog.events!.numbers(answer, { event: "protected_case_study_unlocked", days: 90 })).toEqual({ name: "protected_case_study_unlocked", url: "https://ph/i", series: [{ label: "Unique users, last 90 days", value: 5 }] });
  });
});

describe("Qalam AI looking inside a tool", () => {
  const sent = [{ id: "p1", title: "Q3 research", snippet: "31 interviews" }, { id: "p2", title: "Roadmap" }];

  it("runs its searches once each, at most three, else what they wrote", () => {
    expect(sanitizeSearches({ searches: ["churn", "Churn", "exit survey", "win back", "cancel reasons"] }, "x")).toEqual(["churn", "exit survey", "win back"]);
    expect(sanitizeSearches({ searches: [] }, "why people cancel")).toEqual(["why people cancel"]);
  });

  it("keeps a pick only as a result it was sent, each once", () => {
    const kept = sanitizePicks({ picks: [{ id: "h2", why: "The plan" }, { id: "h2", why: "Again" }, { id: "h9", why: "Made up" }, { id: "p1", why: "An id it wasn't given" }] }, sent);
    expect(kept).toEqual([{ id: "p2", title: "Roadmap", why: "The plan" }]);
  });

  it("drops a reason whose numbers aren't in the result", () => {
    const [hit] = sanitizePicks({ picks: [{ id: "h1", why: "Has 31 interviews" }] }, sent);
    expect(hit.why).toBe("Has 31 interviews");
    expect(sanitizePicks({ picks: [{ id: "h1", why: "Has 500 interviews" }] }, sent)[0].why).toBeUndefined();
  });
});

describe("browsing Notion", () => {
  it("reads a list with no ids, taking each from its address, and a database isn't offered", () => {
    const answer = JSON.stringify({ results: [{ type: "page", url: "https://app.notion.com/p/3f41aa934b2b804baa9cd2cbd7d7d54d?pvs=204", title: "Plans" }, { type: "database", url: "https://app.notion.com/p/1391aa934b2b809c95c4c9c8d1d107c6?pvs=204", title: "Tasks" }] });
    expect(notionHits(answer)).toEqual([
      { id: "3f41aa934b2b804baa9cd2cbd7d7d54d", title: "Plans", url: "https://app.notion.com/p/3f41aa934b2b804baa9cd2cbd7d7d54d", opens: true },
      { id: "1391aa934b2b809c95c4c9c8d1d107c6", title: "Tasks", url: "https://app.notion.com/p/1391aa934b2b809c95c4c9c8d1d107c6", type: "other" },
    ]);
  });

  // As Notion's server answered (November 2026), the page itself around its content.
  const page = JSON.stringify({ metadata: { type: "page" }, title: "Work", url: "https://app.notion.com/p/3cb1aa934b2b802aa616c9293c4f87ca?pvs=204", text: 'Here is the result of "fetch" for the Page:\n<page url="https://app.notion.com/p/3cb1aa934b2b802aa616c9293c4f87ca">\n<ancestor-path></ancestor-path>\n<properties>\n{"title":"Work"}\n</properties>\n<content>\nIntro line.\n\n<page url="https://app.notion.com/p/3cb1aa934b2b80c583f0c19df20c1f56">\n\\[Team\\] - notes\n</page>\n\n<p />\n</content>\n</page>' });

  it("opens a page like a folder: the pages inside it, not itself", () => {
    expect(notionHits(page)).toEqual([{ id: "3cb1aa934b2b80c583f0c19df20c1f56", title: "[Team] - notes", url: "https://app.notion.com/p/3cb1aa934b2b80c583f0c19df20c1f56", opens: true }]);
  });

  it("reads a page as its own words, without the tool's wrapping", () => {
    expect(notionText(page)).toBe("Intro line.\n\n[Team] - notes");
    expect(notionText(JSON.stringify({ text: "Plain words." }))).toBe("Plain words.");
  });
});

describe("a connected tool searched on its own for a question", () => {
  const notion = tool({ id: "notion", label: "Notion", group: "docs", imports: true, via: "oauth", tone: "ok" });
  const none = { browse: async () => [], read: async () => [], charts: async () => [], numbers: async () => ({ series: [] }) };

  it("searches only a tool Qalam reaches itself, never one through Claude Code or one not connected", () => {
    expect(searchedAlone(notion)).toBe(true);
    expect(searchedAlone(tool({ via: "google", tone: "ok" }))).toBe(true);
    expect(searchedAlone(tool({ via: "claude-code", tone: "ok" }))).toBe(false);
    expect(searchedAlone(tool({ via: "oauth", tone: "off" }))).toBe(false);
  });

  it("reads the first pages its own search finds, and lists only the passages that bear on the question, as lines for the answer", async () => {
    const hits: Hit[] = [{ id: "p1", title: "Churn review" }, { id: "f", title: "Folder", folder: true }, { id: "p2", title: "Pricing notes" }, { id: "x", title: "Video", type: "other" }];
    const read = vi.fn(async (_id: string, hs: Hit[]) => hs.map((h) => ({ id: h.id, text: h.id === "p1" ? "Monthly churn was 4.1% in September, up from 3.2% in August.\n\nThe team offsite is in May, in the mountains this year." : "Prices went up in March for every plan we sell." })));
    const finds = await findIn(notion, { kind: "docs", lookFor: "monthly churn" }, "What's your monthly churn?", { ...none, browse: async () => hits, read });
    expect(read.mock.calls[0][1].map((h) => h.id)).toEqual(["p1", "p2"]);
    expect(finds).toEqual([{ key: "p1:0", text: "Monthly churn was 4.1% in September, up from 3.2% in August.", from: "Churn review", line: "“Monthly churn was 4.1% in September, up from 3.2% in August.” (Churn review, from Notion)" }]);
  });

  it("reads the first saved charts for their numbers, leaving out one that can't be read", async () => {
    const posthog = tool({ id: "posthog", label: "PostHog", group: "numbers", numbers: true, via: "oauth", tone: "ok" });
    const charts = async () => [{ id: "c1", title: "Activation" }, { id: "c2", title: "Broken" }];
    const numbers = async (_id: string, ref: string) => (ref === "c1" ? { name: "Activation rate", series: [{ label: "Value", value: 0.31 }] } : Promise.reject(new Error("No one number")));
    expect(await findIn(posthog, { kind: "numbers", lookFor: "activation" }, "Where does activation stand?", { ...none, charts, numbers })).toEqual([{ key: "c1:Value", text: "0.31", from: "Activation rate", line: "0.31 (Activation rate, from PostHog)" }]);
    expect(await findIn(posthog, { kind: "numbers" }, "Where does activation stand?", none)).toEqual([]);
  });
});
