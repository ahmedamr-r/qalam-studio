import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLab } from "@/lab";
import { ingestFile, IngestError } from ".";

const PDF = () => new File(["%PDF-1.4 not really"], "Report.pdf", { type: "application/pdf" });

/** The core: `/pdf` answers as given; everything else as an organization that exists. */
function core(pdf: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url === "/api/orgs") return Response.json({ current: "o1", orgs: [{ id: "o1", name: "Org", dir: "/x" }] });
    return pdf();
  });
  return calls;
}

beforeEach(() => setLab(["pictures"]));
afterEach(() => {
  vi.unstubAllGlobals();
  setLab(true);
});

const stream = (...lines: unknown[]) => new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""), { headers: { "content-type": "application/x-ndjson" } });

describe("a PDF in the window, with its pictures being read", () => {
  it("is read in the core, saying how it's going, and its reading is taken as it is", async () => {
    const calls = core(() => stream({ type: "activity", label: "Drawing page 1 of 2" }, { type: "activity", label: "Qalam AI has read 2 of 2 pages" }, { type: "result", data: { text: "Page one.\n\nChart on page 2: Churn", pages: [0, 11], pictures: { read: [{ page: 2, kind: "chart", span: [11, 33] }] } } }));
    const steps: string[] = [];
    const r = await ingestFile(PDF(), { onStep: (s) => steps.push(s) });
    expect(calls.at(-1)).toBe("/api/org/o1/pdf");
    expect(steps).toEqual(["Drawing page 1 of 2", "Qalam AI has read 2 of 2 pages"]);
    expect(r).toMatchObject({ kind: "pdf", title: "Report", text: "Page one.\n\nChart on page 2: Churn", pages: [0, 11], pictures: { read: [{ page: 2, kind: "chart" }] } });
  });

  it("says what the core says of the file itself", async () => {
    core(() => stream({ type: "error", error: "failed", message: "This PDF has no text to read, only scanned pages, and Qalam reads those only on a Mac." }));
    const err = await ingestFile(PDF()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as Error).message).toContain("only on a Mac");
  });

  it("stays stopped when it's stopped: the window doesn't read it instead", async () => {
    const calls = core(() => {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    });
    const err = await ingestFile(PDF()).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(calls.at(-1)).toBe("/api/org/o1/pdf");
  });

  it("isn't sent to the core with the lab off", async () => {
    setLab([]);
    const calls = core(() => stream({}));
    await ingestFile(PDF()).catch(() => {});
    expect(calls).toEqual([]);
  });
});
