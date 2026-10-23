/**
 * What the designer asked to see happen on a screen that Generate didn't draw ("the dish's options
 * sheet open", "the basket bar after adding"): a screen is one place, and what happens on it without
 * leaving it is prototyped there, not drawn as more screens. Generate lists those interactions; they
 * wait on the screen's route until Qalam AI proposes how to build them and a build takes them.
 */
import { studio } from "@/doc/store";
import { emptyProto } from "@/doc/proto";
import type { Prototype, RouteProto } from "@/doc/schema";
import { emptyRoute, normalizeAsks } from "./routes";

/** The asks waiting on a screen. */
export const asksOf = (route: RouteProto | undefined): string[] => route?.asks ?? [];

/** The route without its asks (a build took them). */
export function withoutAsks(route: RouteProto): RouteProto {
  if (!route.asks) return route;
  const rest = { ...route };
  delete rest.asks;
  return rest;
}

/** The prototype with `asks` queued on each screen (after any already waiting there). */
export function queuedOn(p: Prototype, screens: string[], asks: string[]): Prototype {
  const routes = { ...p.routes };
  for (const s of screens) {
    const r = routes[s] ?? emptyRoute();
    routes[s] = { ...r, asks: normalizeAsks([...asksOf(r), ...asks]) };
  }
  return { ...p, routes };
}

/**
 * Queue what a Generate answer didn't draw on the screens it's about. Right after the screens were
 * placed it joins their undo step (undoing the screens takes their asks); `alone` makes it a step of
 * its own (asks for screens that were already there).
 */
export function queueAsks(screens: string[], asks: string[] | undefined, alone = false) {
  const list = normalizeAsks(asks);
  const doc = studio().doc;
  const on = screens.filter((id) => doc.nodes[id]?.type === "frame" && !doc.nodes[id].parentId);
  if (!list.length || !on.length) return;
  studio().mutate((d) => {
    d.proto = queuedOn(d.proto ?? emptyProto(), on, list);
  }, alone ? undefined : { history: false });
}

/** What Qalam AI is asked when proposing: the queued asks, then what the designer typed. */
export const askText = (route: RouteProto | undefined, typed = "") => [...asksOf(route), typed.trim()].filter(Boolean).join("\n");
