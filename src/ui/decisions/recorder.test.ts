import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "@/doc/schema";
import { useStudio } from "@/doc/store";
import type { OstCard } from "@/discovery/types";
import type { Proposal } from "@/discovery/proposals";
import type { Decision } from "@/decisions/model";
import { memoryRepo } from "@/projects/db";
import { newProject } from "@/projects/model";
import { openProject } from "@/projects/session";

const sent: { path: string; method?: string; json?: unknown }[] = [];
vi.mock("@/org/client", async (orig) => ({
  ...(await orig<typeof import("@/org/client")>()),
  orgFetch: vi.fn(async (path: string, init: { method?: string; json?: unknown } = {}) => {
    sent.push({ path, method: init.method, json: init.json });
    return new Response("{}");
  }),
}));

const { recordAccepted, startRecorder, useWhy } = await import("./recorder");

const card = (kind: OstCard["kind"], title: string, stage: OstCard["stage"]): OstCard => ({ v: 1, kind, title, stage, createdBy: "user", evidence: [] });
const frame = (id: string, parentId: string | null, children: string[], ost: OstCard) => ({ id, type: "frame", name: ost.title, parentId, children, x: 0, y: 0, w: 240, h: 80, meta: { ost } });
const board = (): Doc =>
  ({
    roots: ["o1"],
    nodes: {
      o1: frame("o1", null, ["n1"], card("outcome", "More reorders", "active")),
      n1: frame("n1", "o1", ["s1", "s2"], card("opportunity", "Can't find past orders", "target")),
      s1: frame("s1", "n1", [], card("solution", "Order again shelf", "idea")),
      s2: frame("s2", "n1", [], card("solution", "Saved baskets", "idea")),
    },
  }) as unknown as Doc;

const ost = (d: Doc, id: string) => (d.nodes[id]?.meta as unknown as { ost: OstCard } | undefined)?.ost;
const posted = () => sent.filter((s) => s.method === "POST").flatMap((s) => (s.json as { decisions: Decision[] }).decisions);
const patched = () => sent.filter((s) => s.method === "PATCH").map((s) => [s.path, s.json]);
const settle = () => vi.advanceTimersByTimeAsync(1600);

let stop: () => void;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  sent.length = 0;
  const repo = memoryRepo();
  const p = newProject("discovery", "Reorders");
  await repo.put(p);
  await repo.putDoc(p.id, board());
  await openProject(p.id, repo);
  stop = startRecorder();
});
afterEach(() => {
  stop();
  useWhy.setState({ ask: null });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the decision recorder on a board", () => {
  it("records a dropped solution once changes settle, asks why, and stamps when", async () => {
    useStudio.getState().mutate((d) => void (ost(d, "s2")!.stage = "dropped"));
    expect(sent).toEqual([]);
    await settle();
    expect(posted()).toMatchObject([{ kind: "stage", card: "s2", what: "Dropped the solution “Saved baskets”", big: true, by: "you", boardName: "Reorders" }]);
    expect(useWhy.getState().ask?.id).toBe(posted()[0].id);
    expect(ost(useStudio.getState().doc, "s2")?.stageAt).toBeGreaterThan(0);
  });

  it("marks a decision undone on ⌘Z and un-marks it on redo, recording nothing new", async () => {
    useStudio.getState().mutate((d) => void (ost(d, "s2")!.stage = "dropped"));
    await settle();
    const [dropped] = posted();
    useStudio.getState().undo();
    await settle();
    expect(useWhy.getState().ask).toBeNull();
    useStudio.getState().redo();
    await settle();
    expect(posted()).toHaveLength(1);
    expect(patched()).toEqual([
      [`/decisions/${dropped.id}`, { undone: true }],
      [`/decisions/${dropped.id}`, { undone: false }],
    ]);
  });

  it("marks a deletion undone when the card comes back", async () => {
    useStudio.getState().mutate((d) => {
      delete d.nodes.s1;
      d.nodes.n1.children = ["s2"];
    });
    await settle();
    const [deleted] = posted();
    expect(deleted).toMatchObject({ kind: "drop", card: "s1" });
    useStudio.getState().undo();
    await settle();
    expect(patched()).toEqual([[`/decisions/${deleted.id}`, { undone: true }]]);
  });

  it("records nothing when a change is taken back before it settles", async () => {
    useStudio.getState().mutate((d) => void (ost(d, "s2")!.stage = "dropped"));
    useStudio.getState().undo();
    await settle();
    expect(sent).toEqual([]);
  });

  it("records what accepted proposals decided as Qalam AI's, with its reason, and the accept itself", async () => {
    const merge = { id: "p1", kind: "merge", cardId: "s1", dropId: "s2", why: "Both are about finding what you ordered before" } as Proposal;
    recordAccepted([merge], "Sara interview", () => {
      useStudio.getState().mutate((d) => {
        delete d.nodes.s2;
        d.nodes.n1.children = ["s1"];
      });
      return "1 change made";
    });
    await vi.advanceTimersByTimeAsync(0);
    const [drop, accept] = posted();
    expect(drop).toMatchObject({ card: "s2", by: "qalam", why: "Both are about finding what you ordered before" });
    expect(accept).toMatchObject({ kind: "accept", by: "you", card: null, what: "Accepted Qalam AI's proposals from Sara interview: 1 change made", detail: { cards: ["s1", "s2"], proposals: [{ line: "Merge “Saved baskets” into “Order again shelf”" }] } });
    expect(useWhy.getState().ask).toBeNull();
  });
});
