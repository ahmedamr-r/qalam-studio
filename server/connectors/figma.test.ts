import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCall } from "@/connectors/recipes";
import { writeSettings } from "../settings";
import { figmaPicture } from "./figma";

const KEY = "AbCdEfGhIjKlMnOpQrStUv12";
const LINK = `https://www.figma.com/design/${KEY}/Checkout?node-id=12-34&t=x`;
const SHOT = "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abc?X-Amz-Signature=1";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const ran: { server: string; calls: ToolCall[] }[] = [];
const runWith = (answer: string | null) => async (server: string, calls: ToolCall[]) => (ran.push({ server, calls }), calls.map(() => answer));
const fetched: string[] = [];
const fetchWith = (body: Uint8Array, o: { status?: number; url?: string } = {}) =>
  (async (url: string) => {
    fetched.push(url);
    const res = new Response(Buffer.from(body), { status: o.status ?? 200, headers: { "content-type": "binary/octet-stream" } });
    Object.defineProperty(res, "url", { value: o.url ?? url });
    return res;
  }) as unknown as typeof fetch;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-figma-"));
  process.env.QALAM_HOME = dir;
  ran.length = 0;
  fetched.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a step's picture from a Figma frame, through Claude Code", () => {
  it("asks to use Figma through Claude Code first, and takes only a link to one frame", async () => {
    await expect(figmaPicture(LINK, { run: runWith("") })).rejects.toThrow(/Connections/);
    await writeSettings({ connectors: { figma: { via: "claude-code", server: "figma" } } });
    await expect(figmaPicture(`https://www.figma.com/design/${KEY}/Checkout`, { run: runWith("") })).rejects.toThrow(/one frame/);
    expect(ran).toEqual([]);
  });

  it("makes the one call on Figma's server, fetches the picture from Figma's host, and keeps it by its bytes", async () => {
    await writeSettings({ connectors: { figma: { via: "claude-code", server: "figma" } } });
    const got = await figmaPicture(LINK, { run: runWith(`Saved. curl -o s.png "${SHOT}"`), fetch: fetchWith(PNG) });
    expect(ran).toEqual([{ server: "figma", calls: [{ tool: "get_screenshot", args: { fileKey: KEY, nodeId: "12:34", maxDimension: 1600 }, match: ["fileKey", "nodeId"] }] }]);
    expect(fetched).toEqual([SHOT]);
    expect(got).toMatchObject({ frame: { url: `https://www.figma.com/design/${KEY}/Checkout?node-id=12-34` }, type: "image/png" });
    expect(got.bytes).toEqual(PNG);
  });

  it("says why when Figma doesn't answer, sends no picture, or what comes isn't one", async () => {
    await writeSettings({ connectors: { figma: { via: "claude-code", server: "figma" } } });
    await expect(figmaPicture(LINK, { run: runWith(null) })).rejects.toThrow(/signed in/);
    await expect(figmaPicture(LINK, { run: runWith("No access to that file.") })).rejects.toThrow(/without a picture/);
    await expect(figmaPicture(LINK, { run: runWith(SHOT), fetch: fetchWith(new TextEncoder().encode("<Error>AccessDenied</Error>")) })).rejects.toThrow(/isn't a picture/);
    await expect(figmaPicture(LINK, { run: runWith(SHOT), fetch: fetchWith(PNG, { status: 403 }) })).rejects.toThrow(/403/);
    await expect(figmaPicture(LINK, { run: runWith(SHOT), fetch: fetchWith(PNG, { url: "https://elsewhere.test/x.png" }) })).rejects.toThrow(/elsewhere\.test/);
  });
});
