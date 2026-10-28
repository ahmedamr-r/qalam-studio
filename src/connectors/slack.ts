import { cleanText } from "@/discovery/ingest/text";
import type { Hit, Recipe } from "./recipes";

/*
 * Slack, through an app of the workspace's own (pure). Slack's MCP server lets no app register
 * itself and takes only apps made for a workspace or listed in its Marketplace, so the person
 * creates one from Qalam's manifest (the link fills it in) and Qalam keeps its ID and secret.
 * Search answers in Markdown written for a model; a message is found there by its link
 * (`/archives/<channel>/p<ts>`), which names what reading its thread takes.
 */

/** Where Slack sends the sign-in back: the one address the app lists, so its port never changes. */
export const SLACK_CALLBACK = "http://localhost:38712/callback";

/** What Qalam asks of Slack: searching what the person can see, reading those threads, and people's names. */
export const SLACK_SCOPES = ["search:read.public", "search:read.private", "search:read.mpim", "search:read.im", "channels:history", "groups:history", "mpim:history", "im:history", "users:read"];

export function slackManifest() {
  return {
    display_information: { name: "Qalam Studio", description: "Lets Qalam Studio on your Mac search Slack and bring conversations in." },
    // Slack's sign-in for people (v2_user) wants a bot user, though Qalam never uses it.
    features: { bot_user: { display_name: "Qalam Studio", always_online: false } },
    oauth_config: { redirect_urls: [SLACK_CALLBACK], scopes: { user: SLACK_SCOPES, bot: ["users:read"] } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false, is_mcp_enabled: true },
  };
}

/** Slack's "Create an app" page with Qalam's manifest filled in. */
export const slackAppLink = () => `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest()))}`;

const LINK = /https:\/\/[a-z0-9.-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}(?:\?[^\s)\]>"'`]*)?/g;

/** What reading a message's thread takes, from its link: the channel, and the thread's first message (a reply's link names it). */
export function slackMessage(link: string): { channel: string; ts: string } | null {
  const m = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(link);
  if (!m) return null;
  return { channel: m[1], ts: /[?&]thread_ts=(\d{10}\.\d{6})/.exec(link)?.[1] ?? `${m[2]}.${m[3]}` };
}

/** An answer's strings: Slack puts its Markdown inside JSON. The longest is the transcript; all of them hold the links. */
function strings(result: string): string[] {
  const t = result.trim();
  if (!/^[[{]/.test(t)) return [t];
  try {
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(t));
    return out;
  } catch {
    return [t];
  }
}

/** A result's lines without Markdown: marks, link targets, ids and its "Result 3 of 20" heading go. */
const lines = (md: string) =>
  md
    .replace(LINK, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}\s+|[-*>]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_`~]+/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(permalink|link|url|channel[ _]?id|(message|thread)?[ _]?ts|user[ _]?id|timestamp)\s*:/i.test(l) && !/^result\s+\d+\b/i.test(l));

/** Lines about a message rather than its words: where, who, when. */
const ABOUT = /^(channel|conversation|from|user|author|sender|time|date|when|posted|in)\s*:\s*/i;
/** The line that holds a message's words, when the result labels it. */
const SAID = /^(text|message|content|body)\s*:\s*/i;

/** The messages a search found, one per link: titled by the message's words, with where, who and when under it. A result is a block between blank lines or headings. */
export function slackHits(result: string): Hit[] {
  const out = new Map<string, Hit>();
  for (const text of strings(result))
    for (const block of text.split(/\n\s*\n|\n(?=#{1,6}\s|-{3,}\s*$)/m)) {
      const link = block.match(LINK)?.[0];
      const at = link ? slackMessage(link) : null;
      if (!link || !at || out.has(`${at.channel}/${at.ts}`)) continue;
      const ls = lines(block);
      const said = ls.find((l) => SAID.test(l))?.replace(SAID, "") ?? ls.find((l) => !ABOUT.test(l)) ?? ls[0] ?? "";
      const about = ls.filter((l) => ABOUT.test(l)).map((l) => l.replace(ABOUT, ""));
      const snippet = (about.length ? about.join(" · ") : ls.filter((l) => l !== said).join(" ")).slice(0, 200);
      out.set(`${at.channel}/${at.ts}`, { id: `${at.channel}/${at.ts}`, title: said.slice(0, 80) || "Slack message", url: link, ...(snippet ? { snippet } : {}) });
    }
  return [...out.values()];
}

/** A thread's words as Slack wrote them out (who said what, names filled in). */
export function slackText(result: string): string {
  return cleanText(strings(result).reduce((a, b) => (b.length > a.length ? b : a), ""));
}

export const SLACK_RECIPE: Recipe = {
  // The person's own search: Slack's modifiers (in:#channel, from:@name, after:2026-01-01) work in it.
  search: (query) => ({ tool: "slack_search_public_and_private", args: { query, limit: 20 } }),
  hits: slackHits,
  fetch: (hit) => {
    const [channel_id, message_ts] = hit.id.split("/");
    return { tool: "slack_read_thread", args: { channel_id, message_ts } };
  },
  text: slackText,
};
