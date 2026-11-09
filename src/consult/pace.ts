import type { Level } from "./situation";

/*
 * How the consultant paces itself for who's asking (pure): how many questions a round holds, and
 * whether it shows an example and explains a term. Someone new gets a few at a time with help; someone
 * seasoned gets every question it can ask now, with none.
 */

/** The most questions a round holds for each level; none: no cap. The rest wait for a later round. */
export const ROUND_CAP: Record<Level, number | undefined> = { new: 3, some: 5, seasoned: undefined };

export const capFor = (l: Level) => ROUND_CAP[l];

/** Whether a question shows its example of a useful answer, and explains a term the first time. */
export const teaches = (l: Level) => l !== "seasoned";

/** Whether the round shows "So far / Still open" before it: not for someone who does this for a living. */
export const reflects = (l: Level) => l !== "seasoned";
