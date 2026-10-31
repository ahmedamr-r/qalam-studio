import { lab } from "@/lab";

/*
 * The organization's places besides its canvases: what was decided, and how Qalam reaches its
 * engine and tools. Each is a page at /o/<org>/<place>; the canvas (home) is the space's own
 * address. Goals, problems and evidence had pages of their own once; they're worked on on the
 * canvas now, and their addresses land there. Kept free of React so routes and tests can read it.
 */

export type Place = "home" | "decisions" | "connections";

/** The places with a page of their own under /o/<org>/ (the canvas is /o/<org> itself). */
export type PagePlace = Exclude<Place, "home">;

export const PLACES: readonly { id: Place; label: string }[] = [
  { id: "home", label: "Canvas" },
  { id: "decisions", label: "Decisions" },
  { id: "connections", label: "Connections" },
];

/** Whether a place shows in the sidebar: Decisions is hidden in v0.1 (src/lab.ts), though its address still opens. */
export const placeShown = (p: Place) => p !== "decisions" || lab("decisions");

/** Above a board's panels only these: the space's canvas, and Connections. */
export const RAIL_PLACES: readonly Place[] = ["home", "connections"];

const PAGES = new Set<string>(PLACES.map((p) => p.id).filter((p) => p !== "home"));
export const isPagePlace = (s: string): s is PagePlace => PAGES.has(s);

/** Places that had a page of their own (and the ones from before those): an old link to one lands on the space's canvas. */
export const GONE_PLACES: ReadonlySet<string> = new Set(["goals", "problems", "evidence", "boards", "topics", "sources"]);

export const placeLabel = (p: Place) => PLACES.find((x) => x.id === p)?.label ?? p;

/** The home's old ?tab= (topics, sources, decisions, boards): Decisions, a page of its own, or the canvas; and the query without it. */
export function legacyTab(search: string): { place: Place; search: string } | null {
  const q = new URLSearchParams(search);
  const tab = q.get("tab");
  const place: Place | null = tab === "decisions" ? "decisions" : tab && GONE_PLACES.has(tab) ? "home" : null;
  if (!place) return null;
  q.delete("tab");
  const rest = q.toString();
  return { place, search: rest ? `?${rest}` : "" };
}
