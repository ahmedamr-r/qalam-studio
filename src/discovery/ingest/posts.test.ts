import { describe, expect, it } from "vitest";
import { appStoreText, isDiscussion, lookedOnlineLine, postAddress, redditText, withoutHandles } from "./posts";

const comment = (body: string, author = "someone_123", more: Record<string, unknown> = {}, replies: unknown[] = []) => ({ kind: "t1", data: { body, author, ...more, replies: replies.length ? { data: { children: replies } } : "" } });

describe("public posts", () => {
  it("reads a Reddit thread from its JSON and an app's reviews from Apple's feed; anything else as a page", () => {
    expect(postAddress("https://old.reddit.com/r/groceries/comments/abc123/rebuilding_my_basket/")).toEqual({ kind: "reddit", api: "https://www.reddit.com/r/groceries/comments/abc123/.json?limit=100&raw_json=1" });
    expect(postAddress("https://apps.apple.com/ae/app/basket-groceries/id1234567")).toEqual({ kind: "appstore", api: "https://itunes.apple.com/ae/rss/customerreviews/page=1/id=1234567/sortby=mostrecent/json" });
    expect(postAddress("https://www.reddit.com/r/groceries/")).toEqual({ kind: "page" });
    expect(postAddress("not a url")).toEqual({ kind: "page" });
  });

  it("writes a thread as who said what, by role, never by handle, without what's gone", () => {
    const json = [
      { data: { children: [{ kind: "t3", data: { title: "Rebuilding my order every week", selftext: "Is there a **faster** way?", subreddit: "groceries", author: "sara_k" } }] } },
      { data: { children: [comment("Same, it takes me [twenty minutes](https://x.y).", "omar99", {}, [comment("I just reorder", "sara_k", { is_submitter: true })]), comment("[deleted]"), comment("Rule reminder", "AutoModerator")] } },
    ];
    const r = redditText(json)!;
    expect(r.title).toBe("Reddit: Rebuilding my order every week");
    expect(r.text).toBe("Original post in r/groceries: Rebuilding my order every week\nIs there a faster way?\n\nReddit commenter: Same, it takes me twenty minutes.\n\nOriginal poster: I just reorder");
    expect(r.text).not.toMatch(/sara_k|omar99/);
    expect(redditText({})).toBeNull();
  });

  it("writes App Store reviews with their stars, skipping what isn't a review", () => {
    const json = { feed: { title: { label: "Basket" }, entry: [{ author: { name: { label: "Mona" } }, "im:rating": { label: "2" }, title: { label: "Slow" }, content: { label: "Takes forever to reorder." } }, { "im:rating": { label: "x" }, content: { label: "?" } }] } };
    expect(appStoreText(json)).toEqual({ title: "App Store reviews: Basket", text: "App Store reviewer (2 stars): Slow. Takes forever to reorder." });
    expect(appStoreText({ feed: {} })).toBeNull();
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
      "Nothing new: 1 page in already, 2 articles rather than people's own words, 1 Reddit thread Reddit won't show without a sign-in. Paste a thread's or reviews' text with Add to take it in.",
    );
    expect(lookedOnlineLine({ read: 0, added: 0, quotes: 0, skipped: 0, error: "Web search isn't on here." })).toBe("Web search isn't on here.");
  });

  it("takes handles out of a page's words", () => {
    expect(withoutHandles("Thanks u/omar99 and @sara.k, (@team) agreed")).toBe("Thanks someone and someone, (someone) agreed");
  });
});
