import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketDeps } from "./market";
import { OrgStore } from "./store";

// Nothing here reaches the web or a model: every look gets its stand-ins.
vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { lookForCompetitors, lookUpCompany, lookUpDomain, marketSession, settleCompany, settleCompetitors } = await import("./market");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-market-")), "Tagaddod");
  store = await OrgStore.create(dir, { id: "org1", name: "Tagaddod", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const site = { url: "https://tagaddod.com/", title: "Tagaddod", text: "Tagaddod collects used cooking oil from homes and restaurants in Cairo and Giza, and turns it into biodiesel. Households get points they spend in our partner shops for every litre they hand in. ".repeat(2) };

const deps = (o: { web?: boolean; facts?: unknown } = {}): MarketDeps => ({
  research: vi.fn(async (_req, emit) => {
    emit("Searched the web: Tagaddod");
    return o.web === false ? null : { notes: "- Tagaddod collects used oil [Tagaddod](https://tagaddod.com/)", sources: [{ title: "Tagaddod", url: "https://tagaddod.com/" }], steps: [] };
  }),
  read: vi.fn(async (l) => (l.url.startsWith("https://tagaddod.com") ? { ref: "", ...site } : null)),
  structured: vi.fn(async () => ({
    data: o.facts ?? {
      facts: [
        { text: "Collects used cooking oil from homes and restaurants in Cairo and Giza.", field: "does", quote: "collects used cooking oil from homes and restaurants in Cairo and Giza", page: "w1" },
        { text: "Gives households points for each litre.", field: "model", quote: "Households get points they spend in our partner shops for every litre", page: "w1" },
        { text: "Operates in Alexandria.", field: "where", quote: "operates in Alexandria", page: "w1" },
      ],
    },
  })) as MarketDeps["structured"],
});

/** Until the look running in the core settles down. */
async function settled() {
  for (const end = Date.now() + 10_000; Date.now() < end; ) {
    const s = await marketSession(store);
    if (s.company && s.company.state !== "looking") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("still looking");
}

describe("looking the company up in the first run", () => {
  it("reads its site and what the web says, keeps the facts found on the page, and leaves them to check", async () => {
    const d = deps();
    const started = await lookUpCompany(store, { site: "tagaddod.com" }, { deps: d });
    expect(started.company).toMatchObject({ state: "looking", site: "tagaddod.com" });
    const s = await settled();
    expect(s.company).toMatchObject({ state: "ready", pages: [{ url: "https://tagaddod.com/" }] });
    expect(s.company!.facts.map((f) => [f.text, f.by, f.url])).toEqual([
      ["Collects used cooking oil from homes and restaurants in Cairo and Giza.", "qalam", "https://tagaddod.com/"],
      ["Gives households points for each litre.", "qalam", "https://tagaddod.com/"],
    ]);
    expect(s.company!.steps).toContain("Searched the web: Tagaddod");
    expect(d.read).toHaveBeenCalledTimes(1);
  });

  it("writes what they keep (a fixed one in their words, as theirs) and fills the About's empty fields", async () => {
    await lookUpCompany(store, { site: "tagaddod.com" }, { deps: deps() });
    const [does, model] = (await settled()).company!.facts;
    const s = await settleCompany(store, [{ id: does.id, keep: true, text: "Collects used cooking oil from homes and restaurants across Egypt." }, { id: model.id, keep: false }], ["Founded in 2016."], { deps: deps({ web: false }) });
    expect(s.company).toMatchObject({ state: "settled", kept: 2 });
    // The domain is read once the facts are kept (no web here: it settles at once).
    for (const end = Date.now() + 10_000; Date.now() < end && (await marketSession(store)).domain?.state !== "settled"; ) await new Promise((r) => setTimeout(r, 10));
    expect((await marketSession(store)).domain).toMatchObject({ state: "settled", noWeb: true });
    const m = await store.getMarket();
    expect(m.company.map((l) => [l.text, l.by])).toEqual([
      ["Collects used cooking oil from homes and restaurants across Egypt.", "you"],
      ["Founded in 2016.", "you"],
    ]);
    expect(await readFile(path.join(dir, "hub/market.md"), "utf8")).toContain("([Tagaddod](https://tagaddod.com/))");
    expect((await store.getAbout()).context).toBe("Collects used cooking oil from homes and restaurants across Egypt. Founded in 2016.");
  });

  it("with no web search here, asks for their own words; their line is read as theirs", async () => {
    await lookUpCompany(store, { site: "nowhere.example" }, { deps: deps({ web: false }) });
    expect((await settled()).company).toMatchObject({ state: "ready", noWeb: true, facts: [] });
    await lookUpCompany(store, { said: "We collect used cooking oil from homes in Cairo." }, { deps: deps({ web: false, facts: { facts: [{ text: "Collects used cooking oil from homes in Cairo.", field: "does", quote: "We collect used cooking oil from homes in Cairo.", page: "you" }] } }) });
    expect((await settled()).company!.facts).toMatchObject([{ text: "Collects used cooking oil from homes in Cairo.", by: "you" }]);
  });
});

describe("competitors and the domain in the first run", () => {
  const oilio = { ref: "", url: "https://oilio.example/", title: "Oilio", text: "Oilio buys used cooking oil from restaurants across Alexandria. ".repeat(5) };
  const report = { ref: "", url: "https://report.example/uco", title: "UCO in MENA", text: "Collectors track litres collected per household each month. Households say pickups are hard to schedule. ".repeat(3) };
  const web = (pages: (typeof oilio)[], data: unknown): MarketDeps => ({
    research: vi.fn(async () => ({ notes: "- notes", sources: pages.map((p) => ({ title: p.title, url: p.url })), steps: [] })),
    read: vi.fn(async (l) => pages.find((p) => p.url === l.url) ?? null),
    structured: vi.fn(async () => ({ data })) as MarketDeps["structured"],
  });
  async function until(look: "competitors" | "domain") {
    for (const end = Date.now() + 10_000; Date.now() < end; ) {
      const s = await marketSession(store);
      if (s[look] && s[look]!.state !== "looking") return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("still looking");
  }

  it("looks for the ones they name, keeps what they keep, and never proposes again one they took off", async () => {
    await lookForCompetitors(store, ["Oilio", "Zeit Co"], { deps: web([oilio], { competitors: [{ name: "Oilio", page: "w1", lines: [{ text: "Buys used oil from restaurants in Alexandria.", quote: "buys used cooking oil from restaurants across Alexandria", page: "w1" }] }] }) });
    const s = await until("competitors");
    expect(s.competitors!.found.map((c) => [c.name, c.lines.length])).toEqual([
      ["Oilio", 1],
      ["Zeit Co", 0],
    ]);
    const [o, z] = s.competitors!.found;
    await settleCompetitors(store, [o.id], ["GreenOil"]);
    const m = await store.getMarket();
    expect(m.competitors.map((c) => [c.name, c.by])).toEqual([
      ["Oilio", "you"],
      ["GreenOil", "you"],
    ]);
    expect(m.gone).toEqual(["zeit co"]);
    expect(z).toBeTruthy();
  });

  it("reads the domain into the market file once the company is kept, a person's lines left as they are", async () => {
    await store.changeMarket((m) => ({ ...m, aims: [{ id: "mine", text: "We watch litres per week.", by: "you", at: 1 }] }));
    await lookUpDomain(store, { deps: web([report], { aims: [{ text: "Collectors watch litres per household each month.", quote: "Collectors track litres collected per household each month", page: "w1" }], struggles: [{ text: "Pickups are hard to schedule.", quote: "Households say pickups are hard to schedule", page: "w1" }] }) });
    const s = await until("domain");
    expect(s.domain).toMatchObject({ state: "settled", aims: 1, struggles: 1 });
    const m = await store.getMarket();
    expect(m.aims.map((l) => [l.text, l.by])).toEqual([
      ["We watch litres per week.", "you"],
      ["Collectors watch litres per household each month.", "qalam"],
    ]);
    expect(m.struggles[0]).toMatchObject({ text: "Pickups are hard to schedule.", url: "https://report.example/uco" });
  });
});
