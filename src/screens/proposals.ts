import { newCard } from "@/discovery/ops";
import type { Proposal } from "@/discovery/proposals";
import type { OstEvidence } from "@/discovery/types";
import { fit } from "./review";
import type { ScreenFinding, ScreenReview } from "./types";

/*
 * What a look at their screens puts on the canvas (pure): each finding a problem resting on the screen
 * it was seen on (Assumed, `came: "seen"`), its one change a solution under it. They go under the card
 * picked, else the North Star, else a tree of their own, and are reviewed like any proposal.
 */

/** A finding's screen, as evidence on its card: no one's words, the picture and where on it. */
export function screenEvidence(r: Pick<ScreenReview, "id" | "shots">, f: ScreenFinding, o: { id: string; now: number }): OstEvidence {
  const source = r.shots.find((s) => s.asset === f.shot)?.source;
  return {
    id: o.id,
    kind: "screen",
    text: f.on?.words ?? f.title,
    ...(source ? { sourceId: source } : {}),
    sourceTitle: f.name,
    shot: { asset: `asset:${f.shot}`, name: f.name, ...(f.on ? { box: f.on.box } : {}), review: r.id, finding: f.key },
    addedBy: "ai",
    at: o.now,
  };
}

/** The proposals a look makes: its findings not decided yet, the worst first. */
export function screensProposals(r: ScreenReview, o: { parentId: string | null; id: () => string; now: number }): Proposal[] {
  const out: Proposal[] = [];
  for (const f of r.findings) {
    if (r.decided?.[f.key]) continue;
    const cardId = o.id();
    // Both sides go with it: what it means for customers, and for the business (or what isn't known of it yet).
    const sides = f.weigh ? `\n\nFor customers: ${f.weigh.customers}\nFor the business${f.weigh.known ? "" : " (not known yet)"}: ${f.weigh.business}` : "";
    const card = newCard("opportunity", { title: f.title, createdBy: "ai", came: "seen", description: `${f.why}${sides}` });
    out.push({ id: `screen:${f.key}`, kind: "card", cardId, parentId: o.parentId, card, backing: { quotes: [], words: [screenEvidence(r, f, { id: o.id(), now: o.now })] }, why: f.why });
    if (!f.change) continue;
    // Where the two sides pull apart, the change is theirs to weigh, and says so.
    const change = newCard("solution", { title: fit(f.change.what, 90), createdBy: "ai", came: "seen", solutionType: "change", description: f.weigh?.apart ? `Your call: no change serves both sides. ${f.change.what}` : f.change.what, ...(f.change.insteadOf ? { how: `In place of “${f.change.insteadOf}”` } : {}) });
    out.push({ id: `change:${f.key}`, kind: "card", cardId: o.id(), parentId: cardId, card: change, backing: { quotes: [], words: [] }, why: "" });
  }
  return out;
}
