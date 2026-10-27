import { expect, it } from "vitest";
import { useKnowledge } from "@/knowledge/store";
import { entry, mergeManifest } from "@/knowledge/trace";
import type { OrgContext } from "@/org/pack";
import { recordCall } from "./knowledge";

it("records what a call was given, and keeps only the pieces it cites that it was sent", () => {
  useKnowledge.setState({ projectId: "b1", traces: [], loaded: true });
  const org = {
    context: { block: "", ids: ["k1", "k2"], quotes: ["k1"] },
    pieces: [],
    manifest: mergeManifest([entry("k1", "hub:quote:q1", "They swap it without asking"), entry("k2", "hub:decision:d1", "Dropped saved baskets. Why: nobody saved one")]),
  } as OrgContext;
  const relied = recordCall({
    title: "Placed the brain dump",
    org,
    raw: { reliedOn: [{ id: "k2", why: "The team dropped saved baskets [k2]" }, { id: "k9", why: "Not sent" }, { id: "k2", why: "Twice" }] },
    status: "proposed",
  });
  expect(relied).toEqual([{ ref: "hub:decision:d1", why: "The team dropped saved baskets", text: "Dropped saved baskets. Why: nobody saved one" }]);
  const [t] = useKnowledge.getState().traces;
  expect(t).toMatchObject({ kind: "discovery", title: "Placed the brain dump", status: "proposed", projectId: "b1", reliedOn: relied });
  expect(t.given.map(([ref]) => ref)).toEqual(["hub:quote:q1", "hub:decision:d1"]);
  // Without the organization's knowledge, a call still leaves its trace, given nothing.
  expect(recordCall({ title: "Mapped", org: null, raw: { reliedOn: [{ id: "k1", why: "x" }] } })).toEqual([]);
});
