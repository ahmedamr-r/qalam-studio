import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADDRESS, CART, CART_COUPON, PAY } from "@/seen/fixtures";
import type { SeenText } from "@/seen/types";
import type { ImageDeps } from "../image";
import { keepShots, reviewShots, type ReviewDeps } from "./screens";
import type { SeenDeps } from "./seen";
import { OrgStore } from "./store";

vi.mock("../capture", async (load) => ({ ...(await load<typeof import("../capture")>()), captureSource: vi.fn(async () => ({ sourceId: "picture-1", title: "A chart", quotes: 0, needs: 0, points: {}, placed: [] })) }));

let store: OrgStore;
let words: Map<string, SeenText>;
let shows: Map<string, { shows: string; about: string }>;

const shot = async (name: string, text: SeenText) => {
  const bytes = new TextEncoder().encode(`png ${name}`);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  await store.putAsset(hash, bytes, "image/png");
  words.set(hash, text);
  return { asset: `asset:${hash}`, title: name, hash };
};

const seen: SeenDeps = {
  words: async (shots) => new Map(shots.map((s) => [s.hash, words.get(s.hash) ?? null])),
  available: async () => true,
  prep: async (_hash, file) => ({ file, type: "image/png" }),
  ask: async () => {
    throw new Error("No reading rounds for a screenshot shown in answer to a question.");
  },
};

const image = (o: { reader?: boolean; sees?: boolean } = {}): ImageDeps => ({
  reader: async () => o.reader ?? true,
  sees: () => o.sees ?? true,
  words: async (_dir, shots) => new Map(shots.map((s) => [s.hash, words.get(s.hash) ?? null])),
  prep: async (_dir, _hash, file) => ({ file, type: "image/png" }),
  call: async (opts) => {
    const text = JSON.stringify(opts.content);
    const hit = [...shows.entries()].find(([w]) => text.includes(w));
    return { data: { shows: hit?.[1].shows ?? "screen", about: hit?.[1].about ?? "", reading: [], product: "", said: [] } };
  },
});

beforeEach(async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-screens-")), "Personal");
  store = await OrgStore.create(dir, { id: "org1", name: "Personal", createdAt: 1 });
  await store.putProduct({ id: "grocery", name: "Grocery app", audience: "", context: "", segments: [] });
  words = new Map();
  shows = new Map([
    ["Your basket", { shows: "screen", about: "The basket with its items and total" }],
    ["Delivery address", { shows: "screen", about: "Where the order goes" }],
    ["Payment", { shows: "screen", about: "Paying for the order" }],
  ]);
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(store.dir), { recursive: true, force: true });
});

