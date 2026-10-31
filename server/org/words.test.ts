import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@/discovery/sources";
import { OrgStore } from "./store";

// The model and the web, as tests stand them in.
const structured = vi.fn();
const research = vi.fn();
vi.mock("@/ai/server", () => ({ structured: (...a: unknown[]) => structured(...a), research: (...a: unknown[]) => research(...a) }));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { draftSolutions } = await import("./solutions");
const { lookOnline } = await import("./posts");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-words-")), "Rides");
  store = await OrgStore.create(dir, { id: "org1", name: "Rides", createdAt: 1 });
  structured.mockReset();
  research.mockReset();
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

/** The person's answers about a card, as a source of their own words. */
const answers = (): SourceRecord => ({
  v: 1,
  id: "ans1",
  projectId: "",
  kind: "dump",
  title: "Your answers: Riders can't find the pickup",
  text: "What do you know about it?\nRiders call support from the airport",
  addedAt: 1,
  read: [],
  needs: [],
  quotes: [{ id: "ans1-know", text: "Riders call support from the airport", span: [27, 63], kind: "idea", role: "evidence", addedBy: "user", at: 1 }],
  answers: { v: 1, card: "n1", goal: null, topic: null, step: "draft-solutions", buckets: [], found: [], at: 1 },
});

describe("a draft resting on the person's answers", () => {
  it("hears them as the team's words, by the id the window sent, page or no page", async () => {
    await store.putSource(answers());
    structured.mockResolvedValue({ data: { drafts: [], note: "" } });
    await draftSolutions(store, { card: { title: "Riders can't find the pickup", evidence: [], children: [] }, answers: "ans1", found: ["hub:quote:nowhere"] });
    const text = structured.mock.calls[0][0].content[0].text as string;
    expect(text).toContain("· the team · Their answers · “Riders call support from the airport”");
    // Quotes found on their words are read from the index; with none here, the draft goes on without them.
    expect(text).not.toContain("nowhere");
  });

  it("never takes words from a source that isn't their answers", async () => {
    await store.putSource({ ...answers(), id: "notes", answers: undefined });
    structured.mockResolvedValue({ data: { drafts: [], note: "" } });
    await draftSolutions(store, { card: { title: "Riders can't find the pickup", evidence: [], children: [] }, answers: "notes" });
    expect(structured.mock.calls[0][0].content[0].text).not.toContain("Riders call support");
  });
});

describe("looking online on the person's words", () => {
  it("asks about the card's problem and what they said, and places nothing when its board isn't made yet", async () => {
    research.mockResolvedValue(null);
    const r = await lookOnline(store, { title: "Riders can't find the pickup", lines: ["What they know about it: the pin lands on the wrong terminal"], products: [] }, () => {}, new AbortController().signal, { scope: {} });
    const task = research.mock.calls[0][0].task as string;
    expect(task).toContain("The problem: “Riders can't find the pickup”");
    expect(task).toContain("- What they know about it: the pin lands on the wrong terminal");
    expect(r.error).toBeTruthy();
  });
});
