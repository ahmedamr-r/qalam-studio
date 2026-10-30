/** A person's change to a product's map, as the window sends it (server/org/seen.ts `seenEditShape`). */
export type SeenEditBody =
  | { screen: string; name?: string; does?: string; on?: string; design?: string; state?: { shot: string; text: string } }
  | { removeScreen: string }
  | { flow: string; name?: string; aim?: string; note?: string; notShown?: string[] }
  | { removeFlow: string };
