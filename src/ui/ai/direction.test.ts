import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { studio, useStudio } from "@/doc/store";
import { ensureYoga, setAutoLayoutEnabled } from "@/doc/autolayout";
import { descendants } from "@/doc/geometry";
import { makeFrame, makeShape, makeText } from "@/doc/factory";
import { insertNodes } from "@/doc/ops";
import { emptyDoc, type FrameNode, type TextNode } from "@/doc/schema";
import { callAI } from "@/ai/client";
import type { ScreenSpec } from "@/design-system/builders";
import { isEdited } from "@/design-system/apply";
import { insertScreens } from "@/design-system/place";
import { applyDirection, directionTargets, nextDir, runDirection, scanCopy, type DirectionOutcome } from "./direction";
import { chatContext } from "./chatContext";
import type { ChatRequest, ChatTurn } from "./chatTypes";

// The model, as a dictionary: every string it's sent comes back translated (or as it was).
const DICT: Record<string, string> = {
  Wallet: "المحفظة",
  "Add money": "أضف رصيد",
  "Recent activity": "آخر العمليات",
  "Top up": "شحن الرصيد",
  Label: "تسمية",
  "تسمية": "Label",
};
vi.mock("@/ai/client", async (orig) => ({
  ...(await orig<typeof import("@/ai/client")>()),
  callAI: vi.fn(async (_path: string, body: { units: { id: string; text: string }[] }) => ({
    data: { translations: body.units.map((u) => ({ id: u.id, text: DICT[u.text] ?? u.text })), note: "Kept the person's name as written." },
    model: "test",
  })),
}));

/** An LTR screen with a horizontal auto-layout row: [a][b] from the left. */
function screen() {
  const f = makeFrame({ name: "Screen", w: 300, h: 200, fill: null });
  const row = makeFrame({ name: "Row", w: 300, h: 40, fill: null, layout: { direction: "horizontal", wrap: false, gap: 10, crossGap: 10, padding: { top: 0, end: 0, bottom: 0, start: 16 }, justify: "start", align: "start" } });
  const a = makeShape("rect", { name: "a", w: 50, h: 20 });
  const label = makeText({ text: { content: "Label" } });
  insertNodes([f], null);
  insertNodes([row], f.id);
  insertNodes([a], row.id);
  insertNodes([label], row.id);
  return { f: f.id, row: row.id, a: a.id, label: label.id };
}

beforeAll(async () => {
  await ensureYoga();
  setAutoLayoutEnabled(true);
});
beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

describe("direction tool", () => {
  it("acts on the frame around a selected layer, outermost first", () => {
    const { f, row, label } = screen();
    const doc = studio().doc;
    expect(directionTargets(doc, [label]).map((n) => n.id)).toEqual([row]);
    expect(directionTargets(doc, [label, f]).map((n) => n.id)).toEqual([f]);
    expect(nextDir(directionTargets(doc, [f]))).toBe("rtl");
  });

  it("switches a screen in place in one undo step, flipping its auto-layout rows", () => {
    const { f, row, a } = screen();
    const past = studio().past.length;
    const o = applyDirection("switch", directionTargets(studio().doc, [f]));
    const doc = studio().doc;
    expect(o).toMatchObject({ kind: "direction", mode: "switch", toDir: "rtl", frames: [{ id: f }] });
    expect([(doc.nodes[f] as FrameNode).dir, (doc.nodes[row] as FrameNode).dir]).toEqual(["rtl", "rtl"]);
    // Start padding (16) is now on the right.
    expect(doc.nodes[a].x).toBe(300 - 16 - 50);
    expect(studio().past.length).toBe(past + 1);
  });

  it("mirrors a copy and leaves the original alone", () => {
    const { f } = screen();
    const o = applyDirection("mirror", directionTargets(studio().doc, [f]));
    const doc = studio().doc;
    expect(o.frames).toHaveLength(1);
    const copy = doc.nodes[o.frames[0].id] as FrameNode;
    expect(copy.id).not.toBe(f);
    expect(copy.dir).toBe("rtl");
    expect((doc.nodes[f] as FrameNode).dir).toBe("ltr");
    expect(studio().selection).toEqual([copy.id]);
  });

  it("tells follow-up requests what changed", () => {
    const { f } = screen();
    const o = applyDirection("switch", directionTargets(studio().doc, [f]));
    const t: ChatTurn = { id: "t1", tool: "direction", at: 1, request: { text: "Switch to RTL" }, status: "done", started: 1, tokens: 0, outcome: o };
    expect(chatContext(studio().doc, [t])).toContain('Direction: switched "Screen" to RTL');
  });
});

const WALLET: ScreenSpec = {
  name: "Wallet",
  header: [{ component: "TopBar", props: { title: "Wallet", leading: "back" } }],
  body: [
    { component: "Button", props: { label: "Add money", variant: "primary" } },
    { component: "ListItem", props: { title: "Sara Ahmed", subtitle: "Top up", trailing: "text", trailingText: "AED 50" } },
    { component: "Text", props: { text: "Recent activity", style: "headline" } },
  ],
};

const texts = (id: string) => descendants(studio().doc, id).map((k) => studio().doc.nodes[k]).filter((n): n is TextNode => n.type === "text");

function directionTurn(frames: string[], direction: NonNullable<ChatRequest["direction"]>): ChatTurn {
  const screens = frames.map((id) => ({ id, name: studio().doc.nodes[id].name }));
  return { id: "t1", tool: "direction", at: 1, request: { text: "Switch", screens, direction }, status: "running", started: 1, tokens: 0 };
}

