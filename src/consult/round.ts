import type { PlanQuestion } from "@/ai/plan";
import type { Layer } from "./situation";

/*
 * Code's own opening, used only when Qalam AI's first turn can't be had (no answer in time, or a call
 * that fails): one or two open questions for where they came in, each skippable. Never asked when a
 * turn can be.
 */

const open = (id: string, title: string, why: string): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false });

export function consultRound(layer: Layer): PlanQuestion[] {
  if (layer === "page")
    return [
      open("what", "What's happening there that made you want to work on it?", "So we start from what you've seen."),
      open("when", "When did you first notice it, and did anything change around then?", "A change around that time is often the cause."),
    ];
  if (layer === "idea") return [open("who", "Who has this problem, and when did you last see it happen to them?", "A real person and a real time tell more than the idea itself.")];
  if (layer === "grow") return [open("number", "What would growing mean for you, as a number, and where is it now?", "So we can tell whether anything we try works.")];
  return [open("earns", "Who are your customers, and how does the business earn from them?", "Everything else hangs on this.")];
}
