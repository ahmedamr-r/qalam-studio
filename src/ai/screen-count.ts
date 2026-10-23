/**
 * How many screens Generate makes for a new screen: one, Qalam AI's best design, unless the
 * designer asks for alternatives ("show me 3 options"), up to MAX_SCREENS. Whether a brief asks
 * for alternatives is the model's call ("a form with 4 options" doesn't); the planner writes one
 * direction per screen, and code holds the count to the range. Shared by the routes and the client.
 */

export const DEFAULT_SCREENS = 1;
export const MAX_SCREENS = 5;

/** The screens a plan's directions ask for (one per direction), or the default without a plan. */
export function screensFor(plan?: { variants: string[] }): number {
  const n = plan?.variants.length ?? 0;
  return Math.min(MAX_SCREENS, Math.max(DEFAULT_SCREENS, n));
}
