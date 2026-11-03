import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanDeps } from "./scan";
import { OrgStore } from "./store";

// Nothing here reaches the web or a model: every scan gets its stand-ins.
vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { scanNow, scanToEnd, startScan, steerQuestions, steerScan, stopScan } = await import("./scan");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-scan-")), "Plans");
  store = await OrgStore.create(dir, { id: "org1", name: "Plans", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const appResult = (id: number, name: string) => ({ trackId: id, trackName: name, trackViewUrl: `https://apps.apple.com/us/app/x/id${id}`, userRatingCount: 900 });
const hnHit = (story: number, text: string, author = "secret_user") => ({ story_id: story, story_title: "Meal planners", comment_text: `${text} ${"it never fits my week, so I gave up on it ".repeat(4)}`, author });
const page = { ref: "", url: "https://community.example.com/t/1", title: "Planner gripes", text: "People say the shopping list never matches the plan.".repeat(5) };

function deps(o: { web?: boolean; competitors?: string[]; quotes?: number; pages?: number; links?: { url: string; title?: string }[] } = {}): ScanDeps & { captured: () => { ing: { title: string; text: string; origin?: string }; basis?: string }[] } {
  let captured: { ing: { title: string; text: string; origin?: string }; basis?: string }[] = [];
  const names = o.competitors ?? ["Mealime"];
  return {
    captured: () => captured,
    research: vi.fn(async (req, emit) => {
      emit("Searched the web");
      if (o.web === false) return null;
      if (req.purpose === "competitors") return { notes: "Mealime plans meals", sources: [{ title: "Reviews", url: "https://site.example.com/mealime" }], steps: [] };
      return { notes: "", sources: o.links ?? [{ title: "Gripes", url: page.url }, { title: "A thread", url: "https://www.reddit.com/r/x/comments/1" }, { title: "An article", url: "https://news.example.com/why" }], steps: [] };
    }) as ScanDeps["research"],
    read: vi.fn(async (l) => ({ ref: "", url: l.url, title: "Reviews", text: `${names.join(" and ")} are meal planning apps people use every week, with plans and shopping lists.`.repeat(4) })),
    structured: vi.fn(async (call: { kind?: string; system?: string; content?: { text: string }[] }) =>
      call.system?.includes("App Store search results") ? { data: { picks: (call.content?.[0].text.match(/a\d+(?=: (Mealime|Big Planner))/g) ?? []) } } : call.kind === "scan-searches" ? { data: { searches: ["it never fits", "it never fits", "gave up"], apps: ["meal planner"] } } : { data: { competitors: names.map((name) => ({ name, lines: [{ text: "Plans meals.", quote: "meal planning apps people use every week", page: "w1" }] })) } },
    ) as ScanDeps["structured"],
    json: vi.fn(async (url: string) => {
      if (url.includes("term=meal%20planner")) return { results: [appResult(11, "Mealime Meal Plans"), appResult(22, "Big Planner"), { ...appResult(33, "Tiny Planner"), userRatingCount: 5 }] };
      if (url.includes("itunes.apple.com/search")) return { results: [appResult(11, "Mealime Meal Plans")] };
      if (url.includes("itunes.apple.com/lookup")) return { results: [appResult(11, "Mealime Meal Plans")] };
      if (url.includes("hn.algolia.com")) return { hits: [hnHit(7, "First comment."), hnHit(7, "Second comment.")] };
      return null;
    }),
    reviews: vi.fn(async (app) => ({ page: { ref: "", url: app.url, title: `App Store reviews: ${app.name}`, text: "App Store reviewer (1 star): Bad. The list is wrong." }, read: 500, kept: 90 })),
    posts: vi.fn(async (l) => (l.url === page.url ? page : null)),
    capture: vi.fn(async (_s, items) => {
      captured = items as typeof captured;
      const quotes = o.quotes ?? 5;
      return { sources: items.map((x: { ing: { title: string } }, i: number) => ({ id: `s${i}`, title: x.ing.title, quotes })), filed: { calls: 1, created: 3, added: 3, revised: 0, retired: 0, disputed: 0, unbacked: 2, pages: Array.from({ length: o.pages ?? 3 }, (_, i) => ({ id: `p${i}`, title: `Problem ${i}`, kind: "need" as const })) }, notFound: 4 };
    }),
  } as ScanDeps & { captured: () => { ing: { title: string; text: string; origin?: string }; basis?: string }[] };
}

const idea = { target: { kind: "idea" as const, said: "A meal planner for shift workers" }, country: "us" };

describe("a scan", () => {
  it("goes from an idea to what people use today, reads what's said about it and files it", async () => {
    const d = deps();
    const s = await scanToEnd(store, idea, d);
    expect(s.state).toBe("done");
    expect(s.competitors).toEqual([
      { name: "Mealime", app: { id: "11", name: "Mealime Meal Plans", url: "https://apps.apple.com/us/app/x/id11" } },
      { name: "Big Planner", app: { id: "22", name: "Big Planner", url: "https://apps.apple.com/us/app/x/id22" } },
    ]);
    expect(s.read.map((r) => r.kind)).toEqual(["reviews", "reviews", "thread", "page", "article"]);
    expect(s.read[0]).toMatchObject({ reviews: { read: 500, kept: 90 }, sourceId: "s0", quotes: 5 });
    expect(s.problems).toHaveLength(3);
    expect(s.checked).toEqual({ kept: 25, notFound: 4, unbacked: 2 });
    expect(s.thin).toBe(false);
  });

  it("reads what's been published as read elsewhere, for what's known about the market, and shows it beside people's words", async () => {
    const d = deps();
    const s = await scanToEnd(store, idea, d);
    const article = d.captured().find((x) => x.ing.origin === "https://news.example.com/why") as { ing: { kind?: string }; basis?: string; focus?: string };
    expect(article.ing.kind).toBe("url");
    expect(article.basis).toBe("read");
    expect(article.focus).toContain("what they use today and pay");
    expect(s.read.at(-1)).toMatchObject({ kind: "article", origin: "https://news.example.com/why" });
    expect(vi.mocked(d.research).mock.calls.map(([r]) => r.purpose)).toContain("space");
  });

  it("goes by people's words when it says it found little: what's published can't make up for them", async () => {
    const d = deps({ quotes: 2, links: [{ title: "An article", url: "https://news.example.com/why" }] });
    vi.mocked(d.reviews).mockResolvedValue(null);
    vi.mocked(d.json).mockResolvedValue(null);
    const taken = vi.mocked(d.capture).getMockImplementation()!;
    vi.mocked(d.capture).mockImplementation(async (a, items, o) => ({ ...(await taken(a, items, o)), sources: items.map((x, i) => ({ id: `s${i}`, title: x.ing.title, quotes: 40 })) }));
    const s = await scanToEnd(store, idea, d);
    expect(s.read.map((r) => r.kind)).toEqual(["article"]);
    expect(s.problems).toHaveLength(3);
    expect(s.checked.kept).toBe(40);
    expect(s.thin).toBe(true);
  });

  it("keeps what others offer in what's known, a person's competitor stays theirs, and an earlier look's isn't taken for theirs", async () => {
    await store.changeMarket((m) => ({ ...m, competitors: [{ id: "c1", name: "Paprika", lines: [], by: "you", at: 1 }, { id: "c2", name: "Old Rival", lines: [], by: "qalam", at: 1 }] }));
    const d = deps({ competitors: ["Mealime"] });
    const rival = { competitors: [{ name: "Mealime", page: "w1", lines: [{ text: "Mealime are meal planning apps.", page: "w1", quote: "are meal planning apps people use every week" }] }] };
    const answer = vi.mocked(d.structured).getMockImplementation()!;
    vi.mocked(d.structured).mockImplementation(async (call, signal) => ((call as { system?: string }).system?.includes("competitors from web pages") ? { data: rival } : answer(call, signal)) as never);
    const s = await scanToEnd(store, idea, d);
    const task = vi.mocked(d.research).mock.calls.find(([r]) => r.purpose === "competitors")![0].task;
    expect(task).toContain("Paprika");
    expect(task).not.toContain("Old Rival");
    expect(task).toContain("what it charges");
    const m = await store.getMarket();
    expect(m.competitors.map((c) => c.name)).toEqual(["Paprika", "Mealime", "Old Rival"]);
    expect(m.competitors.find((c) => c.name === "Mealime")?.lines[0].quote).toContain("meal planning apps");
    expect(s.known).toContainEqual(expect.objectContaining({ kind: "product", name: "Mealime", text: "Mealime are meal planning apps." }));
  });

  it("says what others charge, a price first, and an app no lookup named only with a price", async () => {
    const d = deps({ competitors: ["Mealime"] });
    const rival = { competitors: [{ name: "Mealime", page: "w1", lines: [{ text: "Mealime are meal planning apps.", page: "w1", quote: "are meal planning apps people use every week" }] }] };
    const answer = vi.mocked(d.structured).getMockImplementation()!;
    vi.mocked(d.structured).mockImplementation(async (call, signal) => {
      const c = call as { system?: string; content?: { text: string }[] };
      if (c.system?.includes("competitors from web pages")) return { data: rival } as never;
      if (c.system?.includes("what products charge")) return { data: { prices: [{ name: "Mealime", text: "Mealime Pro costs $5.99 a month.", page: "w1", quote: "Mealime Pro costs $5.99 per month." }] } } as never;
      return answer(call, signal) as never;
    });
    vi.mocked(d.read).mockImplementation(async (l) => ({ ref: "", url: l.url, title: "Mealime pricing", text: `Mealime are meal planning apps people use every week. Mealime Pro costs $5.99 per month. ${"Plans and lists. ".repeat(20)}` }));
    const s = await scanToEnd(store, idea, d);
    const m = await store.getMarket();
    expect(m.competitors.find((c) => c.name === "Mealime")?.lines[0].text).toBe("Mealime Pro costs $5.99 a month.");
    expect(s.known?.[0]).toMatchObject({ kind: "product", text: "Mealime Pro costs $5.99 a month." });
    expect(m.competitors.map((c) => c.name)).not.toContain("Big Planner");
  });

  it("looks at what a product competes with too, on its own lookup, and a failed lookup for what's published doesn't stop it", async () => {
    const d = deps();
    const look = vi.mocked(d.research).getMockImplementation()!;
    vi.mocked(d.research).mockImplementation(async (req, emit, signal) => {
      if (req.purpose === "space") throw new Error("search failed");
      return look(req, emit, signal);
    });
    const s = await scanToEnd(store, { target: { kind: "product", name: "Mealime" }, country: "us" }, d);
    expect(s.state).toBe("done");
    expect(vi.mocked(d.research).mock.calls.find(([r]) => r.purpose === "competitors")![0].task).toContain("competes with Mealime");
  });

  it("hears what they say while it reads, in what's left to search and in what's read", async () => {
    const d = deps();
    const look = vi.mocked(d.research).getMockImplementation()!;
    vi.mocked(d.research).mockImplementation(async (req, emit, signal) => {
      // Answered once it's got going: the competitor lookup has run, the rest hasn't.
      if (req.purpose === "competitors") await steerScan(store, { said: [{ question: "Who first?", answer: "Night nurses" }] });
      return look(req, emit, signal);
    });
    const s = await scanToEnd(store, idea, d);
    const tasks = vi.mocked(d.research).mock.calls.map(([r]) => [r.purpose, r.task] as const);
    expect(tasks.find(([p]) => p === "competitors")?.[1]).not.toContain("Night nurses");
    expect(tasks.find(([p]) => p === "posts")?.[1]).toContain("Night nurses");
    expect(tasks.find(([p]) => p === "space")?.[1]).toContain("Night nurses");
    const [, , opts] = vi.mocked(d.capture).mock.calls[0];
    expect(opts.focus).toContain("Night nurses");
    expect(opts.focus).toContain("never what to find");
    expect((d.captured().find((x) => x.ing.origin === "https://news.example.com/why") as { focus?: string }).focus).toContain("Night nurses");
    expect(s.steer?.said).toEqual([{ question: "Who first?", answer: "Night nurses" }]);
  });

  it("reads nothing of what they took off, even after its reviews came in, and never proposes it again", async () => {
    const d = deps({ competitors: ["Mealime"] });
    const rival = { competitors: [{ name: "Mealime", page: "w1", lines: [{ text: "Mealime are meal planning apps.", page: "w1", quote: "are meal planning apps people use every week" }] }] };
    const answer = vi.mocked(d.structured).getMockImplementation()!;
    vi.mocked(d.structured).mockImplementation(async (call, signal) => ((call as { system?: string }).system?.includes("competitors from web pages") ? { data: rival } : answer(call, signal)) as never);
    const look = vi.mocked(d.research).getMockImplementation()!;
    vi.mocked(d.research).mockImplementation(async (req, emit, signal) => {
      // Reviews have been fetched by now; the reading hasn't started.
      if (req.purpose === "posts") await steerScan(store, { off: ["Mealime"] });
      return look(req, emit, signal);
    });
    const s = await scanToEnd(store, idea, d);
    const titles = d.captured().map((x) => x.ing.title);
    expect(vi.mocked(d.reviews).mock.calls.length).toBe(2);
    expect(titles).not.toContain("App Store reviews: Mealime Meal Plans");
    expect(titles).toContain("App Store reviews: Big Planner");
    expect(s.read.map((r) => r.title)).toEqual(titles);
    const m = await store.getMarket();
    expect(m.competitors.map((c) => c.name)).not.toContain("Mealime");
    expect(m.gone).toContain("mealime");
  });

  it("doesn't fetch an app they took off in time", async () => {
    const d = deps();
    // The list goes out before the reviews are fetched, so a click there comes in time.
    const change = store.changeScanSession.bind(store);
    const spy = vi.spyOn(store, "changeScanSession").mockImplementation(async (fn, o) => {
      const n = await change(fn, o);
      if (n.competitors.some((c) => c.name === "Big Planner") && !n.steer) await change((x) => ({ ...x!, steer: { said: [], off: ["Big Planner"] } }));
      return n;
    });
    await scanToEnd(store, idea, d);
    spy.mockRestore();
    expect(vi.mocked(d.reviews).mock.calls.map(([a]) => a.name)).toEqual(["Mealime Meal Plans"]);
  });

  it("changes nothing once it's over, and with nothing to say", async () => {
    const d = deps();
    await scanToEnd(store, idea, d);
    const before = await store.getScanSession();
    expect(await steerScan(store, { said: [{ question: "Who first?", answer: "Nurses" }] })).toEqual(before);
    expect((await store.getScanSession())?.steer).toBeUndefined();
    await store.changeScanSession((s) => ({ ...s!, state: "reading" }));
    const still = await store.getScanSession();
    expect(await steerScan(store, { said: [] })).toEqual(still);
  });

  it("asked again, what they said still stands", async () => {
    const d = deps();
    const s = await scanToEnd(store, { ...idea, told: [{ question: "Who first?", answer: "Night nurses" }] }, d);
    expect(s.steer?.said).toHaveLength(1);
    expect(vi.mocked(d.capture).mock.calls[0][2].focus).toContain("Night nurses");
  });

  it("works out the questions from their words alone, and asks code's own when it can't", async () => {
    const answer = { understood: "You want a meal planner for shift workers.", who: ["Nurses", "Drivers"] };
    const ask = vi.fn(async () => ({ data: answer }));
    const q = await steerQuestions({ target: idea.target }, new AbortController().signal, { structured: ask as never });
    expect(q.map((x) => x.id)).toEqual(["meant", "who", "seen"]);
    expect(q[0].title).toBe("You want a meal planner for shift workers. Right?");
    expect(q[1].options.map((o) => o.label)).toEqual(["Nurses", "Drivers"]);
    const failed = await steerQuestions({ target: idea.target }, new AbortController().signal, { structured: (async () => { throw new Error("No engine"); }) as never });
    expect(failed[0].title).toBe(`You want to build: ${idea.target.said}. Right?`);
    expect(failed[1].options).toEqual([]);
  });

  it("never reads Reddit, says so, and keeps no usernames", async () => {
    const d = deps();
    const s = await scanToEnd(store, idea, d);
    expect(s.skipped).toEqual({ reddit: 1, before: 0, articles: 0, unreadable: 0 });
    expect(s.notRead?.map((n) => n.why)).toEqual(["reddit"]);
    expect(vi.mocked(d.posts).mock.calls.map(([l]) => l.url)).toEqual([page.url]);
    const thread = d.captured().find((x) => x.ing.origin?.includes("ycombinator"))!;
    expect(thread.ing.origin).toBe("https://news.ycombinator.com/item?id=7");
    expect(thread.ing.text).toContain("Hacker News commenter: First comment.");
    expect(thread.ing.text).not.toContain("secret_user");
  });

  it("runs each search once, adding the names people use", async () => {
    const d = deps();
    await scanToEnd(store, idea, d);
    const asked = vi.mocked(d.json).mock.calls.map(([u]) => u).filter((u) => u.includes("hn.algolia.com")).map((u) => new URL(u).searchParams.get("query"));
    expect(asked).toEqual(["it never fits", "gave up", "Mealime"]);
  });

  it("takes reviews as a product's own customers' words only when they say it's theirs", async () => {
    const link = "https://apps.apple.com/us/app/mealime/id11";
    const mine = deps();
    await scanToEnd(store, { target: { kind: "product", name: "Mealime", app: link, mine: true }, country: "us" }, mine);
    const said = mine.captured().filter((x) => x.basis === "said");
    expect(said.map((x) => x.ing.title)).toEqual(["App Store reviews: Mealime"]);
    const theirs = deps();
    await rm(path.join(dir, "chats"), { recursive: true, force: true });
    await scanToEnd(store, { target: { kind: "product", name: "Mealime", app: link }, country: "us" }, theirs);
    expect(theirs.captured().some((x) => x.basis === "said")).toBe(false);
  });

  it("names a product from its link when they gave only that", async () => {
    const d = deps();
    const s = await scanToEnd(store, { target: { kind: "product", name: "", app: "https://apps.apple.com/us/app/x/id11" }, country: "us" }, d);
    expect(s.read[0].title).toBe("App Store reviews: Mealime Meal Plans");
  });

  it("takes no app that isn't this product's, and goes on without one", async () => {
    const d = deps({ competitors: ["Paprika"] });
    const s = await scanToEnd(store, { target: { kind: "product", name: "Paprika" }, country: "us" }, d);
    expect(s.competitors).toEqual([{ name: "Paprika" }]);
    expect(d.reviews).not.toHaveBeenCalled();
    expect(s.state).toBe("done");
  });

  it("reads only the apps Qalam AI says are for this need, and tells the reader what they're looking into", async () => {
    const d = deps();
    await scanToEnd(store, idea, d);
    expect(vi.mocked(d.reviews).mock.calls.map(([a]) => a.id)).not.toContain("33");
    expect(vi.mocked(d.capture).mock.calls[0][2].focus).toContain("A meal planner for shift workers");
  });

  it("reads one app once, whichever country's store a page links, and tries on until enough pages read", async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://community.example.com/t/${i}`);
    const d = deps({ links: [{ url: "https://apps.apple.com/cz/app/id11" }, ...urls.map((url) => ({ url }))] });
    vi.mocked(d.posts).mockImplementation(async (l) => (Number(l.url.split("/").pop()) >= 3 ? { ...page, url: l.url } : null));
    const s = await scanToEnd(store, idea, d);
    expect(vi.mocked(d.posts).mock.calls.map(([l]) => l.url)).not.toContain("https://apps.apple.com/cz/app/id11");
    expect(s.read.filter((r) => r.kind === "page")).toHaveLength(5);
    expect(s.skipped.unreadable).toBe(3);
  });

  it("for an idea, reads the apps most people use when its named ones have none", async () => {
    const d = deps({ competitors: ["Paprika"] });
    const s = await scanToEnd(store, idea, d);
    expect(s.competitors.map((c) => c.name)).toEqual(["Paprika", "Mealime Meal Plans", "Big Planner"]);
    expect(vi.mocked(d.reviews).mock.calls.map(([a]) => a.id)).toEqual(["11", "22"]);
  });

  it("says when it found little, rather than making it look like enough", async () => {
    expect((await scanToEnd(store, idea, deps({ pages: 2 }))).thin).toBe(true);
    await rm(path.join(dir, "chats"), { recursive: true, force: true });
    const few = await scanToEnd(store, { target: { kind: "product", name: "Other" }, country: "us" }, deps({ quotes: 1, links: [] }));
    expect(few.thin).toBe(true);
  });

  it("with no web search still reads what code can, and says so", async () => {
    const d = deps({ web: false, competitors: [] });
    const s = await scanToEnd(store, { target: { kind: "product", name: "Mealime" }, country: "us" }, d);
    expect(s.noWeb).toBe(true);
    expect(s.read.map((r) => r.kind)).toEqual(["reviews", "thread"]);
    expect(s.state).toBe("done");
  });

  it("doesn't read a page it has already kept", async () => {
    await store.putSource({ v: 1, id: "old", projectId: "", boards: [], product: null, kind: "post", title: "Planner gripes", origin: page.url, text: "x", addedAt: 1, read: [], quotes: [], needs: [] });
    const d = deps();
    const s = await scanToEnd(store, idea, d);
    expect(d.posts).not.toHaveBeenCalled();
    expect(s.skipped.before).toBe(1);
  });

  it("says when it failed, and a scan nothing runs any more says it stopped", async () => {
    const d = deps();
    vi.mocked(d.capture).mockRejectedValueOnce(new Error("Plan limit reached"));
    const s = await scanToEnd(store, idea, d);
    expect(s).toMatchObject({ state: "failed", error: "Plan limit reached" });
    await store.changeScanSession((x) => ({ ...x!, state: "reading" }));
    expect(await scanNow(store)).toMatchObject({ state: "failed" });
  });

  it("a run stopped late leaves the next scan's session alone", async () => {
    let finish!: (v: null) => void;
    const slow = deps();
    let step: (label: string) => void = () => {};
    vi.mocked(slow.research).mockImplementation((_r, emit) => {
      step = emit;
      return new Promise((yes) => (finish = yes));
    });
    await startScan(store, idea, { deps: slow });
    await vi.waitFor(() => expect(slow.research).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 2));
    const next = deps();
    const started = await startScan(store, { target: { kind: "product", name: "Mealime" }, country: "us" }, { deps: next });
    step("A late step from the old one");
    finish(null);
    await vi.waitFor(async () => expect((await store.getScanSession())?.state).toBe("done"));
    const end = (await store.getScanSession())!;
    expect(end.at).toBe(started.at);
    expect(end.target).toMatchObject({ kind: "product" });
    expect(end.steps).not.toContain("A late step from the old one");
  });

  it("answers at once, and Stop ends it as stopped with nothing filed", async () => {
    const d = deps();
    vi.mocked(d.research).mockImplementation((_r, _e, signal) => new Promise((_, no) => signal.addEventListener("abort", () => no(new Error("aborted")))));
    const s = await startScan(store, idea, { deps: d });
    expect(s.state).toBe("reading");
    await vi.waitFor(() => expect(d.research).toHaveBeenCalled());
    stopScan(store);
    await vi.waitFor(async () => expect((await store.getScanSession())?.state).toBe("stopped"));
    expect(d.capture).not.toHaveBeenCalled();
  });
});
