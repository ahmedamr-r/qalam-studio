import { describe, expect, it } from "vitest";
import { firstJson, insightHits, insightNumbers, posthogRead, posthogSearch } from "./numbers";
import { cardWork, githubStatus, linearIssueStatus, linearState, parseWorkUrl, WORK_RECIPES, workKey, type WorkStatus } from "./work";

describe("work linked to a solution", () => {
  it("reads an issue, a pull request or a design from its address", () => {
    expect(parseWorkUrl("https://linear.app/basket/issue/ENG-123/fee-breakdown")).toEqual({ connector: "linear", ref: "ENG-123", url: "https://linear.app/basket/issue/ENG-123/fee-breakdown" });
    expect(parseWorkUrl("https://github.com/basket/app/pull/42")).toMatchObject({ connector: "github", ref: "basket/app#42" });
    expect(parseWorkUrl("https://github.com/basket/app/issues/7#issuecomment-1")).toMatchObject({ connector: "github", ref: "basket/app#7" });
    expect(parseWorkUrl("https://basket.atlassian.net/browse/APP-9")).toMatchObject({ connector: "jira", ref: "APP-9" });
    expect(parseWorkUrl("https://www.figma.com/design/AbC123/Checkout?node-id=12-34")).toMatchObject({ connector: "figma", ref: "AbC123:12-34" });
    expect(parseWorkUrl("https://github.com/basket/app")).toBeNull();
    expect(parseWorkUrl("not a link")).toBeNull();
    expect(parseWorkUrl("javascript:alert(1)")).toBeNull();
  });

  it("says where Linear and GitHub items stand", () => {
    expect(["triage", "backlog", "unstarted", "started", "completed", "canceled", "odd"].map(linearState)).toEqual(["todo", "todo", "todo", "doing", "done", "canceled", "unknown"]);
    expect(githubStatus({ state: "open", pull_request: {} }, 1)).toMatchObject({ state: "doing", label: "Open" });
    expect(githubStatus({ state: "closed", pull_request: { merged_at: "2026-10-01" } }, 1)).toMatchObject({ state: "done", label: "Merged" });
    expect(githubStatus({ state: "closed", pull_request: { merged_at: null } }, 1)).toMatchObject({ state: "canceled", label: "Closed" });
    expect(githubStatus({ state: "closed", state_reason: "not_planned" }, 1)).toMatchObject({ state: "canceled" });
    expect(githubStatus({ state: "open" }, 1)).toMatchObject({ state: "todo" });
  });

  it("reads where a Linear issue stands from its MCP server's answer, only when it's about the issue asked for", () => {
    expect(WORK_RECIPES.linear.status("ENG-12")).toEqual({ tool: "get_issue", args: { id: "ENG-12", fields: ["title", "status", "statusType"] } });
    const read = (answer: unknown, ref = "ENG-12") => linearIssueStatus(typeof answer === "string" ? answer : JSON.stringify(answer), ref, 1);
    // As get_issue answers for those fields: its id is the identifier.
    expect(read({ title: "Fee breakdown", status: "Shipped", statusType: "completed", id: "ENG-12" })).toEqual({ state: "done", label: "Shipped", title: "Fee breakdown", at: 1 });
    expect(read({ title: "Fee breakdown", status: "QA", statusType: "started", id: "eng-12" })).toMatchObject({ state: "doing", label: "QA" });
    // A status without its type: by the names Linear starts a team with; a team's own name shows as it is.
    expect(read({ id: "ENG-12", status: "In Review" })).toMatchObject({ state: "doing", label: "In Review" });
    expect(read({ id: "ENG-12", status: "Duplicate" })).toMatchObject({ state: "canceled" });
    expect(read({ id: "ENG-12", status: "Waiting on legal" })).toMatchObject({ state: "unknown", label: "Waiting on legal" });
    // Another issue's answer, one without the identifier or a status, Linear's error, or no JSON: no answer.
    expect(read({ id: "ENG-13", status: "Done", statusType: "completed" })).toBeNull();
    expect(read({ uuid: "f229557c", status: "Done", statusType: "completed" })).toBeNull();
    expect(read({ id: "ENG-12", title: "x" })).toBeNull();
    expect(read({ error: "invalid_request", message: "Could not find referenced Issue.", status: 400 })).toBeNull();
    expect(read("Entity not found: Issue")).toBeNull();
  });

  it("shows the furthest-along linked item on the card", () => {
    const s = (state: WorkStatus["state"], label: string): WorkStatus => ({ state, label, at: 1 });
    const work = [
      { connector: "linear", ref: "ENG-1", url: "u" },
      { connector: "github", ref: "o/r#2", url: "u" },
      { connector: "figma", ref: "F", url: "u" },
    ];
    expect(cardWork(work, { [workKey(work[0])]: s("doing", "In Progress"), [workKey(work[1])]: s("done", "Merged"), [workKey(work[2])]: s("unknown", "") })).toEqual({ label: "Merged", tone: "ok" });
    expect(cardWork(work, { [workKey(work[0])]: s("canceled", "Canceled") })).toEqual({ label: "Canceled", tone: "warn" });
    expect(cardWork(work, {})).toBeNull();
    expect(cardWork(undefined, {})).toBeNull();
  });
});

