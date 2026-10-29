import { SLACK_CALLBACK, SLACK_SCOPES, slackAppLink } from "./slack";

/*
 * The tools an organization's material comes from, in the four groups Connections shows (browser-
 * safe). Each says what it brings (material to read, work to link, numbers for outcomes), how Claude
 * Code may already know it (its claude.ai connectors, plugins and servers), and whether Qalam can keep
 * a token for it itself or sign in to its MCP server. What works today: `imports` (bringing material
 * in), `status` (a linked item's status on solution cards) and `numbers` (an outcome's number); the
 * rest show where they stand and come next.
 */

export type ConnectorGroup = "docs" | "voice" | "build" | "numbers";

export const GROUPS: readonly { id: ConnectorGroup; label: string }[] = [
  { id: "docs", label: "Docs and notes" },
  { id: "voice", label: "Customer voice" },
  { id: "build", label: "Build and design" },
  { id: "numbers", label: "Product analytics" },
];

export interface ConnectorDef {
  id: string;
  label: string;
  group: ConnectorGroup;
  feeds: "material" | "work" | "numbers";
  /** How Claude Code names it (a claude.ai connector, a plugin, a server added by hand). */
  claudeCode: RegExp;
  /** A token Qalam can keep for it in the Keychain, and where one is made. */
  token?: { label: string; href: string; placeholder: string };
  /**
   * The service's own MCP server, which Qalam can sign in to itself in the browser
   * (server/connectors/oauth.ts): the scope Qalam asks for (else all the server lists), the
   * servers of the regions a workspace may live in (the first is `url`'s), and the account a sign-in
   * shares with other connectors (one Atlassian sign-in serves Jira and Confluence).
   */
  mcp?: { url: string; scope?: string; regions?: readonly { id: string; label: string; url: string }[]; ownApp?: OwnApp; account?: { id: string; label: string } };
  imports: boolean;
  /** Its items' status shows on solution cards linked to them: once connected (a token or Qalam's sign-in), or with nothing (public). */
  status?: "token" | "public";
  /** An outcome can read its number from it. */
  numbers?: boolean;
  /** A funnel step's picture can come from one of its frames (through Claude Code). */
  screens?: boolean;
}

/**
 * A service that lets no app register itself: the workspace makes an app of its own from Qalam's
 * manifest (`create` opens it filled in), and Qalam keeps its client ID and secret. The app lists
 * `callback`, so the sign-in always comes back to that address; `where` says where its
 * credentials are, `mcpSwitch` the setting that lets it use MCP.
 */
export interface OwnApp {
  callback: string;
  create: string;
  where: string;
  mcpSwitch: string;
}

/**
 * Atlassian's server signs in once for Jira and Confluence. Its v1 address: v2 would take read-only
 * scopes, but its sign-in turns apps that come back to this Mac away after consent ("Incorrect
 * request parameters", October 2026). v1 asks which apps instead, and Qalam calls only read tools.
 */
const ATLASSIAN = {
  url: "https://mcp.atlassian.com/v1/mcp",
  account: { id: "atlassian", label: "Atlassian" },
};

export const CATALOG: readonly ConnectorDef[] = [
  { id: "notion", label: "Notion", group: "docs", feeds: "material", claudeCode: /\bnotion\b/i, token: { label: "Internal integration secret", href: "https://www.notion.so/profile/integrations", placeholder: "ntn_…" }, mcp: { url: "https://mcp.notion.com/mcp" }, imports: true },
  { id: "drive", label: "Google Drive", group: "docs", feeds: "material", claudeCode: /google[ _]drive/i, imports: false },
  { id: "confluence", label: "Confluence", group: "docs", feeds: "material", claudeCode: /confluence|atlassian/i, mcp: ATLASSIAN, imports: true },
  {
    id: "slack",
    label: "Slack",
    group: "voice",
    feeds: "material",
    claudeCode: /\bslack\b/i,
    mcp: { url: "https://mcp.slack.com/mcp", scope: SLACK_SCOPES.join(" "), ownApp: { callback: SLACK_CALLBACK, create: slackAppLink(), where: "Basic Information → App Credentials", mcpSwitch: "Agents & AI Apps → Model Context Protocol" } },
    imports: true,
  },
  // Read access only: "operator" is Fin Operator's, which Qalam doesn't use.
  {
    id: "intercom",
    label: "Intercom",
    group: "voice",
    feeds: "material",
    claudeCode: /intercom/i,
    mcp: {
      url: "https://mcp.intercom.com/mcp",
      scope: "mcp",
      regions: [
        { id: "us", label: "US", url: "https://mcp.intercom.com/mcp" },
        { id: "eu", label: "EU", url: "https://mcp.eu.intercom.com/mcp" },
      ],
    },
    imports: true,
  },
  { id: "zendesk", label: "Zendesk", group: "voice", feeds: "material", claudeCode: /zendesk/i, imports: false },
  { id: "calls", label: "Call recordings", group: "voice", feeds: "material", claudeCode: /granola|gong|fireflies|fathom/i, imports: false },
  // Read access only: a token that asks for "read" can't reach Linear's write tools.
  { id: "linear", label: "Linear", group: "build", feeds: "work", claudeCode: /\blinear\b/i, token: { label: "Personal API key", href: "https://linear.app/settings/account/security", placeholder: "lin_api_…" }, mcp: { url: "https://mcp.linear.app/mcp", scope: "read" }, imports: false, status: "token" },
  { id: "jira", label: "Jira", group: "build", feeds: "work", claudeCode: /\bjira\b|atlassian/i, mcp: ATLASSIAN, imports: false, status: "token" },
  { id: "github", label: "GitHub", group: "build", feeds: "work", claudeCode: /github/i, imports: false, status: "public" },
  { id: "figma", label: "Figma", group: "build", feeds: "work", claudeCode: /\bfigma\b/i, imports: false, screens: true },
  { id: "posthog", label: "PostHog", group: "numbers", feeds: "numbers", claudeCode: /posthog/i, imports: false, numbers: true },
  { id: "amplitude", label: "Amplitude", group: "numbers", feeds: "numbers", claudeCode: /amplitude/i, imports: false },
  { id: "mixpanel", label: "Mixpanel", group: "numbers", feeds: "numbers", claudeCode: /mixpanel/i, imports: false },
];

export const connectorDef = (id: string) => CATALOG.find((c) => c.id === id);

/** The connectors one sign-in serves: those sharing its account (Jira and Confluence), else just this one. */
export function signInGroup(id: string): string[] {
  const account = connectorDef(id)?.mcp?.account?.id;
  return account ? CATALOG.filter((c) => c.mcp?.account?.id === account).map((c) => c.id) : [id];
}
