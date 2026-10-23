import { describe, expect, it, vi } from "vitest";
import type { Doc, Prototype } from "@/doc/schema";
import { useStudio } from "@/doc/store";
import { registerProtoPass } from "@/doc/proto-pass";
import { memoryRepo } from "./db";
import { newProject } from "./model";
import { flushDoc, openProject, startDocPersistence } from "./session";

const frame = (id: string) => ({ id, type: "frame", name: id, x: 0, y: 0, w: 390, h: 844, children: [], meta: {} });
const docOf = (roots: string[]) => ({ nodes: Object.fromEntries(roots.map((id) => [id, frame(id)])), roots }) as unknown as Doc;

describe("a project's prototype", () => {
  it("autosaves with the document and opens again", async () => {
    registerProtoPass();
    // The save listens for the tab hiding: a stand-in document and window are enough here.
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" });
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    try {
      const repo = memoryRepo();
      const p = newProject("screens", "Flow");
      await repo.put(p);
      await repo.putDoc(p.id, docOf(["a", "b"]));
      await openProject(p.id, repo);
      const stop = startDocPersistence();
      const proto: Prototype = {
        start: "a",
        links: [{ from: { screen: "a", path: "body.1" }, on: "tap", to: { screen: "b" }, transition: { kind: "smart", motion: "native" } }],
        states: { a: { delivered: { "body.1.props.current": 3 } } },
        tracks: [{ target: { screen: "b", path: "body.*" }, preset: "fade-up", stagger: 70, motion: "medium.emphasized" }],
      };
      useStudio.getState().mutate((d) => {
        d.proto = proto;
      });
      await flushDoc();
      stop();
      expect(repo.docs.get(p.id)?.proto).toEqual(proto);
      useStudio.getState().openDoc({ nodes: {}, roots: [] });
      await openProject(p.id, repo);
      expect(useStudio.getState().doc.proto).toEqual(proto);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
