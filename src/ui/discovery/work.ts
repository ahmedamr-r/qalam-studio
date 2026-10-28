import { workKey } from "@/connectors/work";
import { isOstCard } from "@/doc/board";
import { studio, useStudio } from "@/doc/store";
import type { OstCard, OstWork } from "@/discovery/types";
import { workDb } from "@/org/connectors";
import { useDiscovery } from "./store";

/*
 * Where the work linked to this board's solutions stands: asked when the board opens and whenever
 * a link appears (the server keeps answers ten minutes), for the cards' chips and the card panel.
 */

/** Every work link on the board's cards. */
export function boardWork(): OstWork[] {
  const doc = studio().doc;
  return Object.values(doc.nodes).flatMap((n) => (isOstCard(n) ? ((n.meta as { ost?: OstCard }).ost?.work ?? []) : []));
}

const asked = new Set<string>();

/** Ask for these links' status (`force`: ask the tools again now). */
export async function refreshWork(links: OstWork[], force = false) {
  if (!links.length) return;
  for (const l of links) asked.add(workKey(l));
  try {
    const { statuses } = await workDb.status(links, force);
    useDiscovery.setState((s) => ({ work: { ...s.work, ...statuses } }));
  } catch {
    // Offline or no organization: the cards show their links without a status.
  }
}

/** Keep the board's work statuses current as links are added. */
export function startWork() {
  void refreshWork(boardWork());
  useStudio.subscribe((s, prev) => {
    if (s.doc === prev.doc) return;
    const fresh = boardWork().filter((l) => !asked.has(workKey(l)));
    if (fresh.length) void refreshWork(fresh);
  });
}
