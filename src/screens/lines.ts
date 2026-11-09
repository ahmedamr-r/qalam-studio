import type { FoundLine } from "@/asking/types";
import type { KeptShots } from "./types";

/*
 * What the next turn reads about the screenshots an answer gave (pure): the flow they make, then each
 * screen with what it shows and what's printed on it. What's printed is the product's own copy, so the
 * turn may quote it about the screen, never as anyone's words.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The lines a screens lookup lands with, under its id. */
export function screenLines(id: string, kept: KeptShots): FoundLine[] {
  const lines: FoundLine[] = [];
  const screens = kept.shots.filter((s) => s.screen);
  if (kept.flow && screens.length >= 2) lines.push({ ref: `${id}-flow`, text: `In the order they showed them, kept as the “${kept.flow.name}” flow: ${screens.map((s) => s.screen!.name).join(" → ")}`, from: "their screenshots", whose: "their own screens" });
  kept.shots.forEach((s, i) => {
    const ref = `${id}-${i + 1}`;
    const from = `their screenshot “${s.title}”`;
    if (s.unread) return void lines.push({ ref, text: `${s.title}: nothing on it could be read on this computer`, from, whose: "their own screen" });
    if (!s.screen) return void lines.push({ ref, text: `Not a screen of theirs: ${s.shows ?? "a picture"}${s.about ? `, ${one(s.about)}` : ""}`, from, whose: "a picture they showed" });
    const printed = one(s.printed);
    lines.push({ ref, text: `${s.screen.name}${s.about ? ` (${one(s.about)})` : ""}. ${printed ? `Printed on it: ${clip(printed, 480)}` : "Nothing printed on it could be read here"}`, from, whose: "their own screen" });
  });
  return lines;
}
