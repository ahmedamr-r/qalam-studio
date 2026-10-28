import { describe, expect, it } from "vitest";
import { CATALOG, connectorDef } from "./catalog";
import { matchClaudeCode, parseMcpList, toolPrefix } from "./claude-code";
import { intercomHits, intercomText, itemText, notionApiHits, notionBlocksText, notionHits, RECIPES } from "./recipes";
import { SLACK_CALLBACK, SLACK_RECIPE, SLACK_SCOPES, slackAppLink, slackHits, slackManifest, slackMessage, slackText } from "./slack";

const LIST = `Checking MCP server health…

claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Kiwi.com: https://mcp.kiwi.com - ! Needs authentication
plugin:posthog:posthog: https://mcp.posthog.com/mcp (HTTP) - ✔ Connected
tavily-mcp: npx -y tavily-mcp@0.1.3 - ✘ Failed to connect
figma: https://mcp.figma.com/mcp (HTTP) - ⏸ Pending
`;

describe("what Claude Code already has", () => {
  it("reads claude mcp list: names, where they are, how they are", () => {
    const l = parseMcpList(LIST);
    expect(l.map((s) => [s.name, s.status, s.claudeAi])).toEqual([
      ["claude.ai Notion", "connected", true],
      ["claude.ai Google Drive", "connected", true],
      ["claude.ai Kiwi.com", "needs-auth", true],
      ["plugin:posthog:posthog", "connected", false],
      ["tavily-mcp", "failed", false],
      ["figma", "pending", false],
    ]);
    expect(l[3].target).toBe("https://mcp.posthog.com/mcp");
    expect(parseMcpList("No MCP servers configured.")).toEqual([]);
  });

  it("names tools the way claude -p does, and finds the catalog's connectors among them", () => {
    expect(toolPrefix("claude.ai Notion")).toBe("mcp__claude_ai_Notion__");
    expect(toolPrefix("claude.ai Google Drive")).toBe("mcp__claude_ai_Google_Drive__");
    expect(toolPrefix("plugin:posthog:posthog")).toBe("mcp__plugin_posthog_posthog__");
    const l = parseMcpList(LIST);
    expect(matchClaudeCode(connectorDef("notion")!, l)?.name).toBe("claude.ai Notion");
    expect(matchClaudeCode(connectorDef("posthog")!, l)?.name).toBe("plugin:posthog:posthog");
    expect(matchClaudeCode(connectorDef("linear")!, l)).toBeNull();
  });

  it("has every connector once, in one of the four groups", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((c) => c.group))).toEqual(new Set(["docs", "voice", "build", "numbers"]));
  });
});

describe("reading Notion", () => {
  it("through Claude Code: search answers as hits, a page's words as they came", () => {
    const res = JSON.stringify({ results: [{ id: "p1", title: "Interview: Sara", url: "https://www.notion.so/p1", type: "page", highlight: "I rebuild my basket", timestamp: "2026-10-20T10:00:00Z" }, { title: "no id" }], type: "workspace_search" });
    expect(notionHits(res)).toEqual([{ id: "p1", title: "Interview: Sara", url: "https://www.notion.so/p1", snippet: "I rebuild my basket", at: "2026-10-20T10:00:00Z" }]);
    expect(RECIPES.notion.fetch({ id: "p1", title: "x" })).toEqual({ tool: "notion-fetch", args: { id: "p1" } });
    expect(itemText(JSON.stringify({ title: "t", text: "  Every Sunday I rebuild it.  " }))).toBe("Every Sunday I rebuild it.");
    expect(itemText("plain words")).toBe("plain words");
  });

  it("with Qalam's own token: pages from the API, and their blocks as lines", () => {
    const hits = notionApiHits({ results: [{ object: "page", id: "p1", url: "https://n/p1", properties: { Name: { type: "title", title: [{ plain_text: "Sara " }, { plain_text: "call" }] } } }, { object: "database", id: "d1" }] });
    expect(hits).toEqual([{ id: "p1", title: "Sara call", url: "https://n/p1" }]);
    const text = notionBlocksText([
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: "What she said" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Every Sunday I " }, { plain_text: "rebuild it." }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Fees surprise me" }] } },
      { type: "image", image: {} },
      { type: "paragraph", paragraph: { rich_text: [] } },
    ]);
    expect(text).toBe("## What she said\nEvery Sunday I rebuild it.\n- Fees surprise me");
  });
});

