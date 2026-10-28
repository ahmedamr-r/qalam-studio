import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { OstCard } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { needsNow } from "./needs";
import { OrgStore } from "./store";

// Words and links only: no model process in tests.
process.env.QALAM_NO_MODELS = "1";

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

const DAY = 86_400_000;
let dir: string;
let store: OrgStore;
const now = Date.now();

const card = (over: Partial<OstCard> & Pick<OstCard, "kind" | "title" | "stage">): OstCard => ({ v: 1, createdBy: "user", evidence: [], ...over });
const ev = (piece: string) => ({ id: piece, kind: "quote" as const, text: piece, piece, addedBy: "ai" as const, at: now - 20 * DAY });
const quote = (id: string, text: string) => ({ id, text, span: [0, text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: now - 3 * DAY });
const src = (id: string, title: string, qs: ReturnType<typeof quote>[]): SourceRecord => ({ v: 1, id, projectId: "reorders", boards: [], product: "grocery", kind: "interview", title, text: qs.map((q) => q.text).join(" "), addedAt: now - 3 * DAY, read: [0], quotes: qs, needs: [] });

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-needs-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: now - 60 * DAY });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe.skipIf(!fts5)("what to work on next, in an organization's folder", () => {
  it("ranks the need pages by the customers behind them, and says which a board has", async () => {
    await store.putSource(src("sara", "Sara interview", [quote("sara-1", "I rebuild my basket every week."), quote("sara-2", "Fees surprise me at checkout.")]));
    await store.putSource(src("mona", "Mona interview", [quote("mona-1", "I copy last month's order by hand.")]));
    await store.fileTopics(
      {
        create: [
          { key: "n1", kind: "need", title: "Rebuilding my usual basket takes too long", products: ["grocery"] },
          { key: "n2", kind: "need", title: "Surprise fees put me off", products: ["grocery"] },
        ],
        add: [
          { topic: "new:n1", section: "know", text: "People rebuild their orders by hand.", cites: ["hub:quote:sara-1", "hub:quote:mona-1"], from: ["Sara interview", "Mona interview"], products: [] },
          { topic: "new:n2", section: "know", text: "Fees surprise people at checkout.", cites: ["hub:quote:sara-2"], from: ["Sara interview"], products: [] },
        ],
        revise: [],
        retire: [],
        dispute: [],
      },
      { from: "“Sara interview”" },
    );
    const board: Project = { id: "reorders", type: "discovery", name: "Weekly reorders", createdAt: now - 60 * DAY, updatedAt: now, product: "grocery" };
    await store.putProject(board);
    await store.putDoc(board.id, {
      roots: ["n1"],
      nodes: { n1: { id: "n1", type: "frame", name: "Rebuilding", parentId: null, children: [], x: 0, y: 0, w: 240, h: 80, meta: { ost: card({ kind: "opportunity", title: "Rebuilding takes too long", stage: "target", evidence: [ev("hub:quote:sara-1")] }) } } },
    } as unknown as Doc);

    const { indexed, needs } = await needsNow(store, now);
    expect(indexed).toBe(true);
    expect(needs.map((n) => [n.title, n.quotes, n.sources, n.boards.map((b) => b.board)])).toEqual([
      ["Rebuilding my usual basket takes too long", 2, 2, ["reorders"]],
      ["Surprise fees put me off", 1, 1, []],
    ]);
    expect(needs[0].weeks.at(-1)).toBe(2);
  });
});
