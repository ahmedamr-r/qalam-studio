import { describe, expect, it } from "vitest";
import type { ConnectorState } from "@/org/connectors";
import { docsCheck, sourcesFor, withDocs, type Attachment } from "./attach";

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
  it("joins the words and each doc under a line naming where it came from", () => {
    expect(withDocs("A planner for families.", [{ via: "Google Drive", title: "Pitch deck.pdf", text: "Families plan on Sunday.\n" }, { via: "this computer", title: "notes.md", text: "Shopping lists." }])).toBe(
      "A planner for families.\n\nFrom Google Drive: Pitch deck.pdf\n\nFamilies plan on Sunday.\n\nFrom this computer: notes.md\n\nShopping lists.",
    );
    expect(withDocs("  ", [{ via: "Google Drive", title: "Pitch", text: "Words." }])).toBe("From Google Drive: Pitch\n\nWords.");
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
