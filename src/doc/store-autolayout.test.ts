import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { ensureYoga, setAutoLayoutEnabled } from "./autolayout";
import { setTextMeasurer } from "./measure";
import { wrappingMeasurer } from "./autolayout.fixtures";
import { makeFrame, makeText } from "./factory";
import { insertNodes } from "./ops";
import { emptyDoc, type TextNode } from "./schema";
import { applyFix, auditNode } from "@/lint/rules";

const node = (id: string) => studio().doc.nodes[id];

/** A hugging vertical stack: a text and a label below it. */
function stack() {
  const f = makeFrame({ name: "Stack", fill: null, sizeH: "fixed", w: 120, sizeV: "hug", layout: { direction: "vertical", wrap: false, gap: 8, crossGap: 8, padding: { top: 4, end: 4, bottom: 4, start: 4 }, justify: "start", align: "start" } });
  const t = makeText({ text: { content: "Short", autoSize: "height" }, sizeH: "fill", w: 112 });
  const l = makeText({ text: { content: "Below" } });
  insertNodes([f], null);
  insertNodes([t], f.id);
  insertNodes([l], f.id);
  return { f: f.id, t: t.id, l: l.id };
}

beforeAll(async () => {
  await ensureYoga();
  setTextMeasurer(wrappingMeasurer);
  setAutoLayoutEnabled(true);
});
beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

describe("auto layout in the store", () => {
  it("reflows siblings in the same undo step as a text edit", () => {
    const { f, t, l } = stack();
    const y0 = node(l).y;
    const past = studio().past.length;
    studio().mutate((d) => void ((d.nodes[t] as TextNode).text.content = "A much longer line of text that wraps"));
    expect(studio().past.length).toBe(past + 1);
    expect(node(l).y).toBeGreaterThan(y0);
    expect(node(f).h).toBe(4 + node(t).h + 8 + node(l).h + 4);
    studio().undo();
    expect(node(l).y).toBe(y0);
  });

  it("restores the earlier layout when a transaction is cancelled", () => {
    const { t, l } = stack();
    const y0 = node(l).y;
    studio().beginTx();
    studio().mutate((d) => void ((d.nodes[t] as TextNode).text.content = "Several words that will wrap to more lines"));
    expect(node(l).y).toBeGreaterThan(y0);
    studio().cancelTx();
    expect(node(l).y).toBe(y0);
  });

  it("keeps node identities for writes that don't affect layout", () => {
    const { f, l } = stack();
    const before = studio().doc;
    studio().mutate((d) => void (d.nodes[l].meta.flags = [{ rule: "x", severity: "info", message: "m" }]), { history: false });
    expect(node(f)).toBe(before.nodes[f]);
    expect(node(l).y).toBe(before.nodes[l].y);
  });

  it("the touch-target fix sets a minimum size and the flow makes room", () => {
    const { f, l } = stack();
    const btn = makeFrame({ name: "Tiny button", w: 20, h: 20, fill: null, meta: { source: "user", interactive: true } });
    insertNodes([btn], f, 0);
    const finding = auditNode(studio().doc, node(btn.id)).find((x) => x.rule === "touch-target")!;
    const y0 = node(l).y;
    applyFix(finding);
    const n = node(btn.id);
    expect(n.minH).toBe(finding.fix!.kind === "min-size" ? finding.fix!.size : 0);
    expect(n.h).toBe(n.minH);
    expect(node(l).y).toBe(y0 + n.h - 20);
  });

  it("moving a whole auto-layout frame doesn't relayout its content", () => {
    const { f, t } = stack();
    const text = node(t);
    studio().mutate((d) => void (d.nodes[f].x += 100));
    expect(node(t)).toBe(text);
  });
});
