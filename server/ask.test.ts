import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@/discovery/sources";
import type { Project } from "@/projects/model";
import { OrgStore } from "./org/store";

// One call with the organization's knowledge packed (the API-key path), its answer faked.
const answer = vi.hoisted(() => ({ value: null as unknown, sent: "" }));
vi.mock("@/ai/server", () => ({
  BACKEND: "api",
  structured: async (opts: { content: { text: string }[] }) => {
    answer.sent = opts.content[0].text;
    return { data: answer.value, model: "test-model" };
  },
}));
process.env.QALAM_NO_MODELS = "1";
const { askOrg } = await import("./ask");

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let store: OrgStore;
const at = Date.now();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "qalam-ask-"));
  store = await OrgStore.create(path.join(root, "Basket"), { id: "basket", name: "Basket", createdAt: at });
  const board: Project = { id: "delivery", type: "discovery", name: "Delivery experience", createdAt: at, updatedAt: at };
  await store.putProject(board);
  const text = "Sara: I can't plan bath time around a four-hour window.";
  const s: SourceRecord = { v: 1, id: "sara", projectId: "delivery", boards: ["delivery"], kind: "interview", title: "Sara interview", text, addedAt: at, read: [0], quotes: [{ id: "sara-7", text: "I can't plan bath time around a four-hour window.", span: [6, text.length], speaker: "Sara", kind: "pain", addedBy: "ai", at }], needs: [] };
  await store.putSource(s);
  await store.putAbout({ audience: "Parents in Dubai", goals: [], context: "Basket delivers groceries the same day.", segments: [] });
  await writeFile(path.join(root, "outside.txt"), "Basket delivers groceries the same day.");
});
afterEach(async () => {
  store.dispose();
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!fts5)("asking the organization with an API key", () => {
  it("packs what it knows, maps the ids it cites back to pieces, and checks every quote where it says", async () => {
    const steps: string[] = [];
    // The quote's id in the pack is k-something: answer with whichever id the pack gave it.
    answer.value = null;
    const run = () => askOrg(store, { question: "Why do parents struggle with delivery windows?" }, { emit: (l) => steps.push(l), signal: new AbortController().signal });
    await run();
    const k = /\[(k\d+)\][^\n]*Sara/.exec(answer.sent)?.[1];
    expect(k).toBeTruthy();
    expect(answer.sent).toContain("Sources (file · title · kind · quotes picked out):");
    answer.value = {
      answer: "Parents plan their day around the delivery, and a four-hour window breaks that.",
      claims: [
        { text: "A four-hour window breaks a parent's routine.", support: [{ source: k, quote: "I can't plan bath time around a four-hour window" }] },
        { text: "Basket delivers the same day.", support: [{ source: "about.md", quote: "Basket delivers groceries the same day" }] },
        { text: "Outside the folder.", support: [{ source: "../outside.txt", quote: "Basket delivers groceries the same day" }] },
        { text: "The index.", support: [{ source: ".qalam/local/state.json", quote: "projects" }] },
        { text: "Elsewhere on the computer.", support: [{ source: "/etc/hosts", quote: "localhost" }] },
      ],
      unknowns: [],
    };
    const a = await run();
    expect(a.how).toBe("packed");
    expect(a.answer).toBe("Parents plan their day around the delivery, and a four-hour window breaks that.");
    expect(a.claims.map((c) => c.backed)).toEqual([true, true, false, false, false]);
    expect(a.claims[0].support).toEqual([{ source: "hub:quote:sara-7", words: "I can't plan bath time around a four-hour window", label: "Sara · Sara interview", href: "/o/basket/d/delivery?source=sara" }]);
    expect(a.claims[1].support[0]).toMatchObject({ source: "about.md", label: "About Basket" });
    expect(steps).toEqual(["Reading the organization's guide", "Checking every quote", "Reading the organization's guide", "Checking every quote"]);
  });
});
