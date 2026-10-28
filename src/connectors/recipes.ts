import { captureText, cleanText, htmlText } from "@/discovery/ingest/text";

/*
 * How Qalam reads a connector (pure): the tool and the arguments for a search and for one item,
 * the items in a search's answer, and an item's words. Code picks the calls; the words that come
 * back are the tool's own, kept as they are, so Qalam AI's quotes from them are checked like any
 * other source's.
 */

export interface ToolCall {
  /** The tool's name on its server (without Claude Code's prefix). */
  tool: string;
  args: Record<string, unknown>;
  /** The arguments that must be as planned for its answer to be kept (default: all of them). A tool whose description asks the model to fill in its own metadata (its model's name, a reason) names the rest. */
  match?: string[];
}

export interface Hit {
  id: string;
  title: string;
  url?: string;
  /** A line of what matched, as the tool gave it. */
  snippet?: string;
  at?: string;
}

export interface Recipe {
  search: (query: string) => ToolCall;
  hits: (result: string) => Hit[];
  fetch: (hit: Hit) => ToolCall;
  /** A fetched item's words (default `itemText`). */
  text?: (result: string) => string;
}

const json = (text: string): unknown => {
  try {
    return JSON.parse(text.slice(text.indexOf("{")));
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Notion's hosted server: notion-search answers {results:[{id,title,url,type,highlight,timestamp}]}. */
export function notionHits(result: string): Hit[] {
  const j = json(result) as { results?: Record<string, unknown>[] } | null;
  return (j?.results ?? []).flatMap((r) => {
    const id = str(r.id);
    if (!id) return [];
    return [{ id, title: str(r.title) ?? "Untitled", ...(str(r.url) ? { url: str(r.url) } : {}), ...(str(r.highlight) ? { snippet: str(r.highlight)!.slice(0, 200) } : {}), ...(str(r.timestamp) ? { at: str(r.timestamp) } : {}) }];
  });
}

/*
 * Intercom's hosted server: `search` takes a query in its own language (`object_type:conversations`
 * first, `q:` for words) and answers {results:[{id,title,text,url}]}, ids prefixed `conversation_`;
 * `fetch` takes such an id and answers the conversation with its parts.
 */
export function intercomHits(result: string): Hit[] {
  const j = json(result) as { results?: Record<string, unknown>[] } | null;
  return (j?.results ?? []).flatMap((r) => {
    const id = str(r.id);
    if (!id?.startsWith("conversation_")) return [];
    const said = str(r.text) ? htmlText(str(r.text)!).text : "";
    const title = str(r.title) ?? (said.split("\n")[0].slice(0, 80).trim() || `Conversation ${id.slice("conversation_".length)}`);
    return [{ id, title, ...(str(r.url) ? { url: str(r.url) } : {}), ...(said ? { snippet: said.slice(0, 200) } : {}) }];
  });
}

/** Who wrote a part of a conversation, by its author's type. */
const WHO: Record<string, string> = { user: "Customer", lead: "Customer", contact: "Customer", admin: "Team", team: "Team", bot: "Bot" };

/** One message: who wrote it, then its words without the markup ("Note" when only the team sees it). */
function message(author: unknown, body: unknown, note: boolean): string | null {
  if (typeof body !== "string" || !body.trim()) return null;
  const words = htmlText(body).text;
  if (!words) return null;
  const a = (author ?? {}) as { type?: unknown; name?: unknown };
  const who = (typeof a.type === "string" && WHO[a.type]) || "Someone";
  return `${note ? "Note, " : ""}${who}${typeof a.name === "string" && a.name.trim() ? ` (${a.name.trim()})` : ""}: ${words}`;
}

/** A conversation as Intercom's API shapes it (its first message in `source`, the rest in `conversation_parts`), as messages. */
function conversationText(c: Record<string, unknown> | null): string | null {
  if (!c) return null;
  const source = c.source as { subject?: unknown; body?: unknown; author?: unknown } | undefined;
  const list = c.conversation_parts as unknown;
  const parts = (Array.isArray(list) ? list : Array.isArray((list as { conversation_parts?: unknown } | undefined)?.conversation_parts) ? (list as { conversation_parts: unknown[] }).conversation_parts : []) as Record<string, unknown>[];
  if (!source && !parts.length) return null;
  const subject = typeof source?.subject === "string" ? htmlText(source.subject).text : "";
  const lines = [subject ? `Subject: ${subject}` : null, message(source?.author, source?.body, false), ...parts.map((p) => message(p.author, p.body, p.part_type === "note"))].filter((l): l is string => !!l);
  return lines.length ? lines.join("\n\n") : null;
}

/** A fetched Intercom conversation as who said what, the customers' words as they wrote them. Another shape reads as its fields. */
export function intercomText(result: string): string {
  const j = json(result) as Record<string, unknown> | null;
  if (!j) return cleanText(result);
  // `fetch` may answer {id, title, text, url, metadata} with the conversation inside `text`.
  const inner = typeof j.text === "string" ? (json(j.text) as Record<string, unknown> | null) : null;
  for (const c of [inner, j, (j.conversation as Record<string, unknown> | undefined) ?? null]) {
    const t = conversationText(c);
    if (t) return t;
  }
  if (typeof j.text === "string" && j.text.trim()) return /<\/?[a-z][^>]*>/i.test(j.text) ? htmlText(j.text).text : cleanText(j.text);
  return captureText(result);
}

/** Intercom's search words: inside quotes, so they can't add to the query. */
const intercomQuery = (words: string) => `object_type:conversations q:"${words.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}" limit:20`;

export const RECIPES: Record<string, Recipe> = {
  notion: {
    search: (query) => ({ tool: "notion-search", args: { query } }),
    hits: notionHits,
    fetch: (hit) => ({ tool: "notion-fetch", args: { id: hit.id } }),
  },
  intercom: {
    search: (query) => ({ tool: "search", args: { query: intercomQuery(query) } }),
    hits: intercomHits,
    fetch: (hit) => ({ tool: "fetch", args: { id: hit.id } }),
    text: intercomText,
  },
};

/** The words of a fetched item: a {text} answer's text, else the answer as it came. */
export function itemText(result: string): string {
  const j = json(result) as { text?: unknown } | null;
  return (str(j?.text) ?? result).trim();
}

// ---------------------------------------------------------------------------
// Notion's own API, with a token Qalam keeps (no model, no Claude Code)

interface RichText {
  plain_text?: string;
}
type Block = { type?: string; has_children?: boolean; id?: string } & Record<string, unknown>;

/** A page's title from its properties (the one property of type "title"). */
export function notionTitle(page: { properties?: Record<string, { type?: string; title?: RichText[] }> }): string {
  const prop = Object.values(page.properties ?? {}).find((p) => p?.type === "title");
  return (prop?.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || "Untitled";
}

/** /v1/search's pages as hits. */
export function notionApiHits(res: { results?: { object?: string; id?: string; url?: string; last_edited_time?: string; properties?: Record<string, { type?: string; title?: RichText[] }> }[] }): Hit[] {
  return (res.results ?? []).filter((r) => r.object === "page" && r.id).map((r) => ({ id: r.id!, title: notionTitle(r), ...(r.url ? { url: r.url } : {}), ...(r.last_edited_time ? { at: r.last_edited_time } : {}) }));
}

const TEXT_BLOCKS = new Set(["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout", "code"]);
const PREFIX: Record<string, string> = { heading_1: "# ", heading_2: "## ", heading_3: "### ", bulleted_list_item: "- ", numbered_list_item: "1. ", to_do: "- [ ] ", quote: "> " };

/** Blocks as the page's words, one line each (headings and lists keep a Markdown mark). */
export function notionBlocksText(blocks: Block[]): string {
  return blocks
    .flatMap((b) => {
      if (!b.type || !TEXT_BLOCKS.has(b.type)) return [];
      const body = (b[b.type] as { rich_text?: RichText[] } | undefined)?.rich_text ?? [];
      const line = body.map((t) => t.plain_text ?? "").join("");
      return line.trim() ? [`${PREFIX[b.type] ?? ""}${line}`] : [];
    })
    .join("\n");
}
