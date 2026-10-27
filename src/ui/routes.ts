import { isProjectId, type ProjectType } from "@/projects/model";

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
  if (org && parts.length === 2 && parts[0] === "t" && /^[A-Za-z0-9_~-]{1,64}$/.test(parts[1])) return { kind: "topic", org, id: parts[1] };
  const type = parts.length === 2 ? TYPES[parts[0]] : undefined;
  if (type && isProjectId(parts[1])) return { kind: "project", org, type, id: parts[1] };
  return { kind: "missing" };
}
