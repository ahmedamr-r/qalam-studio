import { describe, expect, it } from "vitest";
import { appNameIn, appsIn, bestApp, hnComments, hnMatches, hnSearch, hnThreads, popularApps } from "./sources";

const app = (id: number, name: string, ratings = 500) => ({ trackId: id, trackName: name, trackViewUrl: `https://apps.apple.com/us/app/x/id${id}`, userRatingCount: ratings });

describe("finding an app", () => {
  it("reads Apple's answer, leaving out what isn't an app", () => {
    expect(appsIn({ results: [app(1, "Notion: Notes"), { trackName: "No id" }] })).toEqual([{ id: "1", name: "Notion: Notes", url: "https://apps.apple.com/us/app/x/id1", ratings: 500 }]);
    expect(appsIn(null)).toEqual([]);
    expect(appNameIn({ results: [app(1, "Notion")] })).toBe("Notion");
    expect(appNameIn({ results: [] })).toBeNull();
  });

  it("takes the app with the name whole, the most rated, and no near miss", () => {
    const apps = appsIn({ results: [app(1, "Notional Finance", 9000), app(2, "Notion: Notes, Docs, Tasks", 300), app(3, "Notion Widgets", 80), app(4, "Notion", 2)] });
    expect(bestApp("Notion", apps)?.id).toBe("2");
    expect(bestApp("notion", apps)?.id).toBe("2");
    expect(bestApp("Linear", apps)).toBeNull();
    expect(bestApp("!", apps)).toBeNull();
  });

  it("finds the most rated apps for a search, leaving out those with too few ratings to read", () => {
    const apps = appsIn({ results: [app(1, "Small", 50), app(2, "Big", 9000), app(3, "Middle", 400)] });
    expect(popularApps(apps).map((a) => a.id)).toEqual(["2", "3"]);
  });
});

describe("Hacker News", () => {
  const hit = (story: unknown, text: string, author = "pg_fan") => ({ story_id: story, story_title: "Ask HN: Meal planners?", comment_text: text, author });
  const long = (s: string) => `${s} ${"and it keeps happening every single week ".repeat(3)}`;

  it("keeps a comment's words, with no username and no HTML; too short or threadless, it's left out", () => {
    const got = hnComments({ hits: [hit(9, `<p>${long("I gave up &amp; left")}</p><p>Thanks @pg_fan</p>`), hit(9, "<p>Too short</p>"), hit(null, long("No thread"))] });
    expect(got).toHaveLength(1);
    expect(got[0].story).toBe("9");
    expect(got[0].text).toContain("I gave up & left");
    expect(got[0].text).toContain("Thanks someone");
    expect(got[0].text).not.toMatch(/<p>|pg_fan/);
    expect(hnComments(null)).toEqual([]);
  });

  it("keeps only comments about what was searched", () => {
    expect(hnMatches("We shifted away from fossil fuel years ago", { name: "Shift Fuel" })).toBe(false);
    expect(hnMatches("I tried Shift Fuel on nights", { name: "shift fuel" })).toBe(true);
    expect(hnMatches("My meal plans never fit my shifts", { words: "meal plan shift" })).toBe(true);
    expect(hnMatches("A meal I had once", { words: "meal plan" })).toBe(false);
    expect(hnComments({ hits: [hit(1, long("We shifted from fossil fuel"))] }, { name: "Shift Fuel" })).toEqual([]);
  });

  it("groups comments by thread, the thread most of them are in first, the same comment once", () => {
    const c = (story: string, text: string) => ({ story, title: `Thread ${story}`, text: long(text) });
    const threads = hnThreads([c("1", "one a"), c("1", "one b"), c("2", "two a"), c("2", "two b"), c("2", "two c"), c("2", "two a"), c("3", "three")], 2);
    expect(threads.map((t) => t.origin)).toEqual(["https://news.ycombinator.com/item?id=2", "https://news.ycombinator.com/item?id=1"]);
    expect(threads[0].title).toBe("Hacker News: Thread 2");
    expect(threads[0].text.match(/Hacker News commenter:/g)).toHaveLength(3);
  });

  it("asks only for comments from the last three years", () => {
    const now = Date.UTC(2026, 10, 3);
    expect(hnSearch("meal plans", now)).toContain("query=meal%20plans&tags=comment");
    expect(hnSearch("x", now)).toContain(`created_at_i>${Math.floor((now - 3 * 365 * 86_400_000) / 1000)}`);
  });
});
