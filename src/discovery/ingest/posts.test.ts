import { describe, expect, it } from "vitest";
import { isDiscussion, isReddit, lookedOnlineLine, pickReviews, postAddress, reviewFeed, reviewsIn, reviewsText, withoutHandles } from "./posts";

describe("public posts", () => {
  it("reads an app's reviews from Apple's feed and anything else as a page; a Reddit address isn't ours to read", () => {
    expect(postAddress("https://apps.apple.com/ae/app/basket-groceries/id1234567")).toEqual({ kind: "appstore", id: "1234567", country: "ae" });
    expect(reviewFeed("1234567", "ae", 2)).toBe("https://itunes.apple.com/ae/rss/customerreviews/page=2/id=1234567/sortby=mostrecent/json");
    expect(postAddress("https://old.reddit.com/r/groceries/comments/abc123/x/")).toEqual({ kind: "page" });
    expect(postAddress("not a url")).toEqual({ kind: "page" });
    expect(["https://old.reddit.com/r/x/comments/1", "https://redd.it/abc", "https://reddit.com/r/x"].map(isReddit)).toEqual([true, true, true]);
    expect(["https://reddit.sentinel-team.org/posts/1", "not a url"].map(isReddit)).toEqual([false, false]);
  });

  const entry = (stars: string, content: string, more: Record<string, unknown> = {}) => ({ author: { name: { label: "Mona_K" } }, "im:rating": { label: stars }, title: { label: "Slow" }, content: { label: content }, ...more });

  it("reads reviews with their stars and votes, never who wrote them, skipping what isn't a review", () => {
    const got = reviewsIn({ feed: { entry: [entry("2", "Takes forever to reorder.", { "im:voteSum": { label: "4" }, updated: { label: "2026-10-01T10:00:00-07:00" } }), { "im:rating": { label: "x" }, content: { label: "?" } }] } });
    expect(got).toEqual([{ stars: 2, title: "Slow", words: "Takes forever to reorder.", votes: 4, at: Date.parse("2026-10-01T10:00:00-07:00") }]);
    expect(reviewsIn({ feed: { entry: entry("1", "One entry only") } })).toHaveLength(1);
    expect(reviewsIn({ feed: {} })).toEqual([]);
    expect(reviewsIn(null)).toEqual([]);
    expect(reviewsText("Basket", got)).toEqual({ title: "App Store reviews: Basket", text: "App Store reviewer (2 stars): Slow. Takes forever to reorder." });
    expect(JSON.stringify(reviewsText("Basket", got))).not.toContain("Mona");
    expect(reviewsText("Basket", [])).toBeNull();
  });

  it("keeps complaints first, the most voted and newest first, as many as fit, and no 5 stars", () => {
    const r = (stars: number, words: string, votes = 0, at = 0) => ({ stars, title: "T", words, votes, at });
    const all = [r(5, "Love it"), r(4, "Good but slow"), r(3, "Old complaint", 0, 1), r(1, "New complaint", 0, 2), r(2, "Voted complaint", 9, 0)];
    expect(pickReviews(all).kept.map((x) => x.words)).toEqual(["Voted complaint", "New complaint", "Old complaint", "Good but slow"]);
    expect(pickReviews(all).left).toBe(1);
    const small = pickReviews([r(1, "x".repeat(50)), r(2, "short")], 60);
    expect(small.kept.map((x) => x.words)).toEqual(["short"]);
    expect(small.left).toBe(1);
  });

  it("reads only where people speak for themselves, never an article about them", () => {
    const yes = ["https://www.reddit.com/r/dubai/comments/abc/fees/", "https://apps.apple.com/ae/app/x/id1", "https://forum.example.org/t/fees/12", "https://community.example.com/thread", "https://money.stackexchange.com/q/1", "https://www.trustpilot.com/review/x.com"];
    const no = ["https://www.gulfnews.com/why-your-bill", "https://gerald.com/blog/instacart-costs", "https://reddit.sentinel-team.org/posts/1", "not a url"];
    expect(yes.map(isDiscussion)).toEqual(yes.map(() => true));
    expect(no.map(isDiscussion)).toEqual(no.map(() => false));
  });

  it("says what looking online came to, and why nothing came of it", () => {
    expect(lookedOnlineLine({ read: 2, added: 2, quotes: 9, skipped: 0 })).toBe("Read 2 pages: 9 quotes from people online, filed where they fit.");
    expect(lookedOnlineLine({ read: 0, added: 0, quotes: 0, skipped: 4, why: { before: 1, articles: 2, unreadable: 0, reddit: 1 } })).toBe(
      "Nothing new: 1 page in already, 2 articles rather than people's own words, 1 Reddit thread Reddit doesn't let apps read. Paste a thread's or reviews' text with Add to take it in.",
    );
    expect(lookedOnlineLine({ read: 0, added: 0, quotes: 0, skipped: 0, error: "Web search isn't on here." })).toBe("Web search isn't on here.");
  });

  it("takes handles out of a page's words", () => {
    expect(withoutHandles("Thanks u/omar99 and @sara.k, (@team) agreed")).toBe("Thanks someone and someone, (someone) agreed");
  });
});
