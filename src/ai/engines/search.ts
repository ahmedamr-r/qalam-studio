import { keyOf, tavilyKey } from "../engine";
import type { EngineKind } from "../engine-kinds";
import { hostOf, stepLabel, type ResearchSource } from "../research-shared";
import { fromChatUsage, reportUsage } from "../usage";
import { checkAnswer } from "../validate";
import { baseFor, chat, failed, fetcher, headers } from "./compat";
import { codexSearch } from "./codex";
import { EngineError } from "./index";

/*
 * The research step on engines that aren't Claude: each looks things up on the web its own way and
 * writes the same notes, each fact linked to where it was found (src/ai/research.ts takes it from
 * there). Codex with its own live search; an OpenAI key through the Responses API's web_search;
 * OpenRouter with its web plugin; Gemini grounded in Google Search, whose redirect links are opened
 * to the page they lead to (so code can read and check that page); a model on this computer through
 * Tavily: it writes the searches, code runs them, and it writes notes from only what came back.
 * Server-only: keys are here.
 */

export interface Searched {
  text: string;
  /** Sources the reply cited. */
  cited: ResearchSource[];
  /** Every result seen, for when the reply cites nothing. */
  searched: ResearchSource[];
  /** Lookups that returned something (notes need at least one, else they'd be from memory). */
  found: number;
  model: string;
}

export interface SearchOpts {
  system: string;
  task: string;
  model: string;
  lookups: number;
  step: (s: string) => void;
  signal: AbortSignal;
}

const searching = (query: string) => stepLabel("web_search", { query }, (s) => s);
const source = (url: string, title?: string | null): ResearchSource => ({ title: title?.trim() || hostOf(url), url });

export function searchOn(kind: EngineKind, o: SearchOpts): Promise<Searched> {
  if (kind === "codex") return viaCodex(o);
  if (kind === "openai") return viaResponses(o);
  if (kind === "openrouter") return viaOpenRouter(o);
  if (kind === "gemini") return viaGemini(o);
  if (kind === "ollama" || kind === "lmstudio") return viaTavily(kind, o);
  return Promise.reject(new Error("Web search isn't on here."));
}

async function viaCodex(o: SearchOpts): Promise<Searched> {
  const out = await codexSearch({ system: o.system, task: o.task, model: o.model, signal: o.signal });
  for (const q of out.searches) o.step(searching(q));
  return { text: out.text ?? "", cited: [], searched: [], found: out.searches.length, model: out.model };
}