describe("reading Intercom", () => {
  it("searches conversations with the words kept inside quotes", () => {
    const call = RECIPES.intercom.search('export "to" sheets\\ every Friday');
    expect(call).toEqual({ tool: "search", args: { query: 'object_type:conversations q:"export to sheets every Friday" limit:20' } });
    expect(RECIPES.intercom.fetch({ id: "conversation_42", title: "x" })).toEqual({ tool: "fetch", args: { id: "conversation_42" } });
  });

  it("lists conversations from a search, with a title even when Intercom gives none", () => {
    const hits = intercomHits(
      JSON.stringify({
        total_in_page: 3,
        results: [
          { id: "conversation_42", title: "Exports", text: "<p>We export to sheets every Friday.</p>", url: "https://app.intercom.com/a/inbox/x/inbox/conversation/42" },
          { id: "conversation_43", title: "", text: "<p>The basket empties itself</p><p>when I switch stores</p>" },
          { id: "contact_7", title: "Dana" },
        ],
        pages: {},
      }),
    );
    expect(hits).toEqual([
      { id: "conversation_42", title: "Exports", url: "https://app.intercom.com/a/inbox/x/inbox/conversation/42", snippet: "We export to sheets every Friday." },
      { id: "conversation_43", title: "The basket empties itself", snippet: "The basket empties itself\n\nwhen I switch stores" },
    ]);
  });

  const conversation = {
    id: "42",
    source: { subject: "", body: "<p>We export to sheets every Friday &amp; it takes an hour.</p>", author: { type: "user", name: "Dana Lee" } },
    conversation_parts: {
      conversation_parts: [
        { part_type: "comment", body: "<p>Thanks Dana! Which sheet?</p>", author: { type: "admin", name: "Omar" } },
        { part_type: "assignment", body: null, author: { type: "bot" } },
        { part_type: "note", body: "<p>Same as Basket's request</p>", author: { type: "admin", name: "Omar" } },
        { part_type: "comment", body: "<p>The weekly one.<br>Every store.</p>", author: { type: "lead" } },
      ],
    },
  };

  it("reads a conversation as who said what, the customers' words as they wrote them", () => {
    const expected = ["Customer (Dana Lee): We export to sheets every Friday & it takes an hour.", "Team (Omar): Thanks Dana! Which sheet?", "Note, Team (Omar): Same as Basket's request", "Customer: The weekly one.\nEvery store."].join("\n\n");
    expect(intercomText(JSON.stringify(conversation))).toBe(expected);
    // fetch's own shape, the conversation inside its text.
    expect(intercomText(JSON.stringify({ id: "conversation_42", title: "Exports", text: JSON.stringify(conversation), url: "https://x" }))).toBe(expected);
  });

  it("reads another shape as its words: a text answer, or the fields of one it doesn't know", () => {
    expect(intercomText(JSON.stringify({ id: "conversation_1", text: "<p>Dana: it takes an hour</p>" }))).toBe("Dana: it takes an hour");
    expect(intercomText(JSON.stringify({ id: "conversation_1", text: "Dana: a < b, and it takes an hour" }))).toBe("Dana: a < b, and it takes an hour");
    expect(intercomText(JSON.stringify({ summary: { said: "It takes an hour" } }))).toBe("said: It takes an hour");
    expect(intercomText("plain words")).toBe("plain words");
  });
});

