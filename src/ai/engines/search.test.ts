import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webVia } from "../abilities";
import { listConnectors } from "../connectors";
import { setEngineState } from "../engine";
import { research } from "../server";
import { onUsage } from "../usage";
import type { UsageEntry } from "../usage-shared";
import { setChatFetch } from "./compat";

type Sent = { url: string; body: Record<string, unknown> | null; headers: Headers };
let sent: Sent[];
let used: UsageEntry[];
let answer: (url: string, body: Record<string, unknown> | null) => Response;
const steps: string[] = [];
const ask = () => research({ purpose: "posts", task: "The problem: “Evening slots sell out”", connectors: ["web"] }, (s) => steps.push(s), new AbortController().signal);

beforeEach(() => {
  sent = [];
  used = [];
  steps.length = 0;
  onUsage((e) => used.push(e));
  setChatFetch(async (url, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    sent.push({ url: String(url), body, headers: new Headers(init?.headers) });
    return answer(String(url), body);
  });
});
afterEach(() => {
  setChatFetch(undefined);
  setEngineState({ kind: "api", models: undefined, keys: undefined, tavily: undefined });
});

describe("looking things up on an engine that isn't Claude", () => {
  it("asks OpenAI's Responses API with its web search, and keeps the notes and what they cite", async () => {
    setEngineState({ kind: "openai", keys: { openai: "sk-test-000000000000000000" }, models: { decide: "gpt-test" } });
    answer = () =>
      Response.json({
        model: "gpt-test",
        output: [
          { type: "web_search_call", status: "completed", action: { type: "search", query: "evening delivery slots sold out reddit", sources: [{ type: "url", url: "https://www.reddit.com/r/groceries/comments/abc" }] } },
          { type: "message", content: [{ type: "output_text", text: "- Slots go by noon: [a thread](https://www.reddit.com/r/groceries/comments/abc)", annotations: [{ type: "url_citation", url: "https://www.reddit.com/r/groceries/comments/abc", title: "a thread" }] }] },
        ],
        usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 100 } },
      });
    const info = await ask();
    expect(sent[0].url).toBe("https://api.openai.com/v1/responses");
    expect(sent[0].body).toMatchObject({ model: "gpt-test", tools: [{ type: "web_search" }], input: "The problem: “Evening slots sell out”" });
    expect(info).toMatchObject({ notes: expect.stringContaining("Slots go by noon"), sources: [{ url: "https://www.reddit.com/r/groceries/comments/abc" }] });
    expect(steps).toContain("Searching the web: “evening delivery slots sold out reddit”");
    expect(used).toMatchObject([{ engine: "openai", kind: "research", input: 900, cacheRead: 100, output: 40 }]);
  });

  it("grounds Gemini in Google Search and follows its redirect links to the pages they lead to", async () => {
    setEngineState({ kind: "gemini", keys: { gemini: "g-key-000000000000000000" }, models: { decide: "gemini-test" } });
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC";
    answer = (url) =>
      url === redirect
        ? new Response(null, { status: 302, headers: { location: "https://apps.apple.com/us/app/basket/id1" } })
        : Response.json({
            modelVersion: "gemini-test-001",
            candidates: [{ content: { parts: [{ text: "- Reviewers say evening slots are gone by Tuesday." }] }, groundingMetadata: { webSearchQueries: ["grocery app reviews evening slots"], groundingChunks: [{ web: { uri: redirect, title: "apps.apple.com" } }] } }],
            usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 30 },
          });
    const info = await ask();
    expect(sent[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(sent[0].headers.get("x-goog-api-key")).toBe("g-key-000000000000000000");
    expect(sent[0].body).toMatchObject({ tools: [{ google_search: {} }] });
    expect(info?.sources).toEqual([{ title: "apps.apple.com", url: "https://apps.apple.com/us/app/basket/id1" }]);
    expect(used).toMatchObject([{ engine: "gemini", model: "gemini-test-001", kind: "research" }]);
  });

  it("uses OpenRouter's web plugin and the links it cites", async () => {
    setEngineState({ kind: "openrouter", keys: { openrouter: "or-key-0000000000000000" }, models: { decide: "some/model" } });
    answer = () => Response.json({ model: "some/model", choices: [{ message: { content: "- Parents give up: [forum](https://forum.example.com/t/1)", annotations: [{ type: "url_citation", url_citation: { url: "https://forum.example.com/t/1", title: "forum" } }] }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 } });
    const info = await ask();
    expect(sent[0].body).toMatchObject({ plugins: [{ id: "web", max_results: 5 }] });
    expect(info?.sources).toEqual([{ title: "forum", url: "https://forum.example.com/t/1" }]);
    expect(used[0]).toMatchObject({ engine: "openrouter", cost: 0.002 });
  });

  it("has a model on this computer write the searches, Tavily run them, and the notes come only from what returned", async () => {
    setEngineState({ kind: "ollama", models: { decide: "qwen3" }, tavily: null });
    expect(webVia("ollama", false)).toBeNull();
    expect(listConnectors("ollama")).toEqual([]);
    expect(await ask()).toBeNull();

    setEngineState({ tavily: "tvly-test-0000000000000000" });
    expect(listConnectors("ollama")).toMatchObject([{ id: "web", hint: "Through Tavily" }]);
    let chats = 0;
    answer = (url) => {
      if (url === "https://api.tavily.com/search") return Response.json({ results: [{ title: "Slots gone", url: "https://www.reddit.com/r/x/comments/1", content: "Every evening slot is gone by 9am." }] });
      chats++;
      return Response.json({ model: "qwen3", choices: [{ message: { content: chats === 1 ? '{"queries":["evening slots gone reddit"]}' : "- Slots go by 9am: [Slots gone](https://www.reddit.com/r/x/comments/1)" } }] });
    };
    const info = await ask();
    const tavily = sent.find((s) => s.url === "https://api.tavily.com/search")!;
    expect(tavily.body).toMatchObject({ query: "evening slots gone reddit" });
    expect(tavily.headers.get("authorization")).toBe("Bearer tvly-test-0000000000000000");
    expect(JSON.stringify(sent.at(-1)!.body)).toContain("Use only these, each fact with its link");
    expect(info).toMatchObject({ notes: expect.stringContaining("Slots go by 9am"), sources: [{ url: "https://www.reddit.com/r/x/comments/1" }] });
    expect(used.every((u) => u.engine === "ollama" && u.cost === 0)).toBe(true);
  });
});
