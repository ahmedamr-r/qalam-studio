/**
 * Which items a route's values can read where (pure): `it`, the item a layer belongs to when it's
 * inside a collection's items (a dish's +, a dish's count); `ctx`, the item a part was opened
 * about (the dish an options sheet is for). The compiler (codegen/data.ts) and the checks
 * (lint.ts) read them the same way.
 */
import { pathMatches } from "@/doc/proto";
import type { RouteProto, RouteRef } from "@/doc/schema";

/** The collection a ref's layers are items of: the innermost one its path is inside (a dish, not its section). */
export function collectionOf(route: RouteProto, r: RouteRef): string | undefined {
  if (!r.path) return undefined;
  const probe = r.path.replace(/\*/g, "0").split(".");
  let best: { id: string; depth: number } | undefined;
  for (const [id, col] of Object.entries(route.items ?? {})) {
    if ((col.of.part ?? undefined) !== (r.part ?? undefined) || !col.of.path) continue;
    const segs = col.of.path.split(".").length;
    if (segs <= probe.length && pathMatches(col.of.path, probe.slice(0, segs).join(".")) && (!best || segs > best.depth)) best = { id, depth: segs };
  }
  return best?.id;
}

/** Part id → the collection the item it's opened about comes from (the rule that opens it says which item). */
export function ctxCollections(route: RouteProto): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ru of route.rules) {
    for (const a of ru.then) {
      if (a.do !== "open" || a.item === undefined || out[a.part]) continue;
      const col = ru.each ?? ("ref" in ru.when ? collectionOf(route, ru.when.ref) : undefined);
      if (col) out[a.part] = col;
    }
  }
  return out;
}

/** The component a ref's layers are when it's where a collection lists its items (its rows, not the dividers or the button after them). */
export function componentAt(route: RouteProto, r: RouteRef): string | undefined {
  return Object.values(route.items ?? {}).find((c) => c.component && c.of.path === r.path && (c.of.part ?? undefined) === (r.part ?? undefined))?.component;
}
