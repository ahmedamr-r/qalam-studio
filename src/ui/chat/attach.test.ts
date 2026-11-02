import { afterEach, describe, expect, it, vi } from "vitest";
import { setLab } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import { attachFiles, clearAttachments, docPart, docsCheck, guessVoice, joinParts, removeAttachment, sourcesFor, spansWithin, useAttach, type Attachment } from "./attach";

const c = (id: string, group: ConnectorState["group"], o: Partial<ConnectorState> = {}): ConnectorState =>
  ({ id, label: id[0].toUpperCase() + id.slice(1), group, feeds: "material", imports: true, via: null, tone: "off", claudeCode: null, ...o }) as ConnectorState;

const CATALOG = [
  c("notion", "docs"),
  c("drive", "docs"),
  c("confluence", "docs"),
  c("slack", "voice"),
  c("intercom", "voice"),
  c("zendesk", "voice", { imports: false }),
  c("linear", "build", { feeds: "work" }),
];

describe("which sources the box offers", () => {
  it("offers docs for an idea, connected first, then what Claude Code has, then the catalog's order", () => {
    expect(sourcesFor("docs", CATALOG).map((x) => x.id)).toEqual(["notion", "drive", "confluence"]);
    const live = CATALOG.map((x) => (x.id === "drive" ? { ...x, claudeCode: { server: "claude.ai Google Drive", status: "connected" as const } } : x.id === "confluence" ? { ...x, via: "oauth" as const, tone: "ok" as const } : x));
    expect(sourcesFor("docs", live).map((x) => x.id)).toEqual(["confluence", "drive", "notion"]);
  });

  it("offers customers' words before docs for problems, and never what brings no material", () => {
    expect(sourcesFor("customers", CATALOG).map((x) => x.id)).toEqual(["slack", "intercom", "notion", "drive", "confluence"]);
    // A connector that stopped taking Qalam's sign-in isn't counted as connected.
    const expired = CATALOG.map((x) => (x.id === "notion" ? { ...x, via: "oauth" as const, tone: "warn" as const } : x));
    expect(sourcesFor("customers", expired)[0].id).toBe("slack");
  });
});

describe("docs sent with the words", () => {
  it("joins their words, a page and each doc under a line naming where it came from, and knows where each part's words sit", () => {
    const parts = [{ body: " A planner for families. " }, docPart({ via: "Google Drive", title: "Pitch deck.pdf", text: "Families plan on Sunday.\n" }), docPart({ via: "this computer", title: "notes.md", text: "Shopping lists." })];
    const { text, spans } = joinParts(parts);
    expect(text).toBe("A planner for families.\n\nFrom Google Drive: Pitch deck.pdf\n\nFamilies plan on Sunday.\n\nFrom this computer: notes.md\n\nShopping lists.");
    expect(spans.map(([a, b]) => text.slice(a, b))).toEqual(["A planner for families.", "Families plan on Sunday.", "Shopping lists."]);
    // A doc alone starts at its header.
    const alone = joinParts([docPart({ via: "Google Drive", title: "Pitch", text: "Words." })]);
    expect(alone.text).toBe("From Google Drive: Pitch\n\nWords.");
    expect(alone.text.slice(...alone.spans[0])).toBe("Words.");
  });

  it("moves a PDF's headings and list items to where its words sit in the joined text", () => {
    const pdf = "  What it promised\n\nWhere each payout is";
    const { text, blocks } = joinParts([{ body: "My idea." }, docPart({ via: "This computer", title: "Promise.pdf", text: pdf, blocks: [{ span: [2, 18], kind: "h1" }, { span: [20, 40], kind: "li" }] })]);
    expect(blocks.map((b) => [b.kind, text.slice(...b.span)])).toEqual([
      ["h1", "What it promised"],
      ["li", "Where each payout is"],
    ]);
  });

  it("shortens the part the length cut falls in, and leaves out the ones after it", () => {
    const { text, spans } = joinParts([{ body: "x".repeat(10) }, docPart({ via: "Drive", title: "A", text: "y".repeat(10) }), docPart({ via: "Drive", title: "B", text: "z".repeat(10) })]);
    expect(text.length).toBeGreaterThan(40);
    const kept = spansWithin([{ title: "words" }, { title: "A" }, { title: "B" }], spans, spans[1][0] + 4);
    expect(kept).toEqual([
      { title: "words", span: [0, 10] },
      { title: "A", span: [spans[1][0], spans[1][0] + 4], cut: true },
    ]);
  });

  it("waits for a doc still reading, and says when they're too long together", () => {
    const doc = (title: string, state: Attachment["state"], text = ""): Attachment => ({ key: title, from: "drive", via: "Google Drive", title, state, ...(state === "ready" ? { ingested: { kind: "connector", title, text } } : {}) });
    expect(docsCheck("Hi", [doc("Pitch", "reading")], 100)).toBe("Wait for “Pitch” to finish reading.");
    expect(docsCheck("Hi", [doc("Pitch", "ready", "x".repeat(50))], 100)).toBeNull();
    expect(docsCheck("Hi", [doc("Pitch", "ready", "x".repeat(50)), doc("Notes", "ready", "x".repeat(50))], 100)).toBe("That's over 100 characters with the docs: leave one out.");
    // A doc that couldn't be read doesn't count, and problems have no total.
    expect(docsCheck("Hi", [doc("Gone", "failed")], 100)).toBeNull();
    expect(docsCheck("Hi", [doc("Pitch", "ready", "x".repeat(500))], null)).toBeNull();
  });
});

