import { captureText, cleanText, htmlText } from "@/discovery/ingest/text";
import { firstJson } from "./numbers";
import type { Hit, Recipe } from "./recipes";

/*
 * Confluence, through Atlassian's MCP server and Qalam's sign-in (pure). Every call names its site
 * (`cloudId`): a search first asks which sites the person can reach and takes the first with
 * Confluence, and each hit carries it to the page's fetch. A search is CQL over the site's pages;
 * a page comes back as Markdown. Written from Atlassian's docs (October 2026), not yet checked
 * against a real site.
 */

const field = (o: unknown, k: string): unknown => (o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>)[k] : undefined);
const word = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The sites `getAccessibleAtlassianResources` lists ([{id, url, name, scopes}]): the first with Confluence, else the first. */
export function atlassianSite(result: string): string | null {
  const j = firstJson(result);
  const list = Array.isArray(j) ? j : field(j, "resources");
  const sites = (Array.isArray(list) ? list : []).filter((s) => word(field(s, "id")));
  const site = sites.find((s) => /confluence/i.test(JSON.stringify(field(s, "scopes") ?? ""))) ?? sites[0];
  return site ? word(field(site, "id"))! : null;
}

/** The person's words as a CQL search of pages' text, inside quotes so they can't add to the query. */
export const confluenceCql = (words: string) => `type = page AND text ~ "${words.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}" ORDER BY lastmodified DESC`;

/** Confluence marks what matched with @@@hl@@@…@@@endhl@@@. */
const unmark = (s: string) => cleanText(s.replace(/@@@(?:end)?hl@@@/g, ""));

/** A CQL search's pages (Confluence's own shape: results[].content, links under _links.base), each with the site it's on. */
export function confluenceHits(result: string, site?: string): Hit[] {
  const j = firstJson(result);
  const base = word(field(field(j, "_links"), "base"));
  const results = field(j, "results");
  return (Array.isArray(results) ? results : []).flatMap((r): Hit[] => {
    const content = field(r, "content") ?? r;
    const id = word(field(content, "id"));
    if (!id || (word(field(content, "type")) ?? "page") !== "page") return [];
    const title = unmark(word(field(content, "title")) ?? word(field(r, "title")) ?? "") || "Untitled page";
    const path = word(field(r, "url")) ?? word(field(field(content, "_links"), "webui"));
    const url = path && (/^https:\/\//.test(path) ? path : base ? `${base}${path}` : undefined);
    const excerpt = word(field(r, "excerpt"));
    return [{ id, title, ...(url ? { url } : {}), ...(excerpt ? { snippet: unmark(excerpt).slice(0, 200) } : {}), ...(site ? { site } : {}) }];
  });
}

/** A page's words: its body as Markdown, or its HTML without the markup; a shape not known reads as its fields. */
export function confluenceText(result: string): string {
  const j = firstJson(result);
  const page = field(j, "data") ?? j;
  const body = field(page, "body");
  const md = word(body) ?? word(field(body, "markdown")) ?? word(field(field(body, "markdown"), "value"));
  if (md) return cleanText(md);
  const html = word(field(field(body, "storage"), "value")) ?? word(field(field(body, "view"), "value"));
  if (html) return htmlText(html).text;
  return captureText(result);
}

export const CONFLUENCE_RECIPE: Recipe = {
  site: { call: { tool: "getAccessibleAtlassianResources", args: {} }, read: atlassianSite },
  search: (query, site) => ({ tool: "searchConfluenceUsingCql", args: { cloudId: site ?? "", cql: confluenceCql(query), limit: 20 } }),
  hits: confluenceHits,
  fetch: (hit) => ({ tool: "getConfluencePage", args: { cloudId: hit.site ?? "", pageId: hit.id, contentFormat: "markdown" } }),
  text: confluenceText,
};
