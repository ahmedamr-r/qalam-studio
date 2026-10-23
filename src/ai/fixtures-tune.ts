import type { TuneResult } from "./tune";

/** Recorded "Tune system" answer for when AI is off: every path and list exists in any system. */
export const SAMPLE_TUNE: TuneResult = {
  // Ids of the built-in system's facts as Tune's prompt numbers them (checked in knowledge.test.ts).
  reliedOn: [
    { id: "d9", why: "The language says mostly flat, yet every Card cast a shadow." },
    { id: "d28", why: "Grouping with Cards was allowed everywhere, so every row got its own box." },
  ],
  diagnosis:
    "The screen reads as a stack of floating boxes: every group sits in its own raised Card with a shadow, so nothing leads and the page feels heavy. The cause is in the system: raised cards cast shadow.sm by default, sections sit only 16px apart, and nothing tells the generator when a Card is the wrong container.",
  tokens: [
    { path: "component.card.raised.shadow", value: "{shadow.none}", reason: "Cards keep their hairline border but stop floating, so the primary action carries the emphasis." },
    { path: "component.card.radius", value: "{radius.md}", reason: "A tighter radius suits flat, outlined cards and matches the inputs." },
    { path: "layout.section-gap", value: "{space.600}", reason: "More space between sections lets groups read as groups without a box around each." },
  ],
  guidance: [
    { target: "layout.rules", op: "add", text: "Group related rows in one Card with a Divider between ListItems; never give each row its own Card", reason: "Stops the generator from boxing every row." },
    { target: "Card.whenNotToUse", op: "add", text: "Around a single ListItem, Text or Button: place it directly in the body instead", reason: "A Card around one element adds weight without grouping anything." },
    { target: "language.donts", op: "add", text: "More than three Cards stacked in one screen body", reason: "Keeps screens calm and scannable." },
  ],
  limitations: [],
};