describe("keeping the screenshots an answer gave", () => {
  it("keeps them as the product's screens, one flow in the order given, each a source nothing is read from", async () => {
    const [cart, address, pay] = [await shot("IMG_3.png", CART), await shot("IMG_1.png", ADDRESS), await shot("IMG_2.png", PAY)];
    const kept = await keepShots(store, { shots: [cart, address, pay], product: "grocery", about: "the basket", deps: { image: image(), seen } });

    expect(kept.map).toBe("grocery");
    expect(kept.flow?.name).toBe("The basket");
    expect(kept.shots.map((s) => s.screen?.name)).toEqual(["The basket with its items and total", "Where the order goes", "Paying for the order"]);
    expect(kept.shots[0].printed).toContain("Total 24.50");

    // In the order they were shown, not by their files' names.
    const map = (await store.getSeen("grocery"))!;
    const flow = map.flows.find((f) => f.key === kept.flow?.key)!;
    expect(flow.steps).toEqual(kept.shots.map((s) => s.screen!.key));

    // Their sources: the product's screens, with no quotes taken from what's printed on them.
    for (const s of kept.shots) {
      const src = (await store.getSource(s.source))!;
      expect(src.screen).toEqual({ map: "grocery", key: s.screen!.key });
      expect(src.quotes).toEqual([]);
      expect(src.product).toBe("grocery");
    }
  });

  it("keeps one source a screenshot when it's shown again, and the flow of that name takes the new order", async () => {
    const [cart, address, pay] = [await shot("cart.png", CART), await shot("address.png", ADDRESS), await shot("pay.png", PAY)];
    const first = await keepShots(store, { shots: [cart, address, pay], product: "grocery", about: "checkout", deps: { image: image(), seen } });
    const again = await keepShots(store, { shots: [cart, pay], product: "grocery", about: "Checkout", deps: { image: image(), seen } });

    expect(again.shots.map((s) => s.source)).toEqual([first.shots[0].source, first.shots[2].source]);
    expect((await store.listSources()).filter((s) => s.screen)).toHaveLength(3);
    const map = (await store.getSeen("grocery"))!;
    expect(map.flows.filter((f) => f.name.toLowerCase() === "checkout")).toHaveLength(1);
    expect(map.flows[0].steps).toEqual([first.shots[0].screen!.key, first.shots[2].screen!.key]);
  });

  it("takes two screenshots of one screen as that screen in two states", async () => {
    const [cart, coupon] = [await shot("cart.png", CART), await shot("cart coupon.png", CART_COUPON)];
    const kept = await keepShots(store, { shots: [cart, coupon], product: "grocery", about: "the basket", deps: { image: image(), seen } });

    expect(kept.shots[0].screen?.key).toBe(kept.shots[1].screen?.key);
    const map = (await store.getSeen("grocery"))!;
    expect(map.screens).toHaveLength(1);
    expect(map.screens[0].shots).toHaveLength(2);
    // One screen is no flow.
    expect(kept.flow).toBeUndefined();
    // Shown again on its own, the other state stays part of its screen: no second copy.
    const again = await keepShots(store, { shots: [coupon], product: "grocery", about: "the basket", deps: { image: image(), seen } });
    expect(again.shots[0].screen?.key).toBe(kept.shots[0].screen?.key);
    expect((await store.getSeen("grocery"))!.screens).toHaveLength(1);
  });

  it("keeps two sparse screens apart when only their pictures look alike, not their words", async () => {
    // White, a line or two, a button at the foot: their picture hashes match, their words don't.
    const sparse = (words: string[]): SeenText => ({ w: 780, h: 1688, dhash: "ffffffffffff0000", lines: words.map((text, i) => ({ text, box: [0.1, 0.05 + i * 0.1, 0.6, 0.03], conf: 0.95 })) });
    const [basket, pay] = [await shot("basket.png", sparse(["Your basket", "Subtotal 26.50", "Checkout"])), await shot("payment.png", sparse(["Payment", "Card ending 4242", "Pay 44.50"]))];
    const kept = await keepShots(store, { shots: [basket, pay], product: "grocery", about: "the basket", deps: { image: image(), seen } });

    expect(kept.shots[0].screen?.key).not.toBe(kept.shots[1].screen?.key);
    expect((await store.getSeen("grocery"))!.screens).toHaveLength(2);
  });

  it("takes a picture that isn't a screen in as any picture, and keeps the rest as screens", async () => {
    shows.set("Delivery address", { shows: "chart", about: "A chart of orders by week" });
    const [cart, chart] = [await shot("cart.png", CART), await shot("chart.png", ADDRESS)];
    const kept = await keepShots(store, { shots: [cart, chart], product: "grocery", about: "the basket", deps: { image: image(), seen } });

    expect(kept.shots[0].screen).toBeDefined();
    expect(kept.shots[1]).toMatchObject({ source: "picture-1", shows: "chart" });
    expect(kept.shots[1].screen).toBeUndefined();
    expect((await store.getSeen("grocery"))!.screens).toHaveLength(1);
  });

  it("still keeps a screenshot nothing here can read, by its name, saying so", async () => {
    const cart = await shot("Basket.png", CART);
    const kept = await keepShots(store, { shots: [cart], product: "grocery", about: "the basket", deps: { image: image({ reader: false, sees: false }), seen } });

    expect(kept.shots[0]).toMatchObject({ unread: true, printed: "", screen: { name: "Basket" } });
  });

  it("brings back a screenshot taken out of the map before: showing it again is their choice", async () => {
    const cart = await shot("cart.png", CART);
    await store.changeSeen("grocery", () => ({ key: "grocery", product: "grocery", readAt: 1, screens: [], flows: [], gone: [cart.asset] }));
    await keepShots(store, { shots: [cart], product: "grocery", about: "the basket", deps: { image: image(), seen } });

    const map = (await store.getSeen("grocery"))!;
    expect(map.gone).not.toContain(cart.asset);
    expect(map.screens).toHaveLength(1);
  });

  it("keeps the organization's own when the space has no product, and refuses one that isn't there", async () => {
    const cart = await shot("cart.png", CART);
    expect((await keepShots(store, { shots: [cart], product: null, about: "the basket", deps: { image: image(), seen } })).map).toBe("org");
    await expect(keepShots(store, { shots: [cart], product: "gone", about: "x", deps: { image: image(), seen } })).rejects.toThrow("No such product");
  });
});

