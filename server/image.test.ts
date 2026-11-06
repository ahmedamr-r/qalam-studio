import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShotLine } from "@/seen/shot";
import { NO_IMAGE_READER, readImage, sniffPicture, type ImageDeps } from "./image";
import { OrgStore } from "./org/store";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const HEIC = Uint8Array.from([0, 0, 0, 24, ...[..."ftypheic"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const line = (text: string, y: number): ShotLine => ({ text, box: [0.1, y, 0.6, 0.03], conf: 0.98 });
const PRINTED = [line("Basket", 0.05), line("Your order couldn't be placed", 0.2), line("Try again", 0.3)];

let dir: string;
let store: OrgStore;
let call: ReturnType<typeof vi.fn>;

function deps(lines: ShotLine[] | null, over: Partial<ImageDeps> = {}): ImageDeps {
  return {
    reader: async () => lines !== null,
    sees: () => true,
    words: async (_org, shots) => new Map(shots.map((s) => [s.hash, lines ? { w: 1170, h: 2532, dhash: "0000000000000000", lines } : null])),
    prep: async (_org, _hash, file) => ({ file, type: "image/png" }),
    call: call as unknown as ImageDeps["call"],
    ...over,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-image-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  store = await OrgStore.create(path.join(await mkdtemp(path.join(dir, "org-")), "Personal"), { id: "org1", name: "Personal", createdAt: 1 });
  call = vi.fn(async () => ({ data: { shows: "screen", about: "Basket's checkout, showing “Your order couldn't be placed”.", reading: ["It offers “Try again” and no reason."], product: "Basket", said: [] } }));
});

describe("readImage", () => {
  it("keeps the picture, its printed words as its text, and Qalam AI's reading beside them", async () => {
    const ing = await readImage(store, { bytes: PNG, type: "image/png", name: "IMG_0001.png" }, {}, deps(PRINTED));
    expect(ing.kind).toBe("image");
    expect(ing.text).toContain("Your order couldn't be placed");
    expect(ing.about).toBe("Basket's checkout, showing “Your order couldn't be placed”.");
    expect(ing.title).toBe("Basket's checkout, showing “Your order couldn't be placed”");
    expect(ing.image).toMatchObject({ type: "image/png", shows: "screen", product: "Basket", reading: ["It offers “Try again” and no reason."] });
    expect(store.getAsset(ing.image!.asset)).not.toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(call.mock.calls[0][0].content)).toContain("Try again");
  });

  it("reads the same picture again from what it kept, with no call", async () => {
    await readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(PRINTED));
    const again = await readImage(store, { bytes: PNG, type: "image/png", name: "b.png" }, {}, deps(PRINTED));
    expect(call).toHaveBeenCalledTimes(1);
    expect(again.title).toBe("b");
    expect(existsSync(path.join(store.dir, ".qalam", "images"))).toBe(true);
  });

  it("reads one the project keeps already, by its asset", async () => {
    const first = await readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(PRINTED));
    const held = await readImage(store, { asset: first.image!.asset, name: "Held.png" }, {}, deps(PRINTED));
    expect(held.title).toBe("Held");
    await expect(readImage(store, { asset: "0123456789abcdef01234567", name: "x" }, {}, deps(PRINTED))).rejects.toThrow(/isn't in the project/);
  });

  it("off a Mac, still understands it, and claims nothing as printed", async () => {
    const ing = await readImage(store, { bytes: PNG, type: "image/png", name: "photo.png" }, {}, deps(null));
    expect(ing.text).toBe("");
    expect(ing.about).toBe("Basket's checkout, showing Your order couldn't be placed.");
    expect(ing.image?.product).toBeUndefined();
    expect(ing.image?.unread).toEqual(["no-reader"]);
  });

  it("with an engine that can't see, keeps its printed words only", async () => {
    const ing = await readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(PRINTED, { sees: () => false }));
    expect(call).not.toHaveBeenCalled();
    expect(ing.text).toContain("Try again");
    expect(ing.about).toBeUndefined();
    expect(ing.image?.unread).toEqual(["no-vision"]);
  });

  it("says a failed look, and doesn't keep the reading, so it's tried again", async () => {
    call.mockRejectedValueOnce(new Error("overloaded"));
    const ing = await readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(PRINTED));
    expect(ing.image?.unread).toEqual(["failed"]);
    await readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(PRINTED));
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("turns away what it can't read at all, and what isn't a picture", async () => {
    await expect(readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps(null, { sees: () => false }))).rejects.toThrow(NO_IMAGE_READER);
    await expect(readImage(store, { bytes: new TextEncoder().encode("<svg/>"), type: "image/svg+xml", name: "a.svg" }, {}, deps(PRINTED))).rejects.toThrow(/isn't a picture Qalam reads/);
    call.mockResolvedValueOnce({ data: { shows: "photo", about: "", reading: [], product: "", said: [] } });
    await expect(readImage(store, { bytes: PNG, type: "image/png", name: "a.png" }, {}, deps([]))).rejects.toThrow(/Nothing in it/);
  });

  it("knows a picture by its bytes, HEIC by its brand", () => {
    expect(sniffPicture(PNG)).toBe("image/png");
    expect(sniffPicture(HEIC)).toBe("image/heic");
    expect(sniffPicture(new TextEncoder().encode("GIF89a......"))).toBe("image/gif");
    expect(sniffPicture(new TextEncoder().encode("<svg xmlns"))).toBeNull();
  });
});
