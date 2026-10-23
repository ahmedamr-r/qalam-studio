import { cleanText } from "./text";

/** A Word document's text (mammoth's browser build, loaded only when a .docx comes in). */
export async function readDocx(data: ArrayBuffer): Promise<{ text: string }> {
  const mammoth = await import("mammoth");
  const { value } = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: data });
  const text = cleanText(value);
  if (!text) throw new Error("This Word document has no text in it.");
  return { text };
}
