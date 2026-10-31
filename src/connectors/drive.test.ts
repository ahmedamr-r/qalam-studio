import { describe, expect, it } from "vitest";
import { driveFileHits, driveFolder, driveType, driveWords } from "./drive";

// files.list's answer, as Drive's API gives it (fields id, name, mimeType, modifiedTime, webViewLink).
const LISTED = [
  { id: "1Twno3", mimeType: "application/pdf", name: "Pitch deck.pdf", webViewLink: "https://drive.google.com/file/d/1Twno3/view", modifiedTime: "2026-10-21T19:49:54.489Z" },
  { id: "166T", mimeType: "application/vnd.google-apps.folder", name: "Research", webViewLink: "https://drive.google.com/drive/folders/166T", modifiedTime: "2026-10-21T19:46:22.862Z" },
  { id: "1-R3", mimeType: "video/mp4", name: "Walkthrough", webViewLink: "https://drive.google.com/file/d/1-R3/view" },
  { id: "19Hs", mimeType: "application/vnd.google-apps.document", name: "Survey notes", webViewLink: "https://evil.example/19Hs" },
  { mimeType: "application/pdf", name: "No id" },
];

describe("Google Drive through its own API", () => {
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
  });

  it("lists folders first, says what each file is, and keeps only Google's own addresses", () => {
    const hits = driveFileHits(LISTED);
    expect(hits.map((h) => h.title)).toEqual(["Research", "Pitch deck.pdf", "Walkthrough", "Survey notes"]);
    expect(hits[0]).toEqual({ id: "166T", title: "Research", type: "folder", folder: true, url: "https://drive.google.com/drive/folders/166T", at: "2026-10-21T19:46:22.862Z" });
    expect(hits.map((h) => h.type)).toEqual(["folder", "pdf", "other", "doc"]);
    expect(hits[3].url).toBeUndefined();
  });

  it("knows the kinds it reads", () => {
    expect(driveType("application/vnd.google-apps.presentation")).toBe("slides");
    expect(driveType("application/vnd.google-apps.spreadsheet")).toBe("sheet");
    expect(driveType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("doc");
    expect(driveType("text/markdown")).toBe("text");
    expect(driveType("image/png")).toBe("other");
  });
});
