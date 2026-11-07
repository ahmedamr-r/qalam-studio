/*
 * The persona bench's a2 in miniature (pure): a grocery app's first checkout, its funnel export as
 * Qalam keeps a sheet, and the PM's payment ideas proposed under a problem only they believe in. The
 * tests and the smoke walk's stubbed call read it.
 */

export const GROCERY_FUNNEL = [
  "step: Basket filled · users_entering: 10000 · users_leaving: 0 · percent_lost: 0",
  "step: Picked a delivery slot · users_entering: 10000 · users_leaving: 4400 · percent_lost: 44",
  "step: Address confirmed · users_entering: 5600 · users_leaving: 560 · percent_lost: 10",
  "step: Payment page reached · users_entering: 5040 · users_leaving: 454 · percent_lost: 9",
  "step: Order placed · users_entering: 4586 · users_leaving: 0 · percent_lost: 0",
].join("\n");
