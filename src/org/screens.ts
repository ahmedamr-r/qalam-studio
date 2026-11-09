import { useEffect } from "react";
import { create } from "zustand";
import type { KeptShots, ScreenReview, ShownShot } from "@/screens/types";
import { TAB, orgFetch, orgPath } from "./client";

/*
 * Screens in the conversation, from the window (server/org/screens.ts): the screenshots an answer gave,
 * kept as the product's screens and looked at for the problem, saying how it goes; and the looks kept,
 * as this window has them.
 */

/** An NDJSON answer: each step heard until the result comes (or the error, thrown in words). */
async function streamed<T>(res: Response, onStep?: (label: string) => void): Promise<T> {
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't keep them (${res.status}).`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const m = JSON.parse(line) as { type: string; label?: string; data?: T; message?: string };
      if (m.type === "result" && m.data) return m.data;
      if (m.type === "error") throw new Error(m.message ?? "It stopped.");
      if (m.type === "activity" && m.label) onStep?.(m.label);
    }
  }
  throw new Error("It stopped before saying how it went.");
}

/** Keep the screenshots an answer gave as the product's screens (`product` null: the organization's own), one flow named for what was asked. */
export async function keepScreens(o: { shots: readonly ShownShot[]; product: string | null; about: string }, signal?: AbortSignal, onStep?: (label: string) => void): Promise<KeptShots> {
  const res = await fetch(await orgPath("/screens/keep"), { method: "POST", headers: { "content-type": "application/json", "x-qalam-tab": TAB }, body: JSON.stringify(o), signal });
  return streamed<KeptShots>(res, onStep);
}

/** What they're working out, as a look at the screens is given it. */
export interface ScreensFocus {
  said: string;
  asked?: string;
  typed?: string;
  settled: readonly string[];
}

/** Keep the screenshots, then look at them for the problem: what's kept and the look (none when nothing was a screen). */
export async function reviewScreens(o: { shots: readonly ShownShot[]; product: string | null; about: string; focus: ScreensFocus; answers: readonly { q: string; a: string }[] }, signal?: AbortSignal, onStep?: (label: string) => void): Promise<{ kept: KeptShots; review: ScreenReview | null }> {
  const res = await fetch(await orgPath("/screens/review"), { method: "POST", headers: { "content-type": "application/json", "x-qalam-tab": TAB }, body: JSON.stringify(o), signal });
  const out = await streamed<{ kept: KeptShots; review: ScreenReview | null }>(res, onStep);
  if (out.review) useScreenReviews.setState((s) => ({ reviews: { ...s.reviews, [out.review!.id]: out.review! } }));
  return out;
}

/** A picture taken for a screen of theirs that isn't one: out of their screens (its source too), and out of the looks at them, so it can be taken in as any picture. */
export async function notOurScreen(hash: string): Promise<void> {
  const r = await orgFetch("/screens/not-ours", { method: "POST", json: { asset: hash } });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `It couldn't be taken out of your screens (${r.status}).`);
  const { reviews = [] } = (await r.json().catch(() => ({}))) as { reviews?: ScreenReview[] };
  if (reviews.length) useScreenReviews.setState((s) => ({ reviews: { ...s.reviews, ...Object.fromEntries(reviews.map((x) => [x.id, x])) } }));
}

/** A finding taken onto the canvas or left out: its look remembers. */
export async function decideFinding(review: string, key: string, decision: "accepted" | "discarded"): Promise<void> {
  const r = await orgFetch(`/screens/reviews/${encodeURIComponent(review)}/findings`, { method: "PUT", json: { key, decision } });
  if (!r.ok) return;
  const out = ((await r.json()) as { review: ScreenReview }).review;
  useScreenReviews.setState((s) => ({ reviews: { ...s.reviews, [review]: out } }));
}

/** The looks this window has, by id: kept when one lands, read once after a reload. `byShot`: the looks with something found on a screenshot, the latest first. */
export const useScreenReviews = create<{ reviews: Record<string, ScreenReview>; missing: Record<string, true>; byShot: Record<string, string[]> }>(() => ({ reviews: {}, missing: {}, byShot: {} }));

/** The latest look with something found on a screenshot (by its hash), read from the project once a page load. */
export function useLatestReviewOn(shot: string | null): ScreenReview | null {
  const ids = useScreenReviews((s) => (shot ? s.byShot[shot] : undefined));
  const reviews = useScreenReviews((s) => s.reviews);
  useEffect(() => {
    if (!shot || ids) return;
    void orgFetch(`/screens/reviews?shot=${encodeURIComponent(shot)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ reviews: ScreenReview[] }>) : { reviews: [] }))
      .then(({ reviews: found }) => useScreenReviews.setState((s) => ({ reviews: { ...s.reviews, ...Object.fromEntries(found.map((x) => [x.id, x])) }, byShot: { ...s.byShot, [shot]: found.map((x) => x.id) } })))
      .catch(() => {});
  }, [shot, ids]);
  // A look that lands in this window counts too, the latest first.
  const all = Object.values(reviews).filter((r) => shot && r.findings.some((f) => f.shot === shot));
  return all.sort((a, b) => b.at - a.at)[0] ?? null;
}

const loading = new Set<string>();

/** A look, read from the project when this window doesn't have it yet. */
export async function loadScreenReview(id: string): Promise<void> {
  if (useScreenReviews.getState().reviews[id] || loading.has(id)) return;
  loading.add(id);
  try {
    const r = await orgFetch(`/screens/reviews/${encodeURIComponent(id)}`);
    if (r.ok) {
      const review = ((await r.json()) as { review: ScreenReview }).review;
      useScreenReviews.setState((s) => ({ reviews: { ...s.reviews, [id]: review } }));
    } else useScreenReviews.setState((s) => ({ missing: { ...s.missing, [id]: true } }));
  } finally {
    loading.delete(id);
  }
}