describe("looking at the screens for the problem", () => {
  const focus = { said: "People add items but leave before they pay", asked: "What does the basket look like?", typed: "After they add items", settled: [] };
  const look = (answer: unknown, o: { sees?: boolean } = {}) => {
    const calls: { content: unknown; system: unknown }[] = [];
    const deps: Partial<ReviewDeps> = {
      sees: () => o.sees ?? true,
      reader: async () => true,
      words: async (_dir, shots) => new Map(shots.map((s) => [s.hash, words.get(s.hash) ?? null])),
      prep: async (_dir, _hash, file) => ({ file, type: "image/png" }),
      call: async (opts) => {
        calls.push({ content: opts.content, system: opts.system });
        return { data: answer, model: "test" };
      },
    };
    return { deps, calls };
  };

  it("looks at the screens they showed for what they're working out, and keeps what code holds of it", async () => {
    const [cart, pay] = [await shot("cart.png", CART), await shot("pay.png", PAY)];
    const kept = await keepShots(store, { shots: [cart, pay], product: "grocery", about: "the basket", deps: { image: image(), seen } });
    const { deps, calls } = look({
      findings: [
        { screen: "s1", side: "customer", title: "The coupon link pulls people away from paying", why: "People leave to look for a code", on: "Apply coupon", cites: [], change: { does: "remove", what: "Take the coupon link off the basket", instead_of: "Apply coupon" } },
        { screen: "s2", side: "business", title: "Nothing on the payment screen", why: "It rests on nothing they said", on: "", cites: [], change: { does: "none", what: "", instead_of: "" } },
      ],
      none: false,
    });
    const review = (await reviewShots(store, { kept, focus, product: "grocery", answers: [{ q: "Since when?", a: "March" }], deps }))!;

    // One call: what they're working out first, then each screen's picture and its printed words, the skill as its own block.
    const text = JSON.stringify(calls[0].content);
    expect(text.indexOf("People add items but leave before they pay")).toBeLessThan(text.indexOf("Apply coupon"));
    expect((calls[0].content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(2);
    expect(calls[0].system).toHaveLength(2);

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).toMatchObject({ side: "customer", on: { words: "Apply coupon" }, change: { does: "remove", insteadOf: "Apply coupon" }, screen: kept.shots[0].screen!.key });
    expect(review.left).toEqual([{ what: "Nothing on the payment screen", why: "A finding from the business's side has to rest on how their business works, a goal or what they said" }]);
    expect(review.shots.map((s) => s.source)).toEqual(kept.shots.map((s) => s.source));
    // Kept with the screens, for the team.
    expect(await store.getScreenReview(review.id)).toEqual(review);
    expect((await store.listScreenReviews()).map((r) => r.id)).toEqual([review.id]);
  });

  it("doesn't ask an engine that can't see pictures, and says so; nothing given as a screen, no look", async () => {
    const cart = await shot("cart.png", CART);
    const kept = await keepShots(store, { shots: [cart], product: "grocery", about: "the basket", deps: { image: image(), seen } });
    const { deps, calls } = look({ findings: [], none: true }, { sees: false });
    const review = await reviewShots(store, { kept, focus, product: "grocery", deps });
    expect(calls).toHaveLength(0);
    expect(review).toMatchObject({ unseen: true, findings: [] });
    expect(await reviewShots(store, { kept: { map: "grocery", shots: [{ ...kept.shots[0], screen: undefined }] }, focus, product: "grocery", deps })).toBeNull();
  });
});
