import type { Goal } from "@/goals/types";
import type { Route } from "../routes";
import { legacyTab, type Place } from "./places";

/*
 * Where in the organization a page is: the organization's own space (null), whose places show all
 * of it, each thing marked with its product, or one product's, whose places show only that
 * product's. A product's space has addresses of its own (/o/<org>/products/<id>/goals); you pick
 * one at /o/<org>/products, which the organization opens on once it has products. Connections is
 * the organization's, in every space. Kept free of React so routes and tests can read it.
 */

/** The organization's space (null), or a product's id. */
export type Space = string | null;

/** The places a space has: all but Connections. */
const SPACED = new Set<string>(["home", "goals", "problems", "evidence", "decisions"]);
export const isSpacePlace = (s: string): s is Exclude<Place, "connections"> => SPACED.has(s);

/** Whether something for these products (one, none, or a page's several) shows in this space: everything shows in the organization's. */
export function inSpace(products: string | readonly string[] | null | undefined, space: Space): boolean {
  if (space === null) return true;
  return typeof products === "string" ? products === space : !!products?.includes(space);
}

/**
 * The space a goal's, problem's or board's page shows in: the one this tab was in when the thing
 * is in it (everything is in the organization's), else the thing's own product when it has one,
 * else the organization's. `last` is undefined when this tab hasn't been in a space yet.
 */
export function itemSpace(products: readonly string[], last: Space | undefined): Space {
  if (last !== undefined && inSpace(products, last)) return last;
  return products.length === 1 ? products[0] : null;
}

/**
 * Where an address from before spaces goes: the sidebar's ?product= becomes the product's space
 * ("org", the old whole-organization filter, the organization's), the home's ?tab= its place, an
 * old place's name its new one. The rest of the query stays. Null when it's where it should be.
 */
export function movedTo(route: Route, search: string): { place: Place; product: Space; search: string } | null {
  if (route.kind !== "org" && route.kind !== "place") return null;
  let place: Place = route.kind === "org" ? "home" : route.place;
  let product: Space = route.product ?? null;
  let moved = route.kind === "place" && !!route.moved;
  const tab = route.kind === "org" ? legacyTab(search) : null;
  if (tab) {
    place = tab.place;
    search = tab.search;
    moved = true;
  }
  const q = new URLSearchParams(search);
  const filter = q.get("product");
  if (filter !== null) {
    q.delete("product");
    moved = true;
    if (!product && filter && filter !== "org" && filter !== "all") product = filter;
  }
  if (!moved) return null;
  if (!isSpacePlace(place)) product = null;
  const rest = q.toString();
  return { place, product, search: rest ? `?${rest}` : "" };
}

/**
 * What a space holds, for the picker and the organization's home: how many goals, problems (need
 * pages; null while they load) and sources, and its top goal: the North Star in the organization's,
 * else the product's first active goal in the tree that doesn't feed another of its own.
 */
export function spaceSummary(
  space: Space,
  d: { goals: readonly Goal[]; north?: string | null; topics: readonly { kind: string; products: readonly string[] }[] | null; sources: readonly { product?: string | null }[] },
): { goals: number; problems: number | null; sources: number; top?: Goal } {
  const goals = d.goals.filter((g) => inSpace(g.product, space));
  const own = new Set(goals.map((g) => g.id));
  const tops = goals.filter((g) => !g.parent || !own.has(g.parent));
  const top = space === null ? d.goals.find((g) => g.id === d.north) : (tops.find((g) => g.status === "active") ?? tops[0]);
  return {
    goals: goals.length,
    problems: d.topics ? d.topics.filter((t) => t.kind === "need" && inSpace(t.products, space)).length : null,
    sources: d.sources.filter((s) => inSpace(s.product, space)).length,
    top,
  };
}