interface ResponsesAnswer {
  model?: string;
  output?: { type?: string; status?: string; action?: { query?: string; queries?: string[]; sources?: { url?: string; title?: string }[] }; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/** An OpenAI key: the Responses API with its web_search tool. */
async function viaResponses(o: SearchOpts): Promise<Searched> {
  const key = keyOf("openai");
  if (!key) throw new EngineError("auth", "There's no OpenAI key here. Paste one in Connections.");
  const res = await fetcher()(`${baseFor("openai")}/responses`, {
    method: "POST",
    headers: headers("openai", key),
    signal: o.signal,
    body: JSON.stringify({ model: o.model, instructions: o.system, input: o.task, tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"], max_tool_calls: o.lookups }),
  });
  if (!res.ok) throw await failed("openai", res);
  const j = (await res.json()) as ResponsesAnswer;
  let text = "";
  const cited: ResearchSource[] = [];
  const searched: ResearchSource[] = [];
  let found = 0;
  for (const item of j.output ?? []) {
    if (item.type === "web_search_call") {
      const q = item.action?.query ?? item.action?.queries?.[0];
      if (q) o.step(searching(q));
      if (item.status === "completed") found++;
      for (const s of item.action?.sources ?? []) if (s.url) searched.push(source(s.url, s.title));
    } else if (item.type === "message") {
      // The notes are the message after the last search.
      text = "";
      cited.length = 0;
      for (const c of item.content ?? []) {
        if (c.type !== "output_text") continue;
        text += c.text ?? "";
        for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) cited.push(source(a.url, a.title));
      }
    }
  }
  const u = j.usage;
  reportUsage(fromChatUsage(u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens } } : null, "openai", j.model ?? o.model, "research"));
  return { text, cited, searched, found, model: j.model ?? o.model };
}

/** OpenRouter: the chat API with its web plugin, which says what it cited. */
async function viaOpenRouter(o: SearchOpts): Promise<Searched> {
  o.step("Searching the web");
  const answer = await chat("openrouter", {
    model: o.model,
    messages: [
      { role: "system", content: o.system },
      { role: "user", content: o.task },
    ],
    schema: null,
    maxTokens: 8000,
    signal: o.signal,
    extra: { plugins: [{ id: "web", max_results: 5 }] },
  });
  reportUsage(fromChatUsage(answer.usage, "openrouter", answer.model ?? o.model, "research"));
  const cited = (answer.annotations ?? []).flatMap((a) => {
    const c = (a as { type?: string; url_citation?: { url?: string; title?: string } }).url_citation;
    return (a as { type?: string }).type === "url_citation" && c?.url ? [source(c.url, c.title)] : [];
  });
  return { text: answer.text, cited, searched: [], found: cited.length, model: answer.model ?? o.model };
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiAnswer {
  modelVersion?: string;
  candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
}

/** Where one of Gemini's grounding links leads (they go through Google's redirect host). */
async function unwrap(uri: string): Promise<string> {
  if (hostOf(uri) !== "vertexaisearch.cloud.google.com") return uri;
  try {
    const res = await fetcher()(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const to = res.headers.get("location");
    return to && /^https?:\/\//i.test(to) ? to : uri;
  } catch {
    return uri;
  }
}

/** Gemini: its own API, grounded in Google Search. */
async function viaGemini(o: SearchOpts): Promise<Searched> {
  const key = keyOf("gemini");
  if (!key) throw new EngineError("auth", "There's no Gemini key here. Paste one in Connections.");
  const res = await fetcher()(`${GEMINI}/models/${encodeURIComponent(o.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    signal: o.signal,
    body: JSON.stringify({ system_instruction: { parts: [{ text: o.system }] }, contents: [{ role: "user", parts: [{ text: o.task }] }], tools: [{ google_search: {} }] }),
  });
  if (!res.ok) throw await failed("gemini", res);
  const j = (await res.json()) as GeminiAnswer;
  const c = j.candidates?.[0];
  for (const q of c?.groundingMetadata?.webSearchQueries ?? []) o.step(searching(q));
  const chunks = (c?.groundingMetadata?.groundingChunks ?? []).flatMap((x) => (x.web?.uri ? [x.web] : []));
  const searched = await Promise.all(chunks.map(async (w) => source(await unwrap(w.uri!), w.title)));
  let text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  chunks.forEach((w, i) => (text = text.split(w.uri!).join(searched[i].url)));
  const u = j.usageMetadata;
  reportUsage(fromChatUsage(u ? { prompt_tokens: u.promptTokenCount, completion_tokens: u.candidatesTokenCount, prompt_tokens_details: { cached_tokens: u.cachedContentTokenCount } } : null, "gemini", j.modelVersion ?? o.model, "research"));
  return { text, cited: [], searched, found: chunks.length, model: j.modelVersion ?? o.model };
}

const QUERIES = { type: "object", additionalProperties: false, properties: { queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } }, required: ["queries"] };
const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** One Tavily search; a refusal is a step, not a failure of the whole lookup. */
async function tavily(key: string, query: string, signal: AbortSignal, step: (s: string) => void): Promise<{ title: string; url: string; content: string }[]> {
  const res = await fetcher()("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
  }).catch(() => null);
  if (!res?.ok) {
    step(`Tavily · search failed: ${!res ? "couldn't reach Tavily" : res.status === 401 || res.status === 403 ? "the key was rejected" : res.status === 432 ? "the plan's usage limit is reached" : `it answered ${res.status}`}`);
    return [];
  }
  const j = (await res.json().catch(() => ({}))) as { results?: { title?: string; url?: string; content?: string }[] };
  return (j.results ?? []).flatMap((r) => (r.url && /^https?:\/\//i.test(r.url) ? [{ title: r.title?.trim() || hostOf(r.url), url: r.url, content: r.content ?? "" }] : []));
}

/** A model on this computer: it writes the searches, Tavily runs them, and it writes notes from only what they returned. */
async function viaTavily(kind: "ollama" | "lmstudio", o: SearchOpts): Promise<Searched> {
  const key = tavilyKey();
  if (!key) throw new Error("Web search isn't on here: add a Tavily key in Connections.");
  const asked = await chat(kind, {
    model: o.model,
    messages: [
      { role: "system", content: `${o.system}\n\nFirst, write up to 3 web searches that would find this. Answer with only JSON: {"queries": ["…"]}` },
      { role: "user", content: o.task },
    ],
    schema: QUERIES,
    maxTokens: 1000,
    signal: o.signal,
  });
  reportUsage(fromChatUsage(asked.usage, kind, asked.model ?? o.model, "research"));
  const checked = checkAnswer(asked.text, QUERIES);
  const queries = (checked.ok ? (checked.data as { queries: string[] }).queries : [o.task.split("\n")[0]]).map((q) => one(q).slice(0, 300)).filter(Boolean).slice(0, Math.min(3, o.lookups));
  const results: { title: string; url: string; content: string }[] = [];
  let found = 0;
  for (const q of queries) {
    o.step(searching(q));
    const got = await tavily(key, q, o.signal, o.step);
    if (got.length) found++;
    for (const r of got) if (!results.some((x) => x.url === r.url)) results.push(r);
  }
  if (!results.length) return { text: "", cited: [], searched: [], found: 0, model: o.model };
  const material = results.map((r) => `- [${r.title}](${r.url}): ${one(r.content).slice(0, 600)}`).join("\n");
  const notes = await chat(kind, {
    model: o.model,
    messages: [
      { role: "system", content: o.system },
      { role: "user", content: `${o.task}\n\nWhat the web searches returned. Use only these, each fact with its link:\n${material}` },
    ],
    schema: null,
    maxTokens: 4000,
    signal: o.signal,
  });
  reportUsage(fromChatUsage(notes.usage, kind, notes.model ?? o.model, "research"));
  return { text: notes.text, cited: [], searched: results.map((r) => source(r.url, r.title)), found, model: notes.model ?? o.model };
}

/** Whether a Tavily key works (one small search). */
export async function testTavily(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetcher()("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ query: "customer interviews", max_results: 1 }),
  }).catch(() => null);
  if (!res) return { ok: false, message: "Couldn't reach Tavily from this computer." };
  if (res.status === 401 || res.status === 403) return { ok: false, message: "Tavily didn't accept this key." };
  if (res.status === 432) return { ok: false, message: "This Tavily key's plan has used its searches." };
  if (!res.ok) return { ok: false, message: `Tavily answered ${res.status}.` };
  return { ok: true };
}
