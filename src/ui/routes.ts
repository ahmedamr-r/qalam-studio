import { isProjectId, type ProjectType } from "@/projects/model";
import { isPagePlace, MOVED_PLACES, type PagePlace } from "./frame/places";
import { isSpacePlace } from "./frame/spaces";

/**
 * The app's pages, read from the address. The frame's pages move in place (src/ui/nav.ts reads
 * the next address here); a board, setup and the welcome are a full page load each.
 *
 * Pages live under their organization: /o/<org> is its home, /o/<org>/d/<id> a board. A product's
 * space has its own home and places under /o/<org>/products/<id> (src/ui/frame/spaces.ts), and
 * /o/<org>/products is where you pick one. Addresses from before organizations (/d/<id>) and the
 * bare / still work: the app finds the organization and moves to the full address.
 */
export type Route =
  /** "/": the organization opened last. */
  | { kind: "root" }
  /** A space's home: the organization's, or with `product`, that product's. */
  | { kind: "org"; org: string; product?: string }
  /** Picking a space: the whole organization or one product. */
  | { kind: "spaces"; org: string }
  /** `org` is null for an address from before organizations. */
  | { kind: "project"; org: string | null; type: ProjectType; id: string }
  /** A topic page (always under its organization). */
  | { kind: "topic"; org: string; id: string }
  /** A goal's page: its number, the problems behind it (always under its organization). */
  | { kind: "goal"; org: string; id: string }
  /** Setting the organization up from a brain dump about it. */
  | { kind: "setup"; org: string }
  /** One of the organization's places (src/ui/frame/places.ts): its goals, problems, evidence, decisions or connections, in a product's space with `product`. `moved`: an old place's address, to redirect. */
  | { kind: "place"; org: string; place: PagePlace; product?: string; moved?: boolean }
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
  if (org && parts[0] === "products") return spaceRoute(org, parts.slice(1));
  if (org && parts.length === 1 && isPagePlace(parts[0])) return { kind: "place", org, place: parts[0] };
  if (org && parts.length === 1 && MOVED_PLACES[parts[0]]) return { kind: "place", org, place: MOVED_PLACES[parts[0]], moved: true };
  if (org && parts.length === 2 && parts[0] === "t" && /^[A-Za-z0-9_~-]{1,64}$/.test(parts[1])) return { kind: "topic", org, id: parts[1] };
  if (org && parts.length === 2 && parts[0] === "g" && /^[A-Za-z0-9_~-]{1,64}$/.test(parts[1])) return { kind: "goal", org, id: parts[1] };
  const type = parts.length === 2 ? TYPES[parts[0]] : undefined;
  if (type && isProjectId(parts[1])) return { kind: "project", org, type, id: parts[1] };
  return { kind: "missing" };
}

/** Under /o/<org>/products: the picker, a product's home, or one of its places (Connections is the organization's only). */
function spaceRoute(org: string, parts: string[]): Route {
  if (!parts.length) return { kind: "spaces", org };
  const product = parts[0];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(product)) return { kind: "missing" };
  if (parts.length === 1) return { kind: "org", org, product };
  if (parts.length > 2) return { kind: "missing" };
  if (isPagePlace(parts[1]) && isSpacePlace(parts[1])) return { kind: "place", org, place: parts[1], product };
  const moved = MOVED_PLACES[parts[1]];
  if (moved) return { kind: "place", org, place: moved, product, moved: true };
  return { kind: "missing" };
}
