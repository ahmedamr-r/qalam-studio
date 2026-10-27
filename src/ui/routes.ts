import { isProjectId, type ProjectType } from "@/projects/model";

/**
 * The app's pages, read from the address. Moving between them is a full page load (links and
 * `location.assign`), so there is no client router: each load reads its page once.
 */
export type Route = { kind: "home" } | { kind: "project"; type: ProjectType; id: string } | { kind: "missing" };

/** The path segment for each project type (the same letters `projectHref` writes). */
const TYPES: Record<string, ProjectType> = { p: "screens", d: "discovery", s: "system" };

export function routeOf(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (!parts.length) return { kind: "home" };
  const type = parts.length === 2 ? TYPES[parts[0]] : undefined;
  if (type && isProjectId(parts[1])) return { kind: "project", type, id: parts[1] };
  return { kind: "missing" };
}
