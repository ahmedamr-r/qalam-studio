import { describe, expect, it } from "vitest";
import { feedLine, feedsOn, feedTarget, foldFeeds, freshHits, hitOrigin, type FeedLog } from "./feeds";

const first = feedLine({ id: "f1", connector: "intercom", query: 'object_type:conversations q:"fare"', title: "Fare chats", targets: [{ board: "b1", card: "c1" }], at: 1 });

describe("feeds as they are now", () => {
  it("folds a feed's first line with every change after it", () => {
    const log: FeedLog[] = [
      first,
      { id: "f1", wire: [{ goal: "g1" }, { board: "b1", card: "c1" }], at: 2 },
      { id: "f1", seen: ["https://x/1"], results: ["s1"], read: 3, at: 3 },
      { id: "f1", seen: ["https://x/1", "https://x/2"], results: ["s2"], at: 4 },
      { id: "f1", unwire: [{ board: "b1", card: "c1" }], query: 'object_type:conversations q:"price"', at: 5 },
    ];
    const [f] = foldFeeds(log);
    expect(f).toMatchObject({ connector: "intercom", query: 'object_type:conversations q:"price"', title: "Fare chats", targets: [{ goal: "g1" }], seen: ["https://x/1", "https://x/2"], results: ["s1", "s2"], read: 3, status: "on", changed: 5 });
  });

  it("drops a first line with no connector or words, and a change that would empty its words", () => {
    expect(foldFeeds([{ id: "x", connector: "intercom", query: " ", at: 1 }])).toEqual([]);
    const [f] = foldFeeds([first, { id: "f1", query: "  ", status: "off", at: 2 }]);
    expect([f.query, f.status]).toEqual(['object_type:conversations q:"fare"', "off"]);
  });

  it("keeps a target only in a shape it knows", () => {
    expect(feedTarget({ goal: "g1" })).toEqual({ goal: "g1" });
    expect(feedTarget({ board: "b1", card: "c1" })).toEqual({ board: "b1", card: "c1" });
    expect(feedTarget({ board: "b1" })).toBeNull();
    expect(feedTarget("g1")).toBeNull();
  });
});

describe("what's new for a feed", () => {
  const hits = [
    { id: "1", title: "Old chat", url: "https://x/1", at: "2026-10-01T00:00:00Z" },
    { id: "2", title: "Taken in elsewhere", url: "https://x/2" },
    { id: "3", title: "New chat", url: "https://x/3" },
    { id: "4", title: "Changed chat", url: "https://x/4", at: "2026-10-30T00:00:00Z" },
    { id: "5", title: "A folder", folder: true },
  ];
  it("is what it hasn't seen and no source came from, or what changed since it last read", () => {
    const feed = { connector: "intercom", seen: ["https://x/1", "https://x/4"], read: Date.parse("2026-10-15T00:00:00Z") };
    expect(freshHits(hits, feed, new Set(["https://x/2"])).map((h) => h.id)).toEqual(["3", "4"]);
  });
  it("names an item with no address by its tool and id", () => {
    expect(hitOrigin("notion", { id: "abc" })).toBe("notion:abc");
  });
});

describe("the feeds on a board", () => {
  it("are those wired to its cards or to a goal its outcome is", () => {
    const feeds = foldFeeds([first, feedLine({ id: "f2", connector: "slack", query: "pickup", title: "Pickup", targets: [{ goal: "g1" }], at: 1 }), feedLine({ id: "f3", connector: "slack", query: "x", title: "x", targets: [{ board: "b2", card: "c9" }], at: 1 })]);
    expect(feedsOn(feeds, "b1", new Set(["g1"])).map((f) => f.id)).toEqual(["f1", "f2"]);
  });
});
