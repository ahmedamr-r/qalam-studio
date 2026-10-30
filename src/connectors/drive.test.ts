import { describe, expect, it } from "vitest";
import { DRIVE_RECIPE, driveFolder, driveHits, driveText, driveType, driveWords } from "./drive";

// The shapes Google's Drive server answered with (October 2026), trimmed.
const LISTED = JSON.stringify({
  files: [
    { id: "1Twno3", mimeType: "application/pdf", title: "Pitch deck.pdf", viewUrl: "https://drive.google.com/file/d/1Twno3/view", modifiedTime: "2026-10-21T19:49:54.489Z", parentId: "166T" },
    { id: "166T", mimeType: "application/vnd.google-apps.folder", title: "Research", viewUrl: "https://drive.google.com/drive/folders/166T", modifiedTime: "2026-10-21T19:46:22.862Z" },
    { id: "1-R3", mimeType: "video/mp4", title: "Walkthrough", viewUrl: "https://drive.google.com/file/d/1-R3/view" },
    { id: "19Hs", mimeType: "application/vnd.google-apps.document", title: "Survey notes", viewUrl: "https://evil.example/19Hs" },
    { mimeType: "application/pdf", title: "No id" },
  ],
  nextPageToken: "~!!~AAf",
});

describe("Google Drive through its own server", () => {
  it("turns words into a query of whole words, with nothing that can add to it", () => {
    expect(driveWords("meal planner")).toBe("fullText contains 'meal' and fullText contains 'planner'");
    expect(driveWords("it's a 'test' \\ or') or title != 'x")).toBe("fullText contains 'it' and fullText contains 'test' and fullText contains 'or' and fullText contains 'or' and fullText contains 'title'");
    expect(driveWords("خطة الوجبات")).toBe("fullText contains 'خطة' and fullText contains 'الوجبات'");
    expect(driveWords("a ' ! ?")).toBeNull();
    expect(driveWords("one two three four five six seven")?.split(" and ")).toHaveLength(6);
  });

  it("opens only a folder id Drive could have given, else My Drive", () => {
    expect(driveFolder("166TJGm7yQhwb5hlimb_EsJwzwkQFFlhe")).toBe("166TJGm7yQhwb5hlimb_EsJwzwkQFFlhe");
    expect(driveFolder(null)).toBe("root");
    expect(driveFolder("x' or parentId = 'y")).toBe("root");
    expect(DRIVE_RECIPE.list!(null)).toEqual({ tool: "search_files", args: { query: "parentId = 'root'", pageSize: 50, excludeContentSnippets: true } });
    expect(DRIVE_RECIPE.list!("166T").args.query).toBe("parentId = '166T'");
  });

  it("lists folders first, says what each file is, and keeps only Google's own addresses", () => {
    const hits = driveHits(LISTED);
    expect(hits.map((h) => h.title)).toEqual(["Research", "Pitch deck.pdf", "Walkthrough", "Survey notes"]);
    expect(hits[0]).toEqual({ id: "166T", title: "Research", type: "folder", folder: true, url: "https://drive.google.com/drive/folders/166T", at: "2026-10-21T19:46:22.862Z" });
    expect(hits.map((h) => h.type)).toEqual(["folder", "pdf", "other", "doc"]);
    expect(hits[3].url).toBeUndefined();
    expect(driveHits("not json")).toEqual([]);
  });

  it("knows the kinds it reads", () => {
    expect(driveType("application/vnd.google-apps.presentation")).toBe("slides");
    expect(driveType("application/vnd.google-apps.spreadsheet")).toBe("sheet");
    expect(driveType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("doc");
    expect(driveType("text/markdown")).toBe("text");
    expect(driveType("image/png")).toBe("other");
  });

  it("reads a file's words from read_file_content's answer, and anything else as it came", () => {
    expect(driveText(JSON.stringify({ fileContent: "  \n\nThe pitch\n\nFamilies plan meals on Sunday.\n", title: "Pitch", viewUrl: "https://docs.google.com/document/d/1" }))).toBe("The pitch\n\nFamilies plan meals on Sunday.");
    expect(driveText("Plain words")).toBe("Plain words");
    expect(DRIVE_RECIPE.fetch({ id: "19Hs", title: "Survey notes" })).toEqual({ tool: "read_file_content", args: { fileId: "19Hs" } });
  });

  it("asks for nothing it can't put in a query, and recent files without their text", () => {
    expect(DRIVE_RECIPE.search("? !").args.query).toBe("title = ''");
    expect(DRIVE_RECIPE.recent!()).toEqual({ tool: "list_recent_files", args: { pageSize: 25, excludeContentSnippets: true } });
  });
});
