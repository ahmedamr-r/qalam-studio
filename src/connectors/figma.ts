import type { ToolCall } from "./recipes";

/*
 * A Figma frame as the picture of a funnel step (pure): the frame a link names, the call asking
 * Figma's MCP server (the one the user's Claude Code has) for its picture, and where Figma's answer
 * says the PNG is. Figma renders the frame and answers with a short-lived address; Qalam fetches
 * only from Figma's own hosts and keeps the bytes only when they are a picture. Written from
 * Figma's tool description, not yet checked against a real answer.
 */

export interface FigmaFrame {
  fileKey: string;
  /** As Figma's tools take it: "12:34". */
  nodeId: string;
  /** The frame's link, without what only says how it was opened. */
  url: string;
}

const FILE_KEY = /^[0-9a-zA-Z]{22,128}$/;

/** The frame a figma.com link names (a design's, a file's or a prototype's), or null. A branch's link names the branch. */
export function figmaFrame(raw: string): FigmaFrame | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^(www\.)?figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!["design", "file", "proto"].includes(parts[0] ?? "")) return null;
  const fileKey = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  const nodeId = (u.searchParams.get("node-id") ?? "").replace("-", ":");
  if (!fileKey || !FILE_KEY.test(fileKey) || !/^\d+:\d+$/.test(nodeId)) return null;
  return { fileKey, nodeId, url: `https://www.figma.com${u.pathname}?node-id=${nodeId.replace(":", "-")}` };
}

/** The picture's longer edge: enough to read a phone screen, small enough to keep. */
export const SHOT_SIZE = 1600;

/** The call: the frame's picture, as an address (the tool's default) rather than inline. */
export const figmaShot = (f: FigmaFrame): ToolCall => ({ tool: "get_screenshot", args: { fileKey: f.fileKey, nodeId: f.nodeId, maxDimension: SHOT_SIZE }, match: ["fileKey", "nodeId"] });

/** Hosts Figma serves rendered pictures from: its own, and its buckets. */
export function figmaImageHost(host: string): boolean {
  const h = host.toLowerCase();
  return /(^|\.)figma\.com$/.test(h) || /(^|\.)figmausercontent\.com$/.test(h) || /^figma-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com$/.test(h);
}

/** Where Figma's answer says the picture is: an address on its hosts that isn't a link to a file. Null when there's none. */
export function shotUrl(answer: string): string | null {
  const text = answer.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  const found: URL[] = [];
  for (const m of text.matchAll(/https:\/\/[^\s"'<>`)\]\\]+/g)) {
    try {
      const u = new URL(m[0].replace(/[.,;:]+$/, ""));
      const file = /^(www\.)?figma\.com$/.test(u.hostname) && /^\/(design|file|proto|board|slides|make)\//.test(u.pathname);
      if (figmaImageHost(u.hostname) && !file) found.push(u);
    } catch {
      // Not an address.
    }
  }
  return (found.find((u) => /\.(png|jpe?g|webp)$/i.test(u.pathname)) ?? found[0])?.href ?? null;
}

/** What the bytes are, by their first bytes (a server's content type isn't trusted): a PNG, a JPEG or a WebP, or null. */
export function pictureType(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
