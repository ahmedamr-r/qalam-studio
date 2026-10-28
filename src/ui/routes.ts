import { isProjectId, type ProjectType } from "@/projects/model";
import { isPagePlace, type PagePlace } from "./frame/places";

/**
 * The app's pages, read from the address. Moving between them is a full page load (links and
 * `location.assign`), so there is no client router: each load reads its page once.
 *
 * Pages live under their organization: /o/<org> is its home, /o/<org>/d/<id> a board. Addresses
 * from before organizations (/d/<id>) and the bare / still work: the app finds the organization
 * and moves to the full address.
 */
export type Route =
  /** "/": the organization opened last. */
  | { kind: "root" }
  | { kind: "org"; org: string }
  /** `org` is null for an address from before organizations. */
  | { kind: "project"; org: string | null; type: ProjectType; id: string }
  /** A topic page (always under its organization). */
  | { kind: "topic"; org: string; id: string }
  /** Setting the organization up from a brain dump about it. */
  | { kind: "setup"; org: string }
  /** One of the organization's places (src/ui/frame/places.ts): its boards, topic pages, sources, decisions or connections. */
  | { kind: "place"; org: string; place: PagePlace }
  /** The welcome: the first run (no organization yet), a new organization, or checking the setup again. */
  | { kind: "welcome" }
  /** Quick capture, into the organization opened last (the menu bar's capture window). */
  | { kind: "capture" }
  | { kind: "missing" };

/** The path segment for each project type (the same letters `projectHref` writes). */
const TYPES: Record<string, ProjectType> = { p: "screens", d: "discovery", s: "system" };

export const isOrgId = (id: string) => /^[A-Za-z0-9_-]{4,64}$/.test(id);

export function routeOf(pathname: string): Route {
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return "\u0000";
      }
    });
  let org: string | null = null;
  if (parts[0] === "o") {
    if (!parts[1] || !isOrgId(parts[1])) return { kind: "missing" };
    org = parts[1];
    parts.splice(0, 2);
    if (!parts.length) return { kind: "org", org };
  }
  if (!parts.length) return { kind: "root" };
  if (!org && parts.length === 1 && parts[0] === "welcome") return { kind: "welcome" };
  if (!org && parts.length === 1 && parts[0] === "capture") return { kind: "capture" };
  if (org && parts.length === 1 && parts[0] === "setup") return { kind: "setup", org };
  if (org && parts.length === 1 && isPagePlace(parts[0])) return { kind: "place", org, place: parts[0] };
  if (org && parts.length === 2 && parts[0] === "t" && /^[A-Za-z0-9_~-]{1,64}$/.test(parts[1])) return { kind: "topic", org, id: parts[1] };
  const type = parts.length === 2 ? TYPES[parts[0]] : undefined;
  if (type && isProjectId(parts[1])) return { kind: "project", org, type, id: parts[1] };
  return { kind: "missing" };
}
