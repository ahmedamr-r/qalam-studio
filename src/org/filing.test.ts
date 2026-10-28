import { afterEach, describe, expect, it, vi } from "vitest";
import { filingIds, filingSchema, topicsContent, TopicsBody, type TopicsRequest } from "@/ai/topics";
import type { SourceRecord } from "@/discovery/sources";
import type { Filing, TopicInfo } from "@/hub/topics";
import { useOrgContext } from "./context";
import { fileIntoTopics, materialName, unfiled } from "./filing";

const at = new Date(2026, 9, 12).getTime();
const source = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  v: 1,
  id: "sara",
  projectId: "b1",
  boards: ["b1"],
  product: "grocery",
  kind: "interview",
  title: "Sara interview",
  text: "",
  addedAt: at,
  read: [0],
  quotes: [
    { id: "sara-7", text: "I can't plan bath time around a four-hour window.", span: [0, 49], speaker: "Sara", kind: "pain", addedBy: "ai", at },
    { id: "sara-4", text: "They swap it without asking.", span: [50, 78], speaker: "Sara", kind: "pain", addedBy: "ai", at },
  ],
  needs: [{ id: "n1", title: "Delivery windows are too wide", quoteIds: ["sara-7"] }],
  ...over,
});

describe("the filing call", () => {
  const body: TopicsRequest = {
    product: "Grocery delivery for busy parents",
    topics: [
      { id: "t1", kind: "need", title: "Substitutions break my trust", lines: 1, made: true },
      { id: "t2", kind: "product", title: "Grocery", lines: 0, made: false },
    ],
    pages: [{ topic: "t1", lines: [{ id: "l1", section: "know", text: "Parents get swaps they didn't ask for.", by: "qalam", disputed: [] }] }],
    material: [{ id: "q1", text: "I can't plan bath time around a four-hour window.", source: "Sara interview", speaker: "Sara", kind: "pain", team: false }],
    needs: [{ title: "Delivery windows are too wide", quoteIds: ["q1"] }],
    context: { block: "[k1] A quote from Support tickets: Late or missed delivery: 131 tickets.", ids: ["k1"], quotes: ["k1"] },
  };

  it("is checked on the way in, and names only what it was sent", () => {
    expect(TopicsBody.safeParse(body).success).toBe(true);
    expect(TopicsBody.safeParse({ ...body, pages: [{ topic: "t9", lines: [] }] }).success).toBe(false);
    expect(TopicsBody.safeParse({ ...body, material: [] }).success).toBe(false);
    const ids = filingIds(body);
    expect(ids).toEqual({ topics: ["t1", "t2"], lines: ["l1"], own: ["l1"], cites: ["q1", "k1"] });
    const schema = filingSchema(ids) as { properties: Record<string, { items: { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> } }>; required: string[] };
    // Existing lines first, then what's new.
    expect(schema.required).toEqual(["dispute", "revise", "retire", "newTopics", "add"]);
    expect(schema.properties.add.items.properties.topic.enum).toEqual(["t1", "t2", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"]);
    expect(schema.properties.add.items.properties.cites.items?.enum).toEqual(["q1", "k1"]);
    const text = topicsContent(body);
    expect(text).toContain("- t2 · product · Grocery · no page yet");
    expect(text).toContain("- l1 · We know · qalam: Parents get swaps they didn't ask for.");
    expect(text).toContain("- q1 · pain · Sara interview · Sara: “I can't plan bath time around a four-hour window.”");
    expect(text).toContain("<organization>");
  });
});

describe("filing sources into the pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends what the pages haven't seen, keeps what code stands behind, and notes it all as seen", async () => {
    useOrgContext.setState({ about: { audience: "", context: "", segments: [] }, products: [{ id: "grocery", name: "Grocery", audience: "Parents", context: "", segments: ["Parents of young children"] }], loaded: true });
    const pages: TopicInfo[] = [];
    let sent: TopicsRequest | null = null;
    let filed: { filing: Filing; from: string; filed: Record<string, string[]> } | null = null;
    const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/orgs") return json({ current: "org1", orgs: [{ id: "org1", name: "Basket", dir: "/x" }] });
      if (url.endsWith("/topics") && !init?.method) return json(pages);
      // No search index here: the call goes without the organization's other knowledge.
      if (url.endsWith("/pack")) return new Response(JSON.stringify({ error: "index_unavailable" }), { status: 503 });
      if (url === "/api/topics") {
        sent = JSON.parse(String(init!.body));
        const answer = {
          newTopics: [{ id: "n1", kind: "need", title: "I can't plan my day around the delivery window", why: "new" }],
          add: [
            { topic: "n1", section: "know", text: "Parents plan bath time around deliveries, and a “four-hour window” breaks that.", cites: ["q1"] },
            { topic: "t1", section: "know", text: "Swaps happen without asking.", cites: ["q2"] },
            { topic: "n1", section: "know", text: "Customers said “windows are always wrong”.", cites: ["q1"] },
          ],
          revise: [],
          retire: [],
          dispute: [],
        };
        return new Response(`${JSON.stringify({ type: "result", data: answer })}\n`);
      }
      if (url.endsWith("/topics/file")) {
        filed = JSON.parse(String(init!.body));
        return json({ created: ["new1"], counts: { added: 2, revised: 0, retired: 0, disputed: 0 }, pages: [{ id: "new1", title: "I can't plan my day around the delivery window", kind: "need" }] });
      }
      throw new Error(`Unexpected ${url}`);
    });
    const s = source({ filed: ["sara-old"] });
    expect(unfiled([s]).map((x) => x.q.id)).toEqual(["sara-7", "sara-4"]);
    const totals = await fileIntoTopics([s]);
    expect(sent!.material.map((m) => m.id)).toEqual(["q1", "q2"]);
    expect(sent!.topics).toEqual([
      { id: "t1", kind: "product", title: "Grocery", lines: 0, made: false },
      { id: "t2", kind: "segment", title: "Parents of young children", lines: 0, made: false },
    ]);
    expect(sent!.needs).toEqual([{ title: "Delivery windows are too wide", quoteIds: ["q1"] }]);
    expect(sent!.context).toBeUndefined();
    // The unchecked quote is dropped; the line on "t1" lands on the product's page, started for it.
    expect(filed!.filing.add.map((a) => [a.topic, a.text])).toEqual([
      ["new:n1", "Parents plan bath time around deliveries, and a “four-hour window” breaks that."],
      ["new:t1", "Swaps happen without asking."],
    ]);
    expect(filed!.filing.create.map((c) => [c.key, c.kind, c.title, c.products])).toEqual([
      ["t1", "product", "Grocery", ["grocery"]],
      ["n1", "need", "I can't plan my day around the delivery window", ["grocery"]],
    ]);
    expect(filed!.filed).toEqual({ sara: ["sara-7", "sara-4"] });
    expect(filed!.from).toBe("“Sara interview”");
    expect(totals).toMatchObject({ calls: 1, created: 1, added: 2 });
  });

  it("names the material", () => {
    expect(materialName(["Sara interview"])).toBe("“Sara interview”");
    expect(materialName(["Sara interview", "Support tickets", "Sara interview"])).toBe("“Sara interview” and “Support tickets”");
    expect(materialName(["A", "B", "C", "D"])).toBe("“A” and 3 other sources");
  });
});
