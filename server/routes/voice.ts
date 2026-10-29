import { Hono } from "hono";
import type { VoiceChoice, VoiceLine } from "@/voice/model";
import { chooseVoice, forgetParakeet, installVoice, listen, stopListening, voiceView } from "../voice";
import { parakeetSize } from "../voice/parakeet";

const CHOICES: readonly VoiceChoice[] = ["apple", "parakeet", "own", "off"];

/** The helper's lines to the window as NDJSON, as they come; the request's end tells the work to stop. */
function lineStream(request: AbortSignal, work: (signal: AbortSignal, send: (l: VoiceLine) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stop = new AbortController();
  request.addEventListener("abort", () => stop.abort());
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (l: VoiceLine) => {
        if (open) ctrl.enqueue(enc.encode(`${JSON.stringify(l)}\n`));
      };
      try {
        await work(stop.signal, send);
      } catch (e) {
        send({ t: "error", code: "failed", message: e instanceof Error ? e.message : String(e) });
      }
      if (open) ctrl.close();
      open = false;
    },
    cancel() {
      open = false;
      stop.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/** Talking instead of typing: what this Mac has and what they chose, fetching an engine, and listening (server/voice). */
export function voiceRoutes(): Hono {
  const r = new Hono();
  r.get("/api/voice", async (c) => c.json(await voiceView(c.req.query("fresh") === "1")));
  r.put("/api/voice", async (c) => {
    const { use } = (await c.req.json().catch(() => ({}))) as { use?: unknown };
    if (!CHOICES.includes(use as VoiceChoice)) return c.json({ error: "bad_request", message: "Pick apple, parakeet, own or off." }, 400);
    return c.json(await chooseVoice(use as VoiceChoice));
  });
  r.post("/api/voice/install", async (c) => {
    const { engine } = (await c.req.json().catch(() => ({}))) as { engine?: unknown };
    if (engine !== "apple" && engine !== "parakeet") return c.json({ error: "bad_request", message: "Pick apple or parakeet." }, 400);
    return lineStream(c.req.raw.signal, async (signal, send) => {
      await installVoice(engine, send, signal);
      send({ t: "done" });
    });
  });
  // Parakeet's download, as Hugging Face lists it today (asked only where it's offered), and taking it off.
  r.get("/api/voice/parakeet", async (c) => {
    try {
      return c.json({ size: await parakeetSize() });
    } catch (e) {
      return c.json({ error: "unreachable", message: e instanceof Error ? e.message : String(e) }, 502);
    }
  });
  r.delete("/api/voice/parakeet", async (c) => c.json(await forgetParakeet()));
  r.post("/api/voice/listen", async (c) => {
    const view = await voiceView();
    if (!view.use) return c.json({ error: "no_voice", message: "Voice isn't on for this Mac. Turn it on in Connections." }, 409);
    return lineStream(c.req.raw.signal, (signal, send) => listen(view.use!, signal, send));
  });
  r.post("/api/voice/stop", (c) => c.json({ stopped: stopListening() }));
  return r;
}
