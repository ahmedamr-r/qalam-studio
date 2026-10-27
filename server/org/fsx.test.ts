import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWrite, inside, locked, slugify, stableStringify, uniqueName } from "./fsx";

describe("stableStringify", () => {
  it("puts identity first, sorts the rest, drops undefined, ends with a newline", () => {
    const s = stableStringify({ z: 1, name: "B", id: "x", a: { d: 1, c: [{ y: 2, x: 1 }] }, gone: undefined, qalam: "project/1" });
    expect(s).toBe('{\n  "qalam": "project/1",\n  "id": "x",\n  "name": "B",\n  "a": {\n    "c": [\n      {\n        "x": 1,\n        "y": 2\n      }\n    ],\n    "d": 1\n  },\n  "z": 1\n}\n');
  });

  it("gives the same text whatever order the keys came in", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe("inside", () => {
  const root = path.resolve("/org");
  it("keeps paths inside the folder", () => {
    expect(inside(root, "boards/a.json")).toBe(path.join(root, "boards/a.json"));
    expect(inside(root, "../other/a.json")).toBeNull();
    expect(inside(root, "/etc/passwd")).toBeNull();
    expect(inside(root, "a\0b")).toBeNull();
  });
});

describe("files", () => {
  it("writes atomically, leaving no temp files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qalam-fsx-"));
    const file = path.join(dir, "nested", "a.json");
    await atomicWrite(file, "one");
    await atomicWrite(file, "two");
    expect(await readFile(file, "utf8")).toBe("two");
    expect(await readdir(path.dirname(file))).toEqual(["a.json"]);
  });

  it("runs writes to one path one at a time", async () => {
    const order: string[] = [];
    const slow = (tag: string, ms: number) => () => new Promise<void>((r) => setTimeout(() => (order.push(tag), r()), ms));
    await Promise.all([locked("k", slow("first", 20)), locked("k", slow("second", 1)), locked("other", slow("elsewhere", 5))]);
    expect(order).toEqual(["elsewhere", "first", "second"]);
  });

  it("keeps going after a failed write", async () => {
    await expect(locked("k2", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await locked("k2", async () => "ok")).toBe("ok");
  });
});

describe("names", () => {
  it("slugs titles", () => {
    expect(slugify("Reorder goals — Q2!")).toBe("reorder-goals-q2");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("تتبع الطلب")).toBe("untitled");
    expect(slugify("تتبع الطلب", "board")).toBe("board");
  });

  it("finds a free name", () => {
    const taken = new Set(["a.json", "a-2.json"]);
    expect(uniqueName("a", ".json", (n) => taken.has(n))).toBe("a-3.json");
    expect(uniqueName("b", ".json", (n) => taken.has(n))).toBe("b.json");
  });
});
