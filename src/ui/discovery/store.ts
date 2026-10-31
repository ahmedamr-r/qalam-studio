import { create } from "zustand";
import type { Notice } from "@/hub/checks";
import type { WorkStatus } from "@/connectors/work";

/**
 * The Discovery board's UI state (not the document): which card's title is being typed, what
 * the start sheet shows, which solution's "Design this" card is open, and the screens Screens
 * projects have made for each solution (read from their records).
 */

export type Sheet = "closed" | "start" | "interview" | "followups" | "drafting" | "import";

/** Words found in the organization that could back a card: where they live, and whose they are. */
export interface FoundQuote {
  sourceId: string;
  quoteId: string;
  text: string;
  speaker: string | null;
  /** The source's title. */
  from: string;
  whose: "customers" | "online" | "yours";
}

export interface DesignLink {
  projectId: string;
  projectName: string;
  frames: number;
  first?: string;
}

interface DiscoveryUI {
  /** A card's title being typed over: `fresh` = the card was just made (Esc takes it back). */
  editing: { id: string; fresh: boolean } | null;
  sheet: Sheet;
  /** The "Design this" card, for a solution. */
  designFor: string | null;
  /** Screens projects working on each solution, by card id. */
  designs: Record<string, DesignLink[]>;
  /** Cards are being dragged (the card bar steps aside). */
  dragging: boolean;
  /** Qalam AI is drafting the tree (its chat turn). */
  drafting: { chatId: string; turnId: string } | null;
  /** A quote dragged from the Sources tab is over this card (ringed; ok: it can take it). */
  quoteDrop: { target: string; ok: boolean } | null;
  /** What needs a look about this board's cards (the canvas marks them; the card panel says why). */
  notices: Notice[];
  /** Where the work linked to solutions stands, by connector:ref (src/ui/discovery/work.ts). */
  work: Record<string, WorkStatus>;
  /** The sources lane's item open in the reader (its key, src/discovery/lane.ts). */
  reading: string | null;
  /** A cord drawn from a lane source's port onto a card: its quotes picked in the right panel. */
  cordPick: { key: string; card: string } | null;
  /** What the organization has that could back a card (its next steps' "Find what backs it"): picked in the right panel. */
  quotePick: { card: string; quotes: FoundQuote[] } | null;
  /** How much of the canvas's right side a panel lies over (a narrow window's drawer): what's drawn beside a card keeps out of it. */
  inset: number;
}

export const useDiscovery = create<DiscoveryUI>(() => ({ editing: null, sheet: "closed", designFor: null, designs: {}, dragging: false, drafting: null, quoteDrop: null, notices: [], work: {}, reading: null, cordPick: null, quotePick: null, inset: 0 }));

export const discovery = () => useDiscovery.getState();
