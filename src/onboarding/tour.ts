import type { ResearcherPose } from "@/ui/brand/Researcher";

/*
 * The walkthrough the first time someone lands on a canvas (pure): which stops this canvas has, what
 * each says, and where the words sit beside what's lit. A stop only exists when there's something
 * to point at, so a canvas with no sources wired up never hears about wires.
 */

export type TourTarget = "card" | "lane" | "chat" | "bar" | "sections";

export interface TourStop {
  target: TourTarget;
  pose: ResearcherPose;
  title: string;
  body: string;
}

/** The card a walkthrough points at: the one they picked, else the first real one, else a faint one, when only faint ones were found. */
export type TourCard = { id: string; as: "picked" | "faint" | "plain"; faintLeft: boolean };

export function tourCardOf(cards: readonly { id: string; faint: boolean }[], picked: string | null): TourCard | null {
  const faintLeft = cards.some((c) => c.faint);
  const real = cards.filter((c) => !c.faint);
  const mine = real.find((c) => c.id === picked);
  if (mine) return { id: mine.id, as: "picked", faintLeft };
  if (real[0]) return { id: real[0].id, as: "plain", faintLeft };
  return cards[0] ? { id: cards[0].id, as: "faint", faintLeft: true } : null;
}

const CARD_WORDS: Record<TourCard["as"], { title: string; body: (faintLeft: boolean) => string }> = {
  faint: { title: "Problems I found", body: () => "Faint ones are waiting for you. Click one and choose Work on it to put it on your canvas." },
  picked: { title: "The card you picked", body: (faintLeft) => (faintLeft ? "It's on your canvas, with what you could do next beside it. The faint ones are the other problems I found: click one and choose Work on it." : "What you could do next is beside it. Click any card to see what backs it and what to do with it.") },
  plain: { title: "Your canvas", body: (faintLeft) => `Goals, problems, solutions and tests are all cards here. Click one to see what backs it and what you could do next.${faintLeft ? " Faint ones are waiting: click one and choose Work on it." : ""}` },
};

export function tourStops(o: { card: TourCard | null; lane: boolean; company: string }): TourStop[] {
  return [
    ...(o.card ? [{ target: "card" as const, pose: "found" as const, title: CARD_WORDS[o.card.as].title, body: CARD_WORDS[o.card.as].body(o.card.faintLeft) }] : []),
    ...(o.lane ? [{ target: "lane" as const, pose: "reading" as const, title: "Where the words came from", body: "Each wire runs from a source to the card it backs. Click a source to read what it says." }] : []),
    { target: "chat", pose: "idle", title: "Qalam AI", body: "Ask a question, paste your notes or add a file here. Anything you start, like finding a goal for a problem, runs here too." },
    { target: "bar", pose: "writing", title: "Add more any time", body: "Sources holds everything read so far, and takes your interviews, notes and docs. Add lets you write your own goal or problem." },
    { target: "sections", pose: "idle", title: "The rest of what's known", body: `Problems lists them all, the best backed first. Needs a look shows up when something's worth a second look. ${o.company} holds what's known about it.` },
  ];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the words go beside what's lit: to its side, or above or below something wide and short,
 * whichever fits first, slid along that edge to stay on screen. With nothing that fits (or nothing
 * lit), in the middle.
 */
export function placeBubble(lit: Box | null, size: { w: number; h: number }, screen: { w: number; h: number }, gap = 16, margin = 16): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const middle = { x: clamp((screen.w - size.w) / 2, margin, screen.w - size.w - margin), y: clamp((screen.h - size.h) / 2, margin, screen.h - size.h - margin) };
  if (!lit) return middle;
  const across = clamp(lit.x + lit.w / 2 - size.w / 2, margin, screen.w - size.w - margin);
  const along = clamp(lit.y + lit.h / 2 - size.h / 2, margin, screen.h - size.h - margin);
  const right = { x: lit.x + lit.w + gap, y: along, fits: lit.x + lit.w + gap >= margin && lit.x + lit.w + gap + size.w + margin <= screen.w };
  const left = { x: lit.x - gap - size.w, y: along, fits: lit.x - gap - size.w >= margin && lit.x - gap + margin <= screen.w };
  const below = { x: across, y: lit.y + lit.h + gap, fits: lit.y + lit.h + gap >= margin && lit.y + lit.h + gap + size.h + margin <= screen.h };
  const above = { x: across, y: lit.y - gap - size.h, fits: lit.y - gap - size.h >= margin && lit.y - gap + margin <= screen.h };
  const order = lit.w > lit.h * 3 ? [below, above, right, left] : [right, left, below, above];
  const hit = order.find((p) => p.fits);
  return hit ? { x: hit.x, y: hit.y } : middle;
}
