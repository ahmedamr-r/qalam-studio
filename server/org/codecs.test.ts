import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { Project } from "@/projects/model";
import { assetExt, assetType, decodeProject, decodeSource, docVersion, encodeProject, encodeSource, recordVersion } from "./codecs";

const board: Project = { id: "b1abcdefgh", type: "discovery", name: "Reorders", createdAt: 1, updatedAt: 2, openedAt: 3, thumbnail: "data:image/png;base64,AAA", summary: { frames: 0 } };

const doc = {
  roots: ["c1", "n1"],
  nodes: {
    c1: { id: "c1", type: "frame", name: "More reorders", x: 0, y: 0, w: 280, h: 120, meta: { ost: { kind: "outcome", title: "More reorders", evidence: [] } } },
    c2: { id: "c2", type: "frame", name: "Can't find past orders", x: 0, y: 200, w: 280, h: 120, parentId: "c1", meta: { ost: { kind: "opportunity", title: "Can't find past orders", evidence: [] }, note: true } },
    n1: { id: "n1", type: "frame", name: "sticky", x: 400, y: 0, w: 200, h: 200, meta: { note: { color: "yellow" } } },
    t1: { id: "t1", type: "text", name: "label", x: 0, y: 0, w: 10, h: 10 },
  },
  brief: { summary: "A grocery app." },
} as unknown as Doc;

describe("project files", () => {
  it("round-trips a board, cards lifted out and put back", () => {
    const { text, local } = encodeProject(board, doc);
    const file = JSON.parse(text);
    expect(file.qalam).toBe("project/1");
    expect(Object.keys(file.cards)).toEqual(["c1", "c2"]);
    expect(file.cards.c1.title).toBe("More reorders");
    expect(file.doc.nodes.c1.meta).toBeUndefined();
    expect(file.doc.nodes.c2.meta).toEqual({ note: true });
    expect(local).toEqual({ openedAt: 3, thumbnail: "data:image/png;base64,AAA", summary: { frames: 0 } });
    expect(file.thumbnail).toBeUndefined();
    const back = decodeProject(text)!;
    expect(back.doc).toEqual(doc);
    expect(back.record).toEqual({ id: "b1abcdefgh", type: "discovery", name: "Reorders", createdAt: 1, updatedAt: 2 });
  });

  it("keeps a card's title once, on the card: editing it there renames the card", () => {
    const file = JSON.parse(encodeProject(board, doc).text);
    expect(file.doc.nodes.c1.name).toBeUndefined();
    expect(file.doc.nodes.n1.name).toBe("sticky");
    file.cards.c1.title = "Weekly reorders";
    const back = decodeProject(JSON.stringify(file))!.doc!;
    expect(back.nodes.c1.name).toBe("Weekly reorders");
    expect((back.nodes.c1 as unknown as { meta: { ost: { title: string } } }).meta.ost.title).toBe("Weekly reorders");
  });

  it("keeps other projects' nodes as they are", () => {
    const screens: Project = { ...board, type: "screens" };
    const file = JSON.parse(encodeProject(screens, doc).text);
    expect(file.cards).toBeUndefined();
    expect(file.doc.nodes.c1.meta.ost.title).toBe("More reorders");
    expect(decodeProject(encodeProject(screens, doc).text)!.doc).toEqual(doc);
  });

  it("writes a project without a document yet", () => {
    const back = decodeProject(encodeProject(board, null).text)!;
    expect(back.doc).toBeNull();
  });

  it("refuses files that aren't projects", () => {
    expect(decodeProject("not json")).toBeNull();
    expect(decodeProject('{"id":"x"}')).toBeNull();
  });

  it("versions ignore local fields and key order", () => {
    expect(recordVersion(board)).toBe(recordVersion({ ...board, openedAt: 99, thumbnail: undefined }));
    expect(recordVersion(board)).not.toBe(recordVersion({ ...board, name: "Other" }));
    expect(docVersion(doc)).toBe(docVersion(JSON.parse(JSON.stringify(doc))));
    expect(docVersion(null)).toBe("none");
  });
});

const source: SourceRecord = {
  v: 1,
  id: "s1abcdefgh",
  projectId: "b1abcdefgh",
  kind: "interview",
  title: "Sara interview",
  origin: "sara.vtt",
  text: "Sara: I always reorder the same things.\nSara: Finding them takes ages.",
  addedAt: 5,
  read: [0],
  quotes: [{ id: "q1", text: "Finding them takes ages", span: [46, 69], kind: "need", addedBy: "ai", at: 6 } as SourceRecord["quotes"][number]],
  needs: [],
};

describe("source files", () => {
  it("round-trips: text verbatim in the Markdown body, the rest beside it", () => {
    const { md, data } = encodeSource(source);
    expect(md.startsWith('---\nid: "s1abcdefgh"\nkind: "interview"\ntitle: "Sara interview"\norigin: "sara.vtt"\nboard: "b1abcdefgh"\naddedAt: 5\ntextHash: ')).toBe(true);
    expect(md.endsWith(source.text)).toBe(true);
    expect(JSON.parse(data).quotes[0].id).toBe("q1");
    expect(decodeSource(md, data)).toEqual(source);
  });

  it("finds quotes again when the text was edited outside Qalam", () => {
    const { md, data } = encodeSource(source);
    const edited = md.replace("Sara: I always", "Sara (customer): I always");
    const back = decodeSource(edited, data)!;
    expect(back.text.slice(...back.quotes[0].span)).toBe("Finding them takes ages");
  });

  it("refuses broken files", () => {
    expect(decodeSource("no front matter", "{}")).toBeNull();
    expect(decodeSource(encodeSource(source).md, "nope")).toBeNull();
  });
});

describe("asset names", () => {
  it("maps types to extensions and back", () => {
    expect(assetExt("image/png")).toBe("png");
    expect(assetExt("image/jpeg; charset=binary")).toBe("jpg");
    expect(assetExt("application/x-unknown")).toBe("bin");
    expect(assetType("assets/ab12.webp")).toBe("image/webp");
    expect(assetType("assets/ab12.bin")).toBe("application/octet-stream");
  });
});
