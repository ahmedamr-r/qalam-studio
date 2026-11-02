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

describe("a PDF in the window, with its pictures being read", () => {
  it("is read in the core, whose reading it takes as it is", async () => {
    const calls = core(() => Response.json({ text: "Page one.\n\nChart on page 2: Churn", pages: [0, 11], pictures: { read: [{ page: 2, kind: "chart", span: [11, 33] }] } }));
    const r = await ingestFile(PDF());
    expect(calls.at(-1)).toBe("/api/org/o1/pdf");
    expect(r).toMatchObject({ kind: "pdf", title: "Report", text: "Page one.\n\nChart on page 2: Churn", pages: [0, 11], pictures: { read: [{ page: 2, kind: "chart" }] } });
  });

  it("says what the core says of the file itself", async () => {
    core(() => Response.json({ message: "This PDF has no text to read, only scanned pages, and Qalam reads those only on a Mac." }, { status: 422 }));
    const err = await ingestFile(PDF()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as Error).message).toContain("only on a Mac");
  });

  it("isn't sent to the core with the lab off", async () => {
    setLab([]);
    const calls = core(() => Response.json({}));
    await ingestFile(PDF()).catch(() => {});
    expect(calls).toEqual([]);
  });
});