describe("whose words a doc holds", () => {
  it("guesses customers' when people talk in it, it's from a tool of their voice, or its name says so", () => {
    expect(guessVoice({ kind: "interview", text: "…", title: "Call 3" })).toBe("customers");
    expect(guessVoice({ text: "Notes", title: "rider-interviews-oct.md" })).toBe("customers");
    expect(guessVoice({ text: "Notes", title: "Inbox", group: "voice" })).toBe("customers");
    expect(guessVoice({ text: "Ahmed S.: Pins land mid-compound\n\nMohamed R.: Long pickups aren't paid\n\nHany T.: Riders have no change", title: "export.csv" })).toBe("customers");
  });

  it("guesses the person's own otherwise, a few labelled lines in a plan included", () => {
    expect(guessVoice({ text: "Our plan for Q4.\nGoal: more trips\nOwner: Sara\nMetric: trips per week\nWe start with pickups.\nThen fares.\nThen cash.\nThen safety.", title: "Q4 plan.md" })).toBe("own");
    expect(guessVoice({ text: "What we do and why.", title: "strategy.pdf" })).toBe("own");
  });

  it("says so in the doc's header when they're customers' words", () => {
    expect(docPart({ via: "this computer", title: "a.md", text: "x", voice: "customers" }).header).toBe("From this computer: a.md (customers' words)");
    expect(docPart({ via: "this computer", title: "a.md", text: "x", voice: "own" }).header).toBe("From this computer: a.md");
  });
});

describe("a PDF being read in the core", () => {
  afterEach(() => {
    clearAttachments();
    vi.unstubAllGlobals();
    setLab(true);
  });

  /** A core that says one step, then reads until it's stopped; `stopped` resolves when it is. */
  function slowCore() {
    let stopped = () => {};
    const gone = new Promise<void>((done) => (stopped = done));
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/orgs") return Response.json({ current: "o1", orgs: [{ id: "o1", name: "Org", dir: "/x" }] });
      init?.signal?.addEventListener("abort", stopped);
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "activity", label: "Reading page 3 of 52" })}\n`));
          init?.signal?.addEventListener("abort", () => c.error(Object.assign(new Error("Aborted"), { name: "AbortError" })));
        },
      });
      return new Response(body);
    });
    return gone;
  }

  const file = () => new File(["%PDF-1.4"], "Report.pdf", { type: "application/pdf" });

  it("says how it's going on its chip, and leaving it out stops the read", async () => {
    setLab(["pictures"]);
    const gone = slowCore();
    attachFiles([file()]);
    await vi.waitFor(() => expect(useAttach.getState().items[0]?.step).toBe("Reading page 3 of 52"));
    removeAttachment(useAttach.getState().items[0].key);
    await gone;
    expect(useAttach.getState().items).toEqual([]);
  });

  it("clearing the box stops what's being read in it", async () => {
    setLab(["pictures"]);
    const gone = slowCore();
    attachFiles([file()]);
    await vi.waitFor(() => expect(useAttach.getState().items[0]?.step).toBeTruthy());
    clearAttachments();
    await gone;
  });
});
