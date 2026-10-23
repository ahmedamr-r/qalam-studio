import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { appendAnswer } from "./brief";
import { makeFrame } from "./factory";
import { emptyDoc, type Doc } from "./schema";
import { isBusy, release, reserve, useReservations } from "./reservations";

const answer = { id: "a1", topic: "goal" as const, question: "What is it for?", answer: "Tracking an order", screenIds: [], at: 1 };

function addFrame() {
  const f = makeFrame({ name: "Screen" });
  studio().mutate((d) => {
    d.nodes[f.id] = f;
    d.roots.push(f.id);
  });
  return f.id;
}

function writeBrief() {
  const next = appendAnswer(studio().doc.brief, answer);
  studio().mutate((d) => {
    d.brief = next;
  }, { history: false });
}

describe("knowledge hub outside undo history", () => {
  beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

  it("keeps the brief through undo and redo of canvas edits", () => {
    const id = addFrame();
    writeBrief();
    studio().undo();
    expect(studio().doc.nodes[id]).toBeUndefined();
    expect(studio().doc.brief?.answers).toHaveLength(1);
    studio().redo();
    expect(studio().doc.nodes[id]).toBeDefined();
    expect(studio().doc.brief?.answers).toHaveLength(1);
  });

  it("keeps what the designer told Qalam AI to forget or pin through undo and redo", () => {
    const id = addFrame();
    studio().mutate((d) => {
      d.knowledge = { v: 1, forgotten: { "brief:summary": 1 }, pinned: {} };
    }, { history: false });
    studio().undo();
    expect(studio().doc.nodes[id]).toBeUndefined();
    expect(studio().doc.knowledge?.forgotten["brief:summary"]).toBe(1);
    studio().redo();
    expect(studio().doc.knowledge?.forgotten["brief:summary"]).toBe(1);
  });

  it("keeps the brief when a transaction is cancelled or the canvas is cleared", () => {
    studio().beginTx();
    addFrame();
    writeBrief();
    studio().cancelTx();
    expect(studio().doc.roots).toHaveLength(0);
    expect(studio().doc.brief?.answers).toHaveLength(1);
    addFrame();
    studio().replaceDoc(emptyDoc());
    expect(studio().doc.roots).toHaveLength(0);
    expect(studio().doc.brief?.answers).toHaveLength(1);
  });

  it("opens a file with its own brief and a fresh history", () => {
    addFrame();
    writeBrief();
    const file: Doc = { nodes: {}, roots: [], brief: { summary: "From the file", answers: [], screens: {}, updatedAt: 9 } };
    studio().openDoc(JSON.parse(JSON.stringify(file)));
    expect(studio().doc.brief?.summary).toBe("From the file");
    expect(studio().past).toHaveLength(0);
    expect(studio().future).toHaveLength(0);
  });
});

describe("layers AI is working on in place", () => {
  beforeEach(() => {
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [], hoverId: null, editingTextId: null });
    useReservations.setState({ list: [] });
  });

  function screenWithChild() {
    const screen = makeFrame({ name: "Screen" });
    const child = makeFrame({ name: "Card" });
    child.parentId = screen.id;
    screen.children.push(child.id);
    studio().mutate((d) => {
      d.nodes[screen.id] = screen;
      d.nodes[child.id] = child;
      d.roots.push(screen.id);
    });
    return { screen: screen.id, child: child.id };
  }

  it("lets go of them when the work starts and can't select them until it ends", () => {
    const { screen, child } = screenWithChild();
    const other = addFrame();
    studio().select([child, other]);
    studio().setHover(child);
    const hold = reserve("Reviewing", [], [screen]);
    expect(studio().selection).toEqual([other]);
    expect(studio().hoverId).toBeNull();
    expect(isBusy(studio().doc, child)).toBe(true);
    studio().select([screen, child, other]);
    expect(studio().selection).toEqual([other]);
    release(hold);
    studio().select([screen, child]);
    expect(studio().selection).toEqual([screen, child]);
  });
});
