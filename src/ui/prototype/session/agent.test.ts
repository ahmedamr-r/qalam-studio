import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { studio, useStudio } from "@/doc/store";
import { registerProtoPass } from "@/doc/proto-pass";
import type { ProposeResult } from "@/ai/prototype";
import { fixture } from "@/proto/fixtures/build";
import { MENU_SCREEN, OPTIONS_SHEET } from "@/proto/fixtures/food-menu";
import { RIDE_SCREEN } from "@/proto/fixtures/ride";
import { candidates } from "@/proto/agent/candidates";
import { layerIndex } from "@/proto/agent/layers";
import { playPrototype } from "@/proto/runner";
import { BUILTIN } from "@/design-system/resolve";

// The model, as recorded: a proposal, and the parts it writes.
const calls: { path: string; body: { stage: string } }[] = [];
let answer: (body: { stage: string; parts?: { candidate: string; role: string }[] }) => unknown = () => ({});
vi.mock("@/ai/client", async (orig) => ({
  ...(await orig<typeof import("@/ai/client")>()),
  aiStatus: vi.fn(async () => ({ ai: true })),
  callAI: vi.fn(async (path: string, body: { stage: string }) => {
    calls.push({ path, body });
    return { data: answer(body), model: "test" };
  }),
}));

import { aiStatus } from "@/ai/client";
import { askText, queueAsks } from "@/proto/asks";
import { build, codeProposal, fromModel, propose, settle } from "./agent";

beforeAll(async () => {
  await ensureYoga();
  registerProtoPass();
});

beforeEach(() => {
  calls.length = 0;
});

const typography = (p: string) => BUILTIN.typography(p);

/** A screen alone in the studio's document. */
function load(screen: typeof MENU_SCREEN) {
  const f = fixture({ screen, parts: {}, steps: [] });
  useStudio.setState({ doc: f.doc, past: [], future: [], txBase: null, selection: [] });
  return f.screen;
}

describe("what Qalam AI proposes, checked by code", () => {
  it("keeps only candidates it was given, once each, offers the rest unticked, and keeps leads before followers", () => {
    const f = fixture({ screen: MENU_SCREEN, parts: {}, steps: [] });
    const cs = candidates(f.doc, f.screen);
    const data: ProposeResult = {
      steps: [
        { candidate: "c3", label: "The basket bar shows the total", why: "Deliveroo does", recommended: true, plan: "View basket · total" },
        { candidate: "c9", label: "Not a candidate", why: "", recommended: true, plan: "" },
        { candidate: "c2", label: "Tap a dish to pick its size", why: "The standard", recommended: true, plan: "Size, extras, how many" },
        { candidate: "c2", label: "Again", why: "", recommended: true, plan: "" },
      ],
      asks: [{ label: "Swipe a dish to favourite it", rung: "not-yet", reason: "Gestures aren't prototyped yet", blocks: [] }],
    };
    const p = fromModel(cs, data, "test");
    // The bar follows the + that fills it, whatever order it came in.
    expect(p.steps.map((s) => s.candidate.recipe)).toEqual(["configureAndAdd", "collectionBar", "stickySections", "nextPage", "headerOnScroll"]);
    expect(p.steps.map((s) => s.ticked)).toEqual([true, true, false, false, false]);
    expect(p.steps.map((s) => s.proposed)).toEqual([true, true, false, false, false]);
    expect(p.steps[0].label).toBe("Tap a dish to pick its size");
    expect(p.asks).toEqual([{ label: "Swipe a dish to favourite it", rung: "not-yet", reason: "Gestures aren't prototyped yet" }]);
  });

  it("ticks a follower's lead, and keeps alternatives apart", () => {
    const f = fixture({ screen: MENU_SCREEN, parts: {}, steps: [] });
    const p = codeProposal(candidates(f.doc, f.screen));
    const untick = (id: string) => settle(p.steps.map((s) => ({ ...s, ticked: s.candidate.id === id ? false : s.ticked })), id);
    // Unticking the + unticks the bar that needs it, and the page the bar opens.
    const noAdd = untick("c2");
    expect(noAdd.filter((s) => ["c3", "c4"].includes(s.candidate.id)).map((s) => s.ticked)).toEqual([false, false]);
    // Ticking the page alone ticks the bar and the + back.
    const pageOnly = settle(noAdd.map((s) => ({ ...s, ticked: s.candidate.id === "c4" ? true : s.ticked })), "c4");
    expect(pageOnly.filter((s) => ["c2", "c3"].includes(s.candidate.id)).map((s) => s.ticked)).toEqual([true, true]);
  });
});

