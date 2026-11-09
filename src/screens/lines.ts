import type { FoundLine } from "@/asking/types";
import type { KeptShots, ScreenReview } from "./types";

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

/** Most findings the next turn reads: the worst first. */
const READ_FINDINGS = 8;

/**
 * What Qalam AI's look at the screens found, as the next turn reads it: each finding as its reading, the
 * worst first, so the turn can ask them whether it holds; or that it couldn't look, or found nothing.
 */
export function reviewLines(id: string, r: ScreenReview | null): FoundLine[] {
  if (!r) return [];
  const whose = "Qalam AI's reading of their screens, not their words";
  const from = "Qalam AI's look at their screens";
  if (r.unseen) return [{ ref: `${id}-look`, text: "Qalam AI couldn't look at them for the problem: the engine here can't see pictures", from, whose }];
  if (!r.findings.length) return [{ ref: `${id}-look`, text: "Nothing on these screens bears on what they're working out, as Qalam AI looked", from, whose }];
  return r.findings.slice(0, READ_FINDINGS).map((f, i) => ({ ref: `${id}-f${i + 1}`, text: `On ${f.name}, from the ${f.side}'s side: ${f.title}. ${f.why}${f.change ? ` Change: ${f.change.what}` : ""}`, from, whose }));
}
