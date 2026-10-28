import type { ShownOn } from "@/hub/checks";
import { rankNeeds, type PieceFacts, type RankedNeed } from "@/hub/needs";
import type { Topic } from "@/hub/topics";
import { indexFor } from "../index/registry";
import { cardTitles, showsUp } from "../index/search";
import type { OrgStore } from "./store";

/**
 * What the organization's topic pages rest on, from the search index: the pieces their lines cite
 * (a piece not there is gone), and the cards on boards resting on each page's pieces. The checks
 * (notices.ts) and what to work on next both read it. Without the index here (Node without
 * full-text search) there's nothing to read, and `indexed` says so.
 */
export interface KnowledgeInputs {
  topics: Topic[];
  pieces: Map<string, PieceFacts>;
  shows: Map<string, ShownOn[]>;
  indexed: boolean;
}

export async function knowledgeInputs(store: OrgStore, topics?: Topic[]): Promise<KnowledgeInputs> {
  const pages = topics ?? (await store.listTopics());
  const out: KnowledgeInputs = { topics: pages, pieces: new Map(), shows: new Map(), indexed: false };
  try {
    const ix = indexFor(store);
    // Caught up with the folder first: a page's pieces not indexed yet would look gone.
    await ix.settled();
    const cited = [...new Set(pages.flatMap((t) => t.lines.flatMap((l) => [...l.cites, ...(l.disputes ?? []).flatMap((d) => d.cites)])))];
    for (const [ref, row] of ix.piecesByRef(cited)) out.pieces.set(ref, { type: row.type, sub: row.sub, source: row.source, stage: row.stage, at: row.at });
    const titles = cardTitles(ix);
    for (const t of pages) {
      const refs = [...new Set(t.lines.flatMap((l) => l.cites))];
      out.shows.set(
        t.id,
        showsUp(ix, t.title, refs, titles).map((s): ShownOn => ({ ref: s.ref, board: s.board, card: s.card, kind: s.kind, shared: s.shared })),
      );
    }
    out.indexed = true;
  } catch {
    // No index here: what needs it waits.
  }
  return out;
}

export interface NeedsNow {
  /** False without the search index here: nothing can be ranked. */
  indexed: boolean;
  needs: RankedNeed[];
}

/** Every need page, the best-backed first (src/hub/needs.ts). The window filters by product. */
export async function needsNow(store: OrgStore, now = Date.now()): Promise<NeedsNow> {
  const k = await knowledgeInputs(store);
  return { indexed: k.indexed, needs: k.indexed ? rankNeeds({ now, topics: k.topics, pieces: k.pieces, shows: k.shows }) : [] };
}
