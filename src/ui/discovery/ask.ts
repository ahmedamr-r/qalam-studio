import { create } from "zustand";
import type { AskFor } from "@/discovery/questions";
import type { GoalLever } from "@/goals/types";
import { useSources } from "./sources";

/*
 * Questions first (src/discovery/questions.ts): every draft of a card (Draft solutions, Draft its
 * problems, Break it down, Draft its tests) asks before it drafts, in the canvas's chat
 * (src/ui/space/chat/store.ts, askBeforeDraft), for as many rounds as it needs, or none. A card nothing
 * backs yet starts with what they know about it. The card's next steps only say it's being answered
 * there. The answers are kept as a source of their own words from the first one on, so the questions
 * pick up where they were; once the draft runs, the card rests on them.
 */

/** The cards whose draft is being asked about in the chat, each with its turn (kept by the chat's store). */
export const useAskingIn = create<{ cards: Readonly<Record<string, string>> }>(() => ({ cards: {} }));

/** The answers kept for a card and not drafted with yet. */
export const keptAnswers = (card: string) => useSources.getState().list.find((s) => s.answers?.card === card && !s.answers.done);

/** Ask before a card's draft, in the canvas's chat; one going for the card is shown rather than started again. */
export const askFor = (card: string, step: AskFor, o: { levers?: GoalLever[]; thin?: boolean } = {}) => void import("../space/chat/store").then((m) => m.askBeforeDraft(card, step, o));