const LIST = `{"count":15,"results":[{"id":12981897,"short_id":"7mlKKF3J","name":"Protected case studies unlocked","derived_name":null,"description":"Readers who entered the password.","_posthogUrl":"https://us.posthog.com/project/1/insights/7mlKKF3J"},{"id":5,"short_id":"Bb","name":null,"derived_name":"Pageview count"}]}
{"conversation_id":"01a18145"}`;

describe("an outcome's number from PostHog", () => {
  it("asks PostHog's exec tool with its required fields", () => {
    expect(posthogSearch("orders").args).toMatchObject({ command: 'call --json insights-list {"search":"orders","limit":20,"saved":true}', llm_model: "unknown" });
    expect(posthogRead("7mlKKF3J").args.command).toBe('call --json insight-query {"insightId":"7mlKKF3J"}');
  });

  it("reads only the first JSON value of an answer, strings and brackets included", () => {
    expect(firstJson('noise {"a":"}{[","b":[1,2]} {"c":3}')).toEqual({ a: "}{[", b: [1, 2] });
    expect(firstJson("nothing")).toBeNull();
  });

  it("lists saved insights to pick from", () => {
    expect(insightHits(LIST)).toEqual([
      { id: "7mlKKF3J", title: "Protected case studies unlocked", url: "https://us.posthog.com/project/1/insights/7mlKKF3J", snippet: "Readers who entered the password." },
      { id: "Bb", title: "Pageview count" },
    ]);
  });

  it("reads a total per series, or a line's latest point", () => {
    const totals = JSON.stringify({
      query: { kind: "TrendsQuery" },
      insight: { name: "Unlocked", url: "https://ph/i/1" },
      results: [
        { data: [], aggregated_value: 3, label: "/a", action: { custom_name: "Readers" }, breakdown_value: ["/a"] },
        { data: [], aggregated_value: 2, label: "/b", action: { custom_name: "Readers" }, breakdown_value: ["/b"] },
      ],
      _posthogUrl: "https://ph/i/1",
    });
    expect(insightNumbers(`${totals}\n{"conversation_id":"x"}`)).toEqual({ name: "Unlocked", url: "https://ph/i/1", series: [ { label: "Readers · /a", value: 3 }, { label: "Readers · /b", value: 2 } ] });
    const line = JSON.stringify({ query: { kind: "TrendsQuery" }, results: [{ data: [3, 5, 8], label: "Weekly reorders", action: { name: "order_placed" } }] });
    expect(insightNumbers(line).series).toEqual([{ label: "order_placed", value: 8 }]);
  });

  it("reads a funnel's conversion and one SQL value, and nothing it can't read as one number", () => {
    const funnel = JSON.stringify({ query: { kind: "FunnelsQuery" }, results: [{ count: 200, name: "chat_submit" }, { count: 90, name: "fragment_generated", custom_name: "Got an app" }, { count: 50, name: "sandbox_created" }] });
    expect(insightNumbers(funnel).series).toEqual([{ label: "Conversion", value: 25 }]);
    // Each step, as PostHog counts it.
    expect(insightNumbers(funnel).steps).toEqual([
      { label: "chat_submit", count: 200 },
      { label: "Got an app", count: 90 },
      { label: "sandbox_created", count: 50 },
    ]);
    expect(insightNumbers(JSON.stringify({ query: { kind: "HogQLQuery" }, results: [[1234, "x"]] })).series).toEqual([{ label: "Value", value: 1234 }]);
    expect(insightNumbers(JSON.stringify({ query: { kind: "RetentionQuery" }, results: [{ values: [] }] })).series).toEqual([]);
    expect(insightNumbers("not json").series).toEqual([]);
  });
});
