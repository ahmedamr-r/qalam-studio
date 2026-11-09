import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Situation } from "@/consult/situation";
import { consultNext } from "./consult";
import { OrgStore } from "./store";

let store: OrgStore;

beforeEach(async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-consult-")), "Personal");
  store = await OrgStore.create(dir, { id: "org1", name: "Personal", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(store.dir), { recursive: true, force: true });
});

/** Qalam AI's turn, as a stand-in: one question it says a screenshot would answer. */
const turn = {
  questions: [
    {
      id: "how-shown",
      title: "How do own items appear in the grocery module today?",
      why: "If they're hard to find, visibility is the first thing to check",
      after: [],
      allowOther: true,
      multi: false,
      options: [],
      recommended: [],
      example: "",
      explain: { plain: "", term: "" },
      from: "screens",
      look_for: "grocery home and category",
    },
  ],
  lookups: [],
  done: false,
  understood: [],
  open: [],
  terms: [],
  situation: {},
  business: [],
};

const who = (o: Partial<Situation>): Situation => ({ named: true, product: "", name: "Grocery own-brand orders", role: "works on a super app with a grocery module", level: "some", stage: "running", theirs: "yes", whose: "team", layer: "grow", ...o });

const asked = (situation: Situation, playbook: "grow" | "business" | "page" | "idea") =>
  consultNext(store, { said: "Fewer people order our own-brand items in the grocery module", outline: [], consult: { situation, playbook, level: "some" } }, () => {}, new AbortController().signal, { structured: async () => ({ data: turn }) as never });

describe("asking to see a screen in a conversation", () => {
  it("is kept on any playbook about something they run, not only a problem on a page", async () => {
    for (const playbook of ["grow", "business", "page"] as const) {
      const t = await asked(who({ layer: playbook }), playbook);
      expect(t.questions[0].tool, playbook).toEqual({ kind: "screens", lookFor: "grocery home and category" });
    }
  });

  it("is an ordinary question for an idea, which has no screens yet", async () => {
    expect((await asked(who({ stage: "idea", layer: "idea" }), "idea")).questions[0].tool).toBeUndefined();
    expect((await asked(who({ stage: "idea" }), "grow")).questions[0].tool).toBeUndefined();
  });
});
