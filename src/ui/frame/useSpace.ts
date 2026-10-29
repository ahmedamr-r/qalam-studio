import { useEffect } from "react";
import { useOrgContext } from "@/org/context";
import type { Product } from "@/org/context-md";
import { linkOrgNow, spaceHref } from "@/projects/model";
import type { Place } from "./places";
import { itemSpace, type Space } from "./spaces";
import { useCurrentOrg } from "./store";

/*
 * The space a page is in (./spaces.ts), and the one this tab was in last, kept for the tab per
 * organization: a goal's, problem's or board's page stays in it when the thing is in it, and a
 * page outside the spaces (Connections, a board) links back into it.
 */

const KEY = "qalam/space";

/** The space this tab was in last in this organization (undefined when it hasn't been in one). */
export function lastSpace(org: string | null = linkOrgNow()): Space | undefined {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as { org: string; space: Space } | null;
    return kept && kept.org === org ? kept.space : undefined;
  } catch {
    return undefined;
  }
}

export function keepSpace(space: Space, org: string | null = linkOrgNow()) {
  if (!org) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ org, space }));
  } catch {
    /* no storage: a page opened from here starts from what it shows */
  }
}

/** A place in the space this tab is in, narrowed to the thing open when it's elsewhere (a board's product). */
export const hereHref = (place: Place, products?: readonly string[]) => spaceHref(products ? itemSpace(products, lastSpace()) : (lastSpace() ?? null), place);

/** What a space is called: the product's name, or the organization's ("" until it's known). */
export function useSpaceName(space: Space): string {
  const products = useOrgContext((s) => s.products);
  const org = useCurrentOrg();
  return space ? (products.find((p) => p.id === space)?.name ?? "") : (org?.name ?? "");
}

/**
 * A space's own page (its home or a place): the product, once known. A product that's gone
 * (deleted, or a stale link) sends the page to the same place in the organization's space.
 */
export function useSpace(product: string | null, place: Place): { space: Space; product?: Product } {
  const { products, loaded } = useOrgContext();
  const p = product ? products.find((x) => x.id === product) : undefined;
  const gone = !!product && loaded && !p;
  useEffect(() => {
    if (gone) window.location.replace(spaceHref(null, place) + window.location.search);
  }, [gone, place]);
  return { space: gone ? null : product, product: p };
}

/** The space a goal's or problem's page shows in, from the products it's for (null while it loads, or when it's missing: the tab's last space). */
export function useItemSpace(products: readonly string[] | null | undefined): Space {
  const known = useOrgContext((s) => s.products);
  const last = lastSpace();
  if (!products) return last ?? null;
  const space = itemSpace(products, last);
  return space && !known.some((p) => p.id === space) ? null : space;
}
