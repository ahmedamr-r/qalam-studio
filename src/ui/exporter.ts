import { feedback } from "@/commands/feedback";
import { studio } from "@/doc/store";
import { forStorage } from "@/doc/pages";
import type { Doc } from "@/doc/schema";
import type { Renderer } from "@/engine/renderer";
import { createProject, currentProject, goToProject } from "@/projects/session";

let renderer: Renderer | null = null;
const waiting: (() => void)[] = [];
export const setExportRenderer = (r: Renderer | null) => {
  renderer = r;
  if (r) waiting.splice(0).forEach((f) => f());
};

/** The canvas renderer, once the canvas has mounted. Grab it synchronously after awaiting: it can be swapped on remount. */
export async function exportRenderer(): Promise<Renderer> {
  while (!renderer) await new Promise<void>((r) => waiting.push(r));
  return renderer;
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download each selected layer as a PNG; returns how many were exported. */
export function exportSelectionPNG(scale = 2): number {
  const { doc, selection } = studio();
  if (!renderer) return 0;
  let count = 0;
  for (const id of selection) {
    const bytes = doc.nodes[id] ? renderer.exportNode(doc, id, scale) : null;
    if (bytes) {
      download(`${doc.nodes[id].name.replace(/[^\w\- ]+/g, "")}@${scale}x.png`, bytes as BlobPart, "image/png");
      count++;
    }
  }
  return count;
}

/** ⇧⌘K: let the designer pick image files (resolves to none when cancelled). */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * ⇧⌘C: the selection as one PNG on the system clipboard (@2x). Several layers are stacked
 * top to bottom with a gap, the way Figma copies them. Resolves to false when nothing was copied.
 */
export async function copySelectionPNG(scale = 2): Promise<boolean> {
  const { doc, selection } = studio();
  const r = renderer;
  if (!r || !selection.length || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  const pngs = selection.flatMap((id) => {
    const bytes = doc.nodes[id] ? r.exportNode(doc, id, scale) : null;
    return bytes ? [new Blob([bytes as BlobPart], { type: "image/png" })] : [];
  });
  if (!pngs.length) return false;
  const blob = pngs.length === 1 ? pngs[0] : await stackPNGs(pngs, 16 * scale);
  // Safari wants the item's promise created inside the gesture; a resolved blob works everywhere else.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  return true;
}

async function stackPNGs(pngs: Blob[], gap: number): Promise<Blob> {
  const bitmaps = await Promise.all(pngs.map((b) => createImageBitmap(b)));
  const w = Math.max(...bitmaps.map((b) => b.width));
  const h = bitmaps.reduce((sum, b) => sum + b.height, 0) + gap * (bitmaps.length - 1);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  let y = 0;
  for (const b of bitmaps) {
    ctx.drawImage(b, 0, y);
    y += b.height + gap;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}

/** PNG of a node as a base64 data URL (used to send frames to the AI audit). */
export function nodeToDataURL(id: string, scale = 1): string | null {
  const { doc } = studio();
  const bytes = renderer?.exportNode(doc, id, scale);
  if (!bytes) return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

export function exportDocJSON() {
  // Without the Components page (it's drawn from the design system, never saved).
  const doc = forStorage(studio().doc);
  const name = currentProject()?.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  download(`${name || "qalam-document"}.json`, JSON.stringify(doc, null, 2), "application/json");
}

/** Pick a document JSON file (as written by exportDocJSON) and open it as a new Screens project, Knowledge hub included. */
export function openDocJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const d = JSON.parse(await file.text()) as Doc;
      if (!d || typeof d.nodes !== "object" || !Array.isArray(d.roots)) throw new Error("not a document");
      const name = file.name.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim() || "Imported document";
      await goToProject(await createProject("screens", name.slice(0, 80), {}, d));
    } catch {
      feedback("That file isn't a Qalam Studio document JSON.", { kind: "error" });
    }
  };
  input.click();
}
