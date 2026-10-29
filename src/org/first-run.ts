import { orgJson } from "./client";

/*
 * The first run at an organization, as this computer keeps it (`.qalam/local`): when Finish was
 * clicked, and whether Yours was answered. Where it stopped otherwise is read from what's kept
 * (`firstRunLeft`, src/ui/welcome/steps.ts), so the home can offer to pick it up.
 */

export interface FirstRunView {
  /** When Finish was clicked here (null: not yet). */
  done: number | null;
  /** Which goals are theirs was answered here (even with none). */
  picked: boolean;
}

export const firstRunDb = {
  view: () => orgJson<FirstRunView>("/first-run"),
  finish: () => orgJson<FirstRunView>("/first-run", { method: "POST" }),
};