describe("what the designer asks for", () => {
  it("becomes a step to tick when it's built from blocks on layers that are there, else a note with why", () => {
    const f = fixture({ screen: MENU_SCREEN, parts: {}, steps: [] });
    const layers = layerIndex(f.doc, f.screen);
    const rating = layers.find((l) => l.component === "Rating")!;
    const p = fromModel(candidates(f.doc, f.screen), {
      steps: [],
      asks: [
        { label: "Tap the rating for a thank-you toast", rung: "free-form", reason: "Shows a toast", blocks: [{ kind: "toast", on: rating.id, target: "", look: [], start: "", text: "Thanks for rating", part: "" }] },
        { label: "Tap nowhere", rung: "free-form", reason: "", blocks: [{ kind: "toast", on: "l999", target: "", look: [], start: "", text: "Hi", part: "" }] },
        { label: "Drag dishes to reorder", rung: "not-yet", reason: "Gestures aren't prototyped yet", blocks: [] },
      ],
    }, "test", layers);
    const ask = p.steps.find((s) => s.candidate.recipe === "blocks")!;
    expect(ask).toMatchObject({ label: "Tap the rating for a thank-you toast", ticked: true, candidate: { needs: { kind: "toast", role: "done" }, at: rating.ref } });
    expect(p.asks).toEqual([
      { label: "Tap nowhere", rung: "not-yet", reason: 'It taps a layer that isn\'t on the screen ("l999").' },
      { label: "Drag dishes to reorder", rung: "not-yet", reason: "Gestures aren't prototyped yet" },
    ]);
  });
});

describe("building what was picked", () => {
  it("asks Qalam AI only for the parts the picked steps need, builds them, and commits one undo step", async () => {
    const screen = load(MENU_SCREEN);
    answer = (body) =>
      body.stage === "propose"
        ? { steps: [{ candidate: "c2", label: "Tap a dish to pick its size and extras", why: "", recommended: true, plan: "" }, { candidate: "c3", label: "See the basket's total", why: "", recommended: true, plan: "" }], asks: [] }
        : {
            parts: (body.parts ?? []).map((p) =>
              p.role === "options"
                ? { candidate: p.candidate, name: "Dish options", header: OPTIONS_SHEET.header, body: OPTIONS_SHEET.body, footer: OPTIONS_SHEET.footer }
                : { candidate: p.candidate, name: "Basket bar", header: [], body: [{ component: "Button", props: { label: "View basket · AED 18.00", variant: "primary", fullWidth: true } }], footer: [] },
            ),
          };
    const proposal = await propose(studio().doc, screen, "", new AbortController().signal);
    expect(proposal.by).toBe("model");
    const past = useStudio.getState().past.length;
    const report = await build(screen, proposal, new AbortController().signal);
    expect(report.results.every((r) => r.ok)).toBe(true);
    // Two calls: the proposal, then the two parts at once (the code-only steps weren't asked for).
    expect(calls.map((c) => c.body.stage)).toEqual(["propose", "parts"]);
    expect((calls[1].body as unknown as { parts: { role: string }[] }).parts.map((p) => p.role)).toEqual(["options", "collection"]);
    // One undo step; the route has the two steps, in the words the designer saw.
    expect(useStudio.getState().past.length).toBe(past + 1);
    const route = studio().doc.proto!.routes![screen];
    expect(route.steps!.map((s) => s.label)).toEqual(["Tap a dish to pick its size and extras", "See the basket's total"]);
    // And it plays: the sheet Qalam AI wrote opens about the dish, and adds to the bar.
    const p = playPrototype(studio().doc, { typography });
    p.tap({ path: "body.2.children.0.children.1" });
    const sheet = p.state.open[0];
    expect(p.textOf(sheet)).toContain("Size · Required");
    p.tap({ part: sheet, name: "Button/Primary" });
    expect(p.text()).toContain("View basket · AED 18.00");
  });

  it("builds with the parts code writes when Qalam AI's don't pass", async () => {
    const screen = load(RIDE_SCREEN);
    // A dialog with nothing to confirm with, and an empty toast.
    answer = (body) => ({ parts: (body.parts ?? []).map((p) => ({ candidate: p.candidate, name: "x", header: [], body: [{ component: "Text", props: { text: "?", style: "body" } }], footer: [] })) });
    const code = codeProposal(candidates(studio().doc, screen));
    // The dialog and its toast (not the page booking goes on to).
    const proposal = { ...code, steps: code.steps.map((s) => ({ ...s, ticked: s.candidate.recipe === "toastAfter" || (s.ticked && s.candidate.recipe !== "nextPage") })) };
    const report = await build(screen, proposal, new AbortController().signal);
    expect(report.results.map((r) => [r.ok, r.wrote ?? null])).toEqual([
      [true, null],
      [true, "code"],
      [true, "model"],
    ]);
  });

  it("gives Qalam AI one fix for a part that didn't pass, with why, and keeps the fix when it passes", async () => {
    const screen = load(MENU_SCREEN);
    let round = 0;
    answer = (body) => {
      const parts = (body as unknown as { parts: { candidate: string; role: string; issues?: string[] }[] }).parts;
      round++;
      return {
        parts: parts.map((p) =>
          p.role !== "options"
            ? { candidate: p.candidate, name: "Basket bar", header: [], body: [{ component: "Button", props: { label: "View basket · AED 18.00", variant: "primary", fullWidth: true } }], footer: [] }
            : round === 1
              ? // An Add with no price.
                { candidate: p.candidate, name: "Dish options", header: OPTIONS_SHEET.header, body: OPTIONS_SHEET.body, footer: [{ component: "Button", props: { label: "Add", variant: "primary", fullWidth: true } }] }
              : { candidate: p.candidate, name: "Dish options", header: OPTIONS_SHEET.header, body: OPTIONS_SHEET.body, footer: OPTIONS_SHEET.footer },
        ),
      };
    };
    const proposal = codeProposal(candidates(studio().doc, screen));
    const report = await build(screen, { ...proposal, steps: proposal.steps.filter((s) => s.candidate.recipe !== "stickySections" && s.candidate.recipe !== "headerOnScroll") }, new AbortController().signal);
    expect(calls.map((c) => c.body.stage)).toEqual(["parts", "parts"]);
    const second = (calls[1].body as unknown as { parts: { role: string; issues?: string[]; previous?: string }[] }).parts;
    expect(second.map((p) => p.role)).toEqual(["options"]);
    expect(second[0].issues).toEqual([`Its "Add" doesn't show the price.`]);
    expect(second[0].previous).toContain('"label":"Add"');
    expect(report.results.find((r) => r.id === "c2")).toMatchObject({ ok: true, wrote: "model" });
  });
});

