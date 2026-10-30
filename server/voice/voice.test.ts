import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VoiceLine } from "@/voice/model";
import { voiceRoutes } from "../routes/voice";

// A stand-in for native/voice: answers check, and listens until "stop" (the words) or "cancel".
const HELPER = `#!/usr/bin/env node
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const cmd = process.argv[2];
if (cmd === "check") { say({ t: "check", apple: { available: process.env.FAKE_APPLE !== "0", ready: true }, mic: "granted" }); process.exit(0); }
if (cmd === "listen") {
  say({ t: "ready" });
  say({ t: "level", v: 0.4 });
  say({ t: "partial", text: "Boat owners want" });
  let rest = "";
  process.stdin.on("data", (d) => {
    rest += d;
    if (rest.includes("stop")) { say({ t: "final", text: "Boat owners want to book online." }); process.exit(0); }
    if (rest.includes("cancel")) { say({ t: "cancelled" }); process.exit(0); }
  });
  process.stdin.on("end", () => { say({ t: "cancelled" }); process.exit(0); });
}
`;

let dir: string;
const api = voiceRoutes();
const call = (method: string, url: string, body?: unknown, signal?: AbortSignal) => api.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal });

/** The lines of a listen, `act` run once it's ready. */
async function listened(act: (signal: AbortController) => void): Promise<VoiceLine[]> {
  const ctrl = new AbortController();
  const res = await call("POST", "/api/voice/listen", undefined, ctrl.signal);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const out: VoiceLine[] = [];
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (done) break;
    rest += value;
    for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) {
      const l = JSON.parse(rest.slice(0, i)) as VoiceLine;
      rest = rest.slice(i + 1);
      out.push(l);
      if (l.t === "ready") act(ctrl);
    }
  }
  return out;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-voice-"));
  const bin = path.join(dir, "qalam-voice");
  await writeFile(bin, HELPER);
  await chmod(bin, 0o755);
  process.env.QALAM_VOICE_BIN = bin;
  process.env.QALAM_HOME = path.join(dir, "home");
});

afterAll(async () => {
  delete process.env.QALAM_VOICE_BIN;
  await rm(dir, { recursive: true, force: true });
});

// Its stand-in is a script with a shebang, which Windows can't start.
describe.skipIf(process.platform === "win32")("talking instead of typing", () => {
  it("uses Apple's engine where the Mac has it, until they choose otherwise", async () => {
    expect(await (await call("GET", "/api/voice?fresh=1")).json()).toMatchObject({ here: true, chosen: null, use: "apple", mic: "granted" });
    expect(await (await call("PUT", "/api/voice", { use: "own" })).json()).toMatchObject({ chosen: "own", use: null });
    expect((await call("PUT", "/api/voice", { use: "loud" })).status).toBe(400);
    // Their own dictation app: no mic, so nothing listens.
    expect((await call("POST", "/api/voice/listen")).status).toBe(409);
    await call("PUT", "/api/voice", { use: "apple" });
  });

  it("listens until Stop, and keeps the words", async () => {
    const lines = await listened(() => void call("POST", "/api/voice/stop"));
    expect(lines.map((l) => l.t)).toEqual(["ready", "level", "partial", "final"]);
    expect(lines.at(-1)).toEqual({ t: "final", text: "Boat owners want to book online." });
  });

  it("drops the words when the window lets go", async () => {
    const lines = await listened((ctrl) => ctrl.abort());
    expect(lines.some((l) => l.t === "final")).toBe(false);
    expect(await (await call("POST", "/api/voice/stop")).json()).toEqual({ stopped: false });
  });
});
