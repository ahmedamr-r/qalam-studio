/*
 * The tools an organization's material comes from, in the four groups Connections shows (browser-
 * safe). Each says what it brings (material to read, work to link, numbers for outcomes), how Claude
 * Code may already know it (its claude.ai connectors, plugins and servers), and whether Qalam can keep
 * a token for it itself. `imports`: bringing its material in works today; the rest show where they
 * stand and come next.
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
  imports: boolean;
}

export const CATALOG: readonly ConnectorDef[] = [
  { id: "notion", label: "Notion", group: "docs", feeds: "material", claudeCode: /\bnotion\b/i, token: { label: "Internal integration secret", href: "https://www.notion.so/profile/integrations", placeholder: "ntn_…" }, imports: true },
  { id: "drive", label: "Google Drive", group: "docs", feeds: "material", claudeCode: /google[ _]drive/i, imports: false },
  { id: "confluence", label: "Confluence", group: "docs", feeds: "material", claudeCode: /confluence|atlassian/i, imports: false },
  { id: "slack", label: "Slack", group: "voice", feeds: "material", claudeCode: /\bslack\b/i, imports: false },
  { id: "intercom", label: "Intercom", group: "voice", feeds: "material", claudeCode: /intercom/i, imports: false },
  { id: "zendesk", label: "Zendesk", group: "voice", feeds: "material", claudeCode: /zendesk/i, imports: false },
  { id: "calls", label: "Call recordings", group: "voice", feeds: "material", claudeCode: /granola|gong|fireflies|fathom/i, imports: false },
  { id: "linear", label: "Linear", group: "build", feeds: "work", claudeCode: /\blinear\b/i, imports: false },
  { id: "jira", label: "Jira", group: "build", feeds: "work", claudeCode: /\bjira\b|atlassian/i, imports: false },
  { id: "github", label: "GitHub", group: "build", feeds: "work", claudeCode: /github/i, imports: false },
  { id: "figma", label: "Figma", group: "build", feeds: "work", claudeCode: /\bfigma\b/i, imports: false },
  { id: "posthog", label: "PostHog", group: "numbers", feeds: "numbers", claudeCode: /posthog/i, imports: false },
  { id: "amplitude", label: "Amplitude", group: "numbers", feeds: "numbers", claudeCode: /amplitude/i, imports: false },
  { id: "mixpanel", label: "Mixpanel", group: "numbers", feeds: "numbers", claudeCode: /mixpanel/i, imports: false },
];

export const connectorDef = (id: string) => CATALOG.find((c) => c.id === id);