describe("what Generate left for the prototype", () => {
  const parts = (body: { parts?: { candidate: string; role: string }[] }) => ({
    parts: (body.parts ?? []).map((p) =>
      p.role === "options"
        ? { candidate: p.candidate, name: "Dish options", header: OPTIONS_SHEET.header, body: OPTIONS_SHEET.body, footer: OPTIONS_SHEET.footer }
        : { candidate: p.candidate, name: "Basket bar", header: [], body: [{ component: "Button", props: { label: "View basket · AED 18.00", variant: "primary", fullWidth: true } }], footer: [] },
    ),
  });

  it("is what Qalam AI is asked to propose, and a build takes it", async () => {
    const screen = load(MENU_SCREEN);
    queueAsks([screen], ["The dish's options sheet open", "The basket bar after adding"], true);
    answer = (body) =>
      body.stage === "propose"
        ? { steps: [{ candidate: "c2", label: "Tap a dish: its options sheet opens", why: "", recommended: true, plan: "" }, { candidate: "c3", label: "Add it: the basket bar shows the total", why: "", recommended: true, plan: "" }], asks: [] }
        : parts(body);
    const proposal = await propose(studio().doc, screen, askText(studio().doc.proto!.routes![screen]), new AbortController().signal);
    expect((calls[0].body as unknown as { ask: string }).ask).toBe("The dish's options sheet open\nThe basket bar after adding");
    await build(screen, proposal, new AbortController().signal);
    const route = studio().doc.proto!.routes![screen];
    expect(route.asks).toBeUndefined();
    expect(route.steps!.map((s) => s.label)).toEqual(["Tap a dish: its options sheet opens", "Add it: the basket bar shows the total"]);
  });

  it("is proposed on a screen code builds nothing on by itself", async () => {
    const f = fixture({ screen: { name: "Note", platform: "mobile", body: [{ component: "Text", props: { text: "Your order is on its way", style: "title" } }] }, parts: {}, steps: [] });
    useStudio.setState({ doc: f.doc, past: [], future: [], txBase: null, selection: [] });
    expect(candidates(f.doc, f.screen)).toEqual([]);
    answer = () => ({ steps: [], asks: [{ label: "Tap the title for a toast", rung: "free-form", reason: "Shows a toast", blocks: [{ kind: "toast", on: "l1", target: "", look: [], start: "", text: "On its way", part: "" }] }] });
    const p = await propose(f.doc, f.screen, "A toast when the title is tapped", new AbortController().signal);
    expect((calls[0].body as unknown as { candidates: unknown[] }).candidates).toEqual([]);
    expect(p.steps.map((s) => s.label)).toEqual(["Tap the title for a toast"]);
    // Nothing asked, nothing code builds: nothing to ask Qalam AI.
    calls.length = 0;
    expect(await propose(f.doc, f.screen, "", new AbortController().signal)).toEqual({ steps: [], asks: [], by: "code" });
    expect(calls).toEqual([]);
  });

  it("waits, listed with why, when Qalam AI isn't on; a build of what code proposed leaves it waiting", async () => {
    const screen = load(MENU_SCREEN);
    queueAsks([screen], ["The dish's options sheet open"], true);
    vi.mocked(aiStatus).mockResolvedValue({ ai: false } as Awaited<ReturnType<typeof aiStatus>>);
    try {
      const p = await propose(studio().doc, screen, askText(studio().doc.proto!.routes![screen]), new AbortController().signal);
      expect(p.by).toBe("code");
      expect(p.asks).toEqual([{ label: "The dish's options sheet open", rung: "not-yet", reason: "Qalam AI isn't on here, so only what code builds by itself is listed." }]);
      await build(screen, { ...p, steps: p.steps.filter((s) => s.candidate.recipe === "headerOnScroll") }, new AbortController().signal);
      expect(studio().doc.proto!.routes![screen].asks).toEqual(["The dish's options sheet open"]);
    } finally {
      vi.mocked(aiStatus).mockResolvedValue({ ai: true } as Awaited<ReturnType<typeof aiStatus>>);
    }
  });
});
