import { figmaFrame, figmaImageHost, figmaShot, pictureType, shotUrl, type FigmaFrame } from "@/connectors/figma";
import { readSettings } from "../settings";
import { runTools } from "./claude-code";

/*
 * A Figma frame's picture, through the Figma server the user's Claude Code has: the tool-runner
 * makes the one call code planned, code finds the picture's address in Figma's answer, and the
 * core fetches it from Figma's hosts only. Figma renders it; Qalam never draws a screen.
 */

/** Pictures larger than this are refused (a screen at 1600px is well under it). */
const MAX_BYTES = 12 * 1024 * 1024;
const FETCH_MS = 30_000;

async function server(): Promise<string> {
  const via = (await readSettings()).connectors?.figma;
  if (via?.via !== "claude-code") throw new Error("Use Figma through Claude Code in Connections first.");
  return via.server;
}

export interface FramePicture {
  frame: FigmaFrame;
  bytes: Uint8Array;
  type: string;
}

/** The picture of the frame a link names. Throws, in words, why not. */
export async function figmaPicture(link: string, o: { signal?: AbortSignal; fetch?: typeof fetch; run?: typeof runTools } = {}): Promise<FramePicture> {
  const frame = figmaFrame(link);
  if (!frame) throw new Error("That isn't a link to one frame: in Figma, right-click the frame and copy its link.");
  const [answer] = await (o.run ?? runTools)(await server(), [figmaShot(frame)], o.signal);
  if (answer === null) throw new Error("Figma didn't answer through Claude Code. Is it signed in there, and can you open that file?");
  const at = shotUrl(answer);
  if (!at) throw new Error("Figma answered without a picture of that frame.");
  const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(FETCH_MS)]) : AbortSignal.timeout(FETCH_MS);
  const res = await (o.fetch ?? fetch)(at, { signal, redirect: "follow" });
  // Where it ended up, after any redirect, must still be Figma's.
  if (res.url && !figmaImageHost(new URL(res.url).hostname)) throw new Error(`Figma sent the picture from ${new URL(res.url).hostname}, which Qalam doesn't fetch from.`);
  if (!res.ok) throw new Error(`Figma's picture didn't come (${res.status}).`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Figma's picture is too large to keep.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("Figma's picture is too large to keep.");
  const type = pictureType(bytes);
  if (!type) throw new Error("What Figma sent isn't a picture.");
  return { frame, bytes, type };
}