/** Run a Direction turn and return its final outcome. */
async function run(t: ChatTurn, ai = true): Promise<DirectionOutcome> {
  let outcome: DirectionOutcome | undefined;
  await runDirection(t, ai, () => {}, new AbortController().signal, {
    patch: (p) => {
      const o = (typeof p === "function" ? p(t) : p).outcome;
      if (o?.kind === "direction") outcome = o;
    },
  });
  return outcome!;
}

describe("the copy follows the direction", () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
  });

  it("rebuilds an untouched generated screen in the new direction instead of mirroring it", async () => {
    const [id] = await insertScreens([WALLET], "ai", "builtin");
    applyDirection("switch", [studio().doc.nodes[id] as FrameNode]);
    const n = studio().doc.nodes[id] as FrameNode;
    expect([n.dir, n.meta.spec?.dir]).toEqual(["rtl", "rtl"]);
    // Still linked to its spec: a later system change rebuilds it, in RTL.
    expect(isEdited(studio().doc, id)).toBe(false);
  });

  it("translates a generated screen to Arabic: its spec, rebuilt in Arabic type", async () => {
    const [id] = await insertScreens([WALLET], "ai", "builtin");
    const o = await run(directionTurn([id], { mode: "switch", to: "rtl", translate: true }));
    expect(o.copy).toMatchObject({ to: "ar", translated: 4, kept: ["Sara Ahmed"], note: "Kept the person's name as written." });
    // Amounts never reach the model.
    const sent = vi.mocked(callAI).mock.calls[0][1] as { to: string; units: { text: string; where: string }[] };
    expect(sent.to).toBe("ar");
    expect(sent.units.map((u) => u.text)).not.toContain("AED 50");
    expect(sent.units.find((u) => u.text === "Add money")?.where).toBe("Button.label · Wallet");
    const root = studio().doc.nodes[id];
    expect(root.meta.spec).toMatchObject({ dir: "rtl", lang: "ar" });
    expect(isEdited(studio().doc, id)).toBe(false);
    const label = texts(id).find((t) => t.text.content === "أضف رصيد")!;
    expect(label.text.fontFamily).toMatch(/Arabic/);
    expect(texts(id).some((t) => t.text.content === "Add money")).toBe(false);
  });

  it("measures the translations and sends what's too long back once, to be shortened", async () => {
    const long = "أضف رصيدًا إلى محفظتك الآن من فضلك"; // over the button label's 24 characters
    vi.mocked(callAI)
      .mockImplementationOnce(async (_p, body) => ({ data: { translations: (body as { units: { id: string; text: string }[] }).units.map((u) => ({ id: u.id, text: u.text === "Add money" ? long : (DICT[u.text] ?? u.text) })), note: "Too long, sorry." } }))
      .mockImplementationOnce(async (_p, body) => ({ data: { translations: (body as { units: { id: string }[] }).units.map((u) => ({ id: u.id, text: "أضف رصيد" })), note: "" } }));
    const [id] = await insertScreens([WALLET], "ai", "builtin");
    const o = await run(directionTurn([id], { mode: "switch", to: "rtl", translate: true }));
    const again = vi.mocked(callAI).mock.calls[1][1] as { units: { text: string; previous?: string; maxChars?: number }[] };
    expect(again.units).toEqual([expect.objectContaining({ text: "Add money", previous: long, maxChars: 24 })]);
    expect(texts(id).some((t) => t.text.content === "أضف رصيد")).toBe(true);
    expect(o.copy?.note).toBeUndefined();
  });

  it("translates the text layers of a frame that isn't from a spec, with Arabic type, and back", async () => {
    const { f, label } = screen();
    let o = await run(directionTurn([f], { mode: "switch", to: "rtl", translate: true }));
    expect(o.copy).toMatchObject({ to: "ar", found: 1, translated: 1 });
    let t = studio().doc.nodes[label] as TextNode;
    expect([t.text.content, t.text.letterSpacing]).toEqual(["تسمية", 0]);
    expect(t.text.fontFamily).toMatch(/Arabic/);
    o = await run(directionTurn([f], { mode: "switch", to: "ltr", translate: true }));
    t = studio().doc.nodes[label] as TextNode;
    expect(t.text.content).toBe("Label");
    expect(t.text.fontFamily).not.toMatch(/Arabic/);
  });

  it("doesn't call the model when the copy is already in the target language", async () => {
    const { f } = screen();
    await run(directionTurn([f], { mode: "switch", to: "rtl", translate: true }));
    vi.mocked(callAI).mockClear();
    // Back to RTL from a copy that's Arabic already (mirror of the translated frame).
    expect(scanCopy(studio().doc, [f], "ar")).toEqual([]);
    const o = await run(directionTurn([f], { mode: "mirror", to: "ltr", translate: true }));
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(o.copy?.translated).toBe(1);
  });

  it("switches without translating when AI isn't set up, or when the designer keeps the copy", async () => {
    const { f } = screen();
    let o = await run(directionTurn([f], { mode: "switch", to: "rtl", translate: true }), false);
    expect(o.copy).toMatchObject({ found: 1, translated: 0, skipped: "no-ai" });
    expect((studio().doc.nodes[f] as FrameNode).dir).toBe("rtl");
    const other = screen().f;
    o = await run(directionTurn([other], { mode: "switch", to: "rtl", translate: false }));
    expect(o.copy).toMatchObject({ found: 1, translated: 0, skipped: "kept" });
    expect((studio().doc.nodes[other] as FrameNode).dir).toBe("rtl");
    expect(callAI).not.toHaveBeenCalled();
  });

  it("tells follow-up requests what happened to the copy", async () => {
    const { f } = screen();
    const t = directionTurn([f], { mode: "switch", to: "rtl", translate: true });
    const o = await run(t);
    expect(chatContext(studio().doc, [{ ...t, status: "done", outcome: o }])).toContain("translated 1 texts to Arabic");
  });
});
