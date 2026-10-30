import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, CART, SLOT } from "@/seen/fixtures";
import type { SeenReading, SeenText } from "@/seen/types";
import { answerReading, editSeen, settleReading, startReading, type SeenDeps } from "./seen";
import { NotFoundError, OrgStore, type OrgEvent } from "./store";

let dir: string;
let store: OrgStore;
let events: OrgEvent[];
let calls: { kind: string; text: string }[];

const shot = async (name: string) => {
  const bytes = new TextEncoder().encode(`png ${name}`);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  await store.putAsset(hash, bytes, "image/png");
  return { ref: `asset:${hash}`, name, hash };
};

let words: Map<string, SeenText>;
let place: (n: number) => unknown;

const deps: SeenDeps = {
  words: async (shots) => new Map(shots.map((s) => [s.hash, words.get(s.hash) ?? null])),
  available: async () => true,
  prep: async (_hash, file) => ({ file, type: "image/png" }),
  ask: async (call) => {
    const text = call.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    calls.push({ kind: call.kind, text });
    if (call.kind === "seen-read")
      return {
        data: {
          screens: [
            { id: "s1", name: "Cart", kind: "list", does: "Lists the basket", on: "", can: [{ label: "Checkout", does: "goes on" }], nav: [], state: "", design: "" },
            { id: "s2", name: "Address", kind: "form", does: "Where it goes", on: "", can: [{ label: "Continue to payment", does: "" }, { label: "Change", does: "" }], nav: [], state: "", design: "" },
            { id: "s3", name: "Slot", kind: "detail", does: "When it comes", on: "", can: [{ label: "Next", does: "" }], nav: [], state: "", design: "" },
          ],
        },
        model: "test",
      };
    return { data: place(calls.filter((c) => c.kind === "seen-place").length), model: "test" };
  },
};

async function until(phases: SeenReading["phase"][]): Promise<SeenReading> {
  for (let k = 0; k < 200; k++) {
    const r = await store.getReading("grocery");
    if (r && phases.includes(r.phase)) return r;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error(`Never reached ${phases.join(" or ")}: ${JSON.stringify(await store.getReading("grocery"))}`);
}

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-seen-")), "Personal");
  store = await OrgStore.create(dir, { id: "org1", name: "Personal", createdAt: 1 });
  await store.putProduct({ id: "grocery", name: "Grocery app", audience: "", context: "", segments: [] });
  events = [];
  calls = [];
  store.events.on("event", (e: OrgEvent) => events.push(e));
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("a reading of screenshots", () => {
  it("reads them, places them, asks what the screenshots don't show, takes the answer, and settles into the map", async () => {
    const [cart, address, slot] = [await shot("01 cart.png"), await shot("02 address.png"), await shot("03 slot.png")];
    words = new Map([[cart.hash, CART], [address.hash, ADDRESS], [slot.hash, SLOT]]);
    const flow = { id: "new", name: "Checkout", aim: "to pay for the basket", goal: "none", steps: ["s1", "s2", "s3"], moves: [{ from: "s1", to: "s2", via: "Checkout", how: "tap" }], entry: "", notShown: [], note: "" };
    place = () => ({ same: [], states: [], flows: [flow], code: [], questions: [], ready: true });

    const started = await startReading(store, "grocery", [cart, address, slot].map(({ ref, name }) => ({ ref, name })), { deps });
    expect(started.phase).toBe("reading");
    // The address doesn't show which control goes to the slot: code asks, the address's own controls as the choices.
    const asking = await until(["asking", "failed"]);
    expect(asking.error).toBeUndefined();
    expect(asking.words).toBe(true);
    expect(Object.values(asking.notes).map((n) => n.name).sort()).toEqual(["Address", "Cart", "Slot"]);
    expect(asking.rounds[0].questions).toMatchObject([{ id: "q1", by: "code", ask: "On “Address”, what takes you to “Slot”?", options: ["Continue to payment", "Change"] }]);
    expect(asking.proposal!.flows[0]).toMatchObject({ key: "checkout", steps: ["cart", "address", "slot"] });
    expect(calls.map((c) => c.kind)).toEqual(["seen-read", "seen-place"]);
    expect(calls[0].text).toContain("Words on s1, as this Mac read them");

    await answerReading(store, "grocery", [{ question: "q1", ask: "", answer: "Continue to payment" }], { deps });
    const review = await until(["review", "failed"]);
    expect(calls[2].text).toContain("On “Address”, what takes you to “Slot”? → Continue to payment");
    expect(review.proposal!.flows[0].moves).toContainEqual({ from: "address", to: "slot", via: "Continue to payment", how: "tap" });

    const map = await settleReading(store, "grocery", { flows: { checkout: "accepted" }, steps: {} });
    expect(map!.flows.map((f) => f.key)).toEqual(["checkout"]);
    const md = await readFile(path.join(dir, "hub", "seen", "grocery.md"), "utf8");
    expect(md).toContain("# What people see in Grocery app today");
    expect(md).toContain("3. Slot, on “Continue to payment”");
    expect(md).toContain(`![Cart](../../assets/${cart.hash}.png)`);
    expect((await store.getReading("grocery"))!.phase).toBe("done");
    expect(events.some((e) => e.kind === "seen" && !e.reading)).toBe(true);
    // Its trace says what each call was sent and what code turned away.
    expect((await store.listTraces("seen")).length).toBe(3);
  });

  it("keeps a discarded flow out, and a person's edits and removals stand", async () => {
    const [cart, address] = [await shot("01 cart.png"), await shot("02 address.png")];
    words = new Map([[cart.hash, CART], [address.hash, ADDRESS]]);
    place = () => ({ same: [], states: [], flows: [{ id: "new", name: "Checkout", aim: "", goal: "none", steps: ["s1", "s2"], moves: [{ from: "s1", to: "s2", via: "Checkout", how: "tap" }], entry: "", notShown: [], note: "" }], code: [], questions: [], ready: true });
    await startReading(store, "grocery", [cart, address].map(({ ref, name }) => ({ ref, name })), { deps });
    await until(["review"]);
    const map = await settleReading(store, "grocery", { flows: { checkout: "discarded" }, steps: {} });
    // Every screen read is kept, flows or not.
    expect(map!.flows).toEqual([]);
    expect(map!.screens.map((s) => s.key)).toEqual(["cart", "address"]);

    const renamed = await editSeen(store, "grocery", { screen: "cart", name: "Basket", does: "" });
    expect(renamed!.screens[0]).toMatchObject({ name: "Basket", by: "you" });
    expect(renamed!.screens[0].does).toBeUndefined();
    const removed = await editSeen(store, "grocery", { removeScreen: "address" });
    expect(removed!.gone).toEqual([address.ref]);
    // Adding it again is the person's choice: it isn't gone any more.
    await startReading(store, "grocery", [{ ref: address.ref, name: "02 address.png" }], { deps });
    expect((await store.getSeen("grocery"))!.gone).toEqual([]);
    await until(["review", "asking", "failed"]);
  });

  it("refuses what isn't a product or a screenshot", async () => {
    await expect(startReading(store, "nope", [{ ref: `asset:${"0".repeat(24)}`, name: "x.png" }], { deps })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startReading(store, "grocery", [{ ref: `asset:${"0".repeat(24)}`, name: "x.png" }], { deps })).rejects.toThrow("None of these is a screenshot");
  });
});
