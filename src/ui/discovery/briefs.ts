import type { BriefMeta } from "@/discovery/brief";
import { listBriefs } from "@/org/briefs";
import { create } from "zustand";
import { useDiscovery } from "./store";

/*
 * The briefs written for the canvas's cards (src/discovery/brief.ts): one a card, each drawn as a tile
 * under its card (src/discovery/lane.ts) that opens in the right panel (./BriefReader.tsx).
 */

export const useBriefs = create<{ list: BriefMeta[] }>(() => ({ list: [] }));

export const loadBriefs = () =>
  listBriefs()
    .then((list) => useBriefs.setState({ list }))
    .catch(() => {});

/** How the lane and the panel name a brief's tile. */
export const briefKey = (id: string) => `brief:${id}`;

export const openBrief = (id: string) => useDiscovery.setState({ reading: briefKey(id) });
