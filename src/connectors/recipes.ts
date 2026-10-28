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

export const RECIPES: Record<string, Recipe> = {
  notion: {
    search: (query) => ({ tool: "notion-search", args: { query } }),
    hits: notionHits,
    fetch: (hit) => ({ tool: "notion-fetch", args: { id: hit.id } }),
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
