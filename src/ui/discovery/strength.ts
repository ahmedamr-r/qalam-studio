import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { isOstCard } from "@/doc/board";
import { useStudio } from "@/doc/store";
import type { OstCard } from "@/discovery/types";
import { voicesByQuote } from "@/hub/people";
import { strengthOf, type Strength } from "@/hub/strength";
import { usePeople } from "@/org/people";
import { useSources } from "./sources";

/**
 * A card's strength on this board (src/hub/strength.ts): its quotes as voices, from the sources
 * the board has (its own and visiting ones) and the people the organization knows; a solution's
 * tests from the cards under it.
 */

/** Every quote's voice, from the board's sources and the organization's people. */
export function useVoices() {
  const list = useSources((s) => s.list);
  const visiting = useSources((s) => s.visiting);
  const people = usePeople((s) => s.people);
  return useMemo(() => voicesByQuote([...list, ...visiting], people), [list, visiting, people]);
}

export function useStrength(id: string, card: OstCard): Strength {
  const voices = useVoices();
  const tests = useStudio(
    useShallow((s) => {
      const n = s.doc.nodes[id];
      return n && card.kind === "solution" ? n.children.map((c) => s.doc.nodes[c]).filter(isOstCard).map((c) => c.meta.ost.stage) : [];
    }),
  );
  return useMemo(() => strengthOf(card, { now: Date.now(), voices, tests: tests.map((stage) => ({ stage })) }), [card, voices, tests]);
}
