import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { OstCard } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { noticesNow } from "./notices";
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
function doc(cards: Record<string, { parent: string | null; card: OstCard }>): Doc {
  const nodes: Record<string, unknown> = {};
  for (const [id, { parent, card: c }] of Object.entries(cards))
    nodes[id] = { id, type: "frame", name: c.title, parentId: parent, children: Object.entries(cards).filter(([, x]) => x.parent === id).map(([k]) => k), x: 0, y: 0, w: 240, h: 80, meta: { ost: c } };
  return { roots: Object.keys(cards).filter((k) => !cards[k].parent), nodes } as unknown as Doc;
}
const ev = (piece: string) => ({ id: piece, kind: "quote" as const, text: piece, piece, addedBy: "ai" as const, at: now - 20 * DAY });

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-notices-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: now - 60 * DAY });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe.skipIf(!fts5)("what needs a look, in an organization's folder", () => {
  it("runs the checks over the boards and pages, and leaves out what was dismissed", async () => {
    const a: Project = { id: "reorders", type: "discovery", name: "Weekly reorders", createdAt: now - 60 * DAY, updatedAt: now, product: "grocery" };
    const b: Project = { id: "pantry", type: "discovery", name: "Office pantry", createdAt: now - 60 * DAY, updatedAt: now, product: "business" };
    await store.putProject(a);
    await store.putProject(b);
    await store.putDoc(
      a.id,
      doc({
        o1: { parent: null, card: card({ kind: "outcome", title: "More reorders", stage: "active" }) },
        n1: { parent: "o1", card: card({ kind: "opportunity", title: "Rebuilding my basket takes too long", stage: "target", evidence: [ev("hub:quote:sara-1"), ev("hub:quote:sara-2")] }) },
        s1: { parent: "n1", card: card({ kind: "solution", title: "Order again shelf", stage: "testing" }) },
        t1: { parent: "s1", card: card({ kind: "test", title: "Prototype test", stage: "running", stageAt: now - 20 * DAY }) },
      }),
    );
    await store.putDoc(
      b.id,
      doc({
        o2: { parent: null, card: card({ kind: "outcome", title: "Offices reorder", stage: "active" }) },
        n8: { parent: "o2", card: card({ kind: "opportunity", title: "Copying old orders by hand", stage: "exploring", evidence: [ev("hub:quote:mona-2"), ev("hub:quote:mona-3")] }) },
      }),
    );
    const quote = (id: string, text: string) => ({ id, text, span: [0, text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: now - 30 * DAY });
    const src = (id: string, title: string, qs: ReturnType<typeof quote>[], board: string, product: string): SourceRecord => ({ v: 1, id, projectId: board, boards: [board], product, kind: "interview", title, text: qs.map((q) => q.text).join(" "), addedAt: now - 30 * DAY, read: [0], quotes: qs, needs: [] });
    await store.putSource(src("sara", "Sara interview", [quote("sara-1", "I rebuild my basket every week."), quote("sara-2", "It's the same thirty things.")], a.id, "grocery"));
    await store.putSource(src("mona", "Mona interview", [quote("mona-2", "I copy last month's order by hand."), quote("mona-3", "I wish it remembered.")], b.id, "business"));
    await store.fileTopics(
      {
        create: [{ key: "n1", kind: "need", title: "Rebuilding my usual basket takes too long", products: ["grocery", "business"] }],
        add: [{ topic: "new:n1", section: "know", text: "Parents and offices rebuild their orders by hand.", cites: ["hub:quote:sara-1", "hub:quote:sara-2", "hub:quote:mona-2", "hub:quote:mona-3"], from: ["Sara interview", "Mona interview"], products: [] }],
        revise: [],
        retire: [],
        dispute: [],
      },
      { from: "“Sara interview”" },
    );
    const first = await noticesNow(store, now);
    expect(first.notices.map((n) => n.kind)).toEqual(["same-need", "stale-test", "thin-target"]);
    const pair = first.notices[0];
    expect([`${pair.board}:${pair.card}`, `${pair.other?.board}:${pair.other?.card}`].sort()).toEqual(["pantry:n8", "reorders:n1"]);
    // The target rests on one interview: one voice, as the organization counts them.
    expect(first.notices[2]).toMatchObject({ board: "reorders", card: "n1", why: "Thin: 1 voice (1 source) · newest 4 weeks ago. Hear it from more people (three or more, in two sources) before betting on it." });

    await store.dismissNotice(first.notices[1].key, true);
    await store.dismissNotice(first.notices[2].key, true);
    await store.linkCards("hub:card:reorders:n1", "hub:card:pantry:n8", true);
    const after = await noticesNow(store, now);
    expect(after.notices).toEqual([]);
    expect(after.dismissed).toBe(2);
  });
});
