/*
 * Screens in the conversation (pure types): the screenshots an answer gave, as the core kept them
 * (server/org/screens.ts). Each is one of the product's screens in What people see (src/seen/) and a
 * picture source whose printed words are the product's own copy, never anyone's words.
 */

/** A screenshot as an answer gave it: the asset ("asset:<hash>" or the bare hash) and its name. */
export interface ShownShot {
  asset: string;
  title: string;
}

export interface KeptShot {
  /** The asset's bare hash. */
  asset: string;
  title: string;
  /** The source that holds it. */
  source: string;
  /** The screen it's kept as; none: it isn't a screen of theirs, and it's an ordinary picture source. */
  screen?: { map: string; key: string; name: string };
  /** What Qalam AI read it as (a screen, a chart…), and what it's about, checked against its print. */
  shows?: string;
  about?: string;
  /** What's printed on it, read on this computer (none off a Mac). */
  printed: string;
  /** It couldn't be read at all here: kept by its name alone. */
  unread?: true;
}

export interface KeptShots {
  /** The map they're kept in: the product's, or the organization's own. */
  map: string;
  /** The flow they make, when they're two screens or more. */
  flow?: { key: string; name: string };
  shots: KeptShot[];
}

/** Most screenshots kept from one answer. */
export const KEEP_MAX = 12;
