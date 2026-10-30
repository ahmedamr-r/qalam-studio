/*
 * What this Mac read off a screenshot (pure types): qalam-see (native/see, run by server/see) reads
 * its words with macOS's text recognition, English and Arabic, and hashes the picture so code can
 * tell the same screen in another state.
 */

/** One line of words: its box [x, y, w, h] from 0 to 1, from the top left, and how sure the reading is (0..1). */
export interface ShotLine {
  text: string;
  box: [number, number, number, number];
  conf: number;
}

/** A screenshot's size in pixels, its difference hash (16 hex: 64 bits from 9×8 grays) and its lines, top to bottom. */
export interface ShotRead {
  w: number;
  h: number;
  dhash: string;
  lines: ShotLine[];
}
