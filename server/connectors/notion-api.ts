import { notionApiHits, notionBlocksText, type Hit } from "@/connectors/recipes";

/*
 * Notion's own API, with the internal integration secret Qalam keeps in the Keychain: a search, a
 * page's blocks as its words. No model and no Claude Code: what's read is exactly what Notion says.
 * The integration sees only the pages shared with it in Notion.
 */

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

async function call<T>(token: string, path: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<T> {
  const res = await f(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "notion-version": VERSION, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 401) throw new Error("Notion didn't accept this secret.");
  if (!res.ok) throw new Error(`Notion answered ${res.status}.`);
  return (await res.json()) as T;
}

/** Whose secret it is (and that it works). */
export async function notionWhoAmI(token: string, f?: typeof fetch): Promise<string> {
  const me = await call<{ name?: string; bot?: { workspace_name?: string } }>(token, "/users/me", {}, f);
  return me.bot?.workspace_name ?? me.name ?? "Notion";
}

export async function notionSearch(token: string, query: string, f?: typeof fetch): Promise<Hit[]> {
  return notionApiHits(await call(token, "/search", { method: "POST", body: JSON.stringify({ query, filter: { property: "object", value: "page" }, page_size: 20 }) }, f));
}

/** A page's words (its top-level blocks, up to a thousand). */
export async function notionPageText(token: string, id: string, f?: typeof fetch): Promise<string> {
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 10; n++) {
    const page = await call<{ results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string }>(token, `/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`, {}, f);
    blocks.push(...(page.results ?? []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return notionBlocksText(blocks);
}