describe("reading Slack, through the workspace's own app", () => {
  it("makes the app from a manifest: Qalam's address, reading only, MCP on", () => {
    const m = slackManifest();
    expect(m.oauth_config.redirect_urls).toEqual([SLACK_CALLBACK]);
    expect(m.oauth_config.scopes.user.every((s) => /^(search:read|channels:history|groups:history|mpim:history|im:history|users:read)/.test(s))).toBe(true);
    expect(m.settings.is_mcp_enabled).toBe(true);
    expect(m.features.bot_user.display_name).toBe("Qalam Studio");
    const link = new URL(slackAppLink());
    expect(link.origin + link.pathname).toBe("https://api.slack.com/apps");
    expect(JSON.parse(link.searchParams.get("manifest_json")!)).toEqual(m);
    expect(connectorDef("slack")?.mcp).toMatchObject({ url: "https://mcp.slack.com/mcp", scope: SLACK_SCOPES.join(" "), ownApp: { callback: SLACK_CALLBACK } });
  });

  it("finds a message's thread from its link: a reply names its thread", () => {
    expect(slackMessage("https://acme.slack.com/archives/C0123ABCD/p1790771415332219")).toEqual({ channel: "C0123ABCD", ts: "1790771415.332219" });
    expect(slackMessage("https://acme.slack.com/archives/C0123ABCD/p1790771500000100?thread_ts=1790771415.332219&cid=C0123ABCD")).toEqual({ channel: "C0123ABCD", ts: "1790771415.332219" });
    expect(slackMessage("https://example.com/p1")).toBeNull();
  });

  it("lists the messages a search found, titled by their words, with where, who and when", () => {
    const md = [
      "# Search results for “export”",
      "## Result 1 of 3",
      "Channel: #customer-feedback (C0123ABCD)",
      "From: Dana Lee",
      "Time: 2026-10-27 14:03",
      "Permalink: https://acme.slack.com/archives/C0123ABCD/p1790771415332219",
      "Text: We **export** to sheets every Friday.",
      "## Result 2 of 3",
      "Channel: #customer-feedback (C0123ABCD)",
      "From: Omar",
      "Permalink: https://acme.slack.com/archives/C0123ABCD/p1790771500000100?thread_ts=1790771415.332219&cid=C0123ABCD",
      "Text: Same thread, so the same hit",
      "## Result 3 of 3",
      "- [Every store, every week](https://acme.slack.com/archives/G0999/p1790000000000001) in #wholesale",
    ].join("\n");
    expect(slackHits(JSON.stringify({ results: md, next_cursor: "abc" }))).toEqual([
      { id: "C0123ABCD/1790771415.332219", title: "We export to sheets every Friday.", url: "https://acme.slack.com/archives/C0123ABCD/p1790771415332219", snippet: "#customer-feedback (C0123ABCD) · Dana Lee · 2026-10-27 14:03" },
      { id: "G0999/1790000000.000001", title: "Every store, every week in #wholesale", url: "https://acme.slack.com/archives/G0999/p1790000000000001" },
    ]);
    expect(SLACK_RECIPE.fetch({ id: "C0123ABCD/1790771415.332219", title: "x" })).toEqual({ tool: "slack_read_thread", args: { channel_id: "C0123ABCD", message_ts: "1790771415.332219" } });
    expect(SLACK_RECIPE.search("in:#feedback export")).toEqual({ tool: "slack_search_public_and_private", args: { query: "in:#feedback export", limit: 20 } });
  });

  it("reads a thread as Slack wrote it out, without the answer's other fields", () => {
    const thread = "Dana Lee (2026-10-27 14:03): We export to sheets every Friday.\nOmar (14:05): Which sheet?";
    expect(slackText(JSON.stringify({ messages: thread, next_cursor: "abc", has_more: false }))).toBe(thread);
    expect(slackText(thread)).toBe(thread);
  });
});
