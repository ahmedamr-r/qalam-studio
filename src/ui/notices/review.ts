import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { noticesDb } from "@/org/notices";

/**
 * Review now: Qalam AI reads the organization's topic pages, boards and decisions for what needs a
 * look beyond code's checks (server/org/review.ts). One review at a time; its findings replace the
 * last review's among the notices.
 */

export const useReview = create<{ running: boolean; note: string | null }>(() => ({ running: false, note: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function reviewNow() {
  if (useReview.getState().running) return;
  if (!(await aiStatus()).ai) return void useReview.setState({ note: "Qalam AI isn't set up here, so it can't review. Code's checks still run." });
  useReview.setState({ running: true, note: null });
  try {
    const found = await noticesDb.review();
    useReview.setState({ note: found.length ? `Qalam AI found ${found.length === 1 ? "one more thing" : `${found.length} more things`} to look at.` : "Qalam AI read everything and found nothing more to look at." });
  } catch (e) {
    useReview.setState({ note: `Qalam AI couldn't review: ${message(e)}` });
  } finally {
    useReview.setState({ running: false });
  }
}
