import type { OstWork } from "@/discovery/types";

/*
 * Work linked to a solution (pure): an issue, a pull request or a design, from its address, and its
 * status as the tool says it (Linear's issue state, GitHub's open, merged or closed). The card shows
 * the furthest one along; the stage stays the team's call, and a check says when they disagree.
 */

export type WorkState = "todo" | "doing" | "done" | "canceled" | "unknown";

export interface WorkStatus {
  state: WorkState;
  /** As the tool names it: "In Progress", "Merged". */
  label: string;
  title?: string;
  at: number;
}

export const workKey = (w: Pick<OstWork, "connector" | "ref">) => `${w.connector}:${w.ref}`;

export const WORK_LABEL: Record<string, string> = { linear: "Linear", github: "GitHub", jira: "Jira", figma: "Figma" };

/** An issue, a pull request or a design, from its address; null for anything else. */
export function parseWorkUrl(raw: string): OstWork | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const url = u.toString();
  const parts = u.pathname.split("/").filter(Boolean);
  const host = u.hostname.replace(/^www\./, "");
  if (host === "linear.app") {
    const i = parts.indexOf("issue");
    const id = i >= 0 ? parts[i + 1] : undefined;
    return id && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id) ? { connector: "linear", ref: id.toUpperCase(), url } : null;
  }
  if (host === "github.com" && parts.length >= 4 && (parts[2] === "issues" || parts[2] === "pull") && /^\d+$/.test(parts[3])) return { connector: "github", ref: `${parts[0]}/${parts[1]}#${parts[3]}`, url };
  if (/\.atlassian\.net$/.test(host) && parts[0] === "browse" && /^[A-Z][A-Z0-9]*-\d+$/i.test(parts[1] ?? "")) return { connector: "jira", ref: parts[1].toUpperCase(), url };
  if (host === "figma.com" && ["design", "file", "proto", "board"].includes(parts[0] ?? "") && parts[1]) {
    const node = u.searchParams.get("node-id");
    return { connector: "figma", ref: node ? `${parts[1]}:${node}` : parts[1], url };
  }
  return null;
}

/** Linear's state types as ours. */
export function linearState(type: string | undefined): WorkState {
  if (type === "completed") return "done";
  if (type === "canceled") return "canceled";
  if (type === "started") return "doing";
  if (type === "unstarted" || type === "backlog" || type === "triage") return "todo";
  return "unknown";
}

/** GitHub's issue (or pull request, from the issues API): open, merged, or closed without merging. */
export function githubStatus(j: { state?: string; title?: string; pull_request?: { merged_at?: string | null } | null; state_reason?: string | null }, at: number): WorkStatus {
  const pr = !!j.pull_request;
  const title = j.title;
  if (j.state === "open") return { state: pr ? "doing" : "todo", label: "Open", ...(title ? { title } : {}), at };
  if (pr) return j.pull_request?.merged_at ? { state: "done", label: "Merged", ...(title ? { title } : {}), at } : { state: "canceled", label: "Closed", ...(title ? { title } : {}), at };
  return j.state_reason === "not_planned" ? { state: "canceled", label: "Not planned", ...(title ? { title } : {}), at } : { state: "done", label: "Closed", ...(title ? { title } : {}), at };
}

const ORDER: Record<WorkState, number> = { done: 4, doing: 3, todo: 2, canceled: 1, unknown: 0 };

/** The card's chip: the furthest-along linked work it has a status for (none without one). */
export function cardWork(work: OstWork[] | undefined, statuses: Record<string, WorkStatus>): { label: string; tone: "ok" | "warn" | "off" } | null {
  let best: { w: OstWork; s: WorkStatus } | null = null;
  for (const w of work ?? []) {
    const s = statuses[workKey(w)];
    if (s && s.state !== "unknown" && (!best || ORDER[s.state] > ORDER[best.s.state])) best = { w, s };
  }
  if (!best) return null;
  return { label: best.s.label, tone: best.s.state === "done" ? "ok" : best.s.state === "canceled" ? "warn" : "off" };
}
