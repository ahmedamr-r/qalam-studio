import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { requester, serveRequests, type FromCore, type ToCore } from "./rpc";

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

/** A requester wired to a core that answers with `handle`, over a real message channel. */
function wire(handle: (req: Request) => Response | Promise<Response>) {
  const ch = new MessageChannel();
  channels.push(ch);
  serveRequests((cb) => ch.port2.on("message", (m: ToCore) => cb(m)), (m) => ch.port2.postMessage(m), handle);
  return requester((m) => ch.port1.postMessage(m), (cb) => ch.port1.on("message", (m: FromCore) => cb(m)));
}

describe("fetch over a port", () => {
  it("carries method, path, headers and body to the core, and the answer back", async () => {
    const seen: string[] = [];
    const core = wire(async (req) => {
      seen.push(req.method, new URL(req.url).pathname + new URL(req.url).search, req.headers.get("content-type") ?? "", await req.text());
      return Response.json({ ok: true }, { status: 201, headers: { "x-qalam": "1" } });
    });
    const res = await core.fetch(new Request("qalam://app/api/thing?x=1", { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' }));
    expect(res.status).toBe(201);
    expect(res.headers.get("x-qalam")).toBe("1");
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual(["POST", "/api/thing?x=1", "application/json", '{"a":1}']);
  });

  it("streams the body as the core writes it", async () => {
    const core = wire(() => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(c) {
          for (const line of ['{"type":"progress"}\n', '{"type":"result"}\n']) {
            c.enqueue(enc.encode(line));
            await new Promise((r) => setTimeout(r, 5));
          }
          c.close();
        },
      });
      return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    });
    const res = await core.fetch(new Request("qalam://app/api/discovery", { method: "POST", body: "{}" }));
    expect(await res.text()).toBe('{"type":"progress"}\n{"type":"result"}\n');
  });

  it("aborts the core's request when the window stops reading", async () => {
    let aborted = false;
    const core = wire((req) => {
      req.signal.addEventListener("abort", () => (aborted = true));
      const body = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new TextEncoder().encode("first\n")) });
      return new Response(body);
    });
    const res = await core.fetch(new Request("qalam://app/api/generate", { method: "POST", body: "{}" }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(aborted).toBe(true);
  });

  it("turns a core error into a failed fetch", async () => {
    const core = wire(() => {
      throw new Error("boom");
    });
    await expect(core.fetch(new Request("qalam://app/api/status"))).rejects.toThrow("boom");
  });

  it("ends everything in flight when the core goes away", async () => {
    const core = wire(() => new Promise<Response>(() => {}));
    const pending = core.fetch(new Request("qalam://app/api/status"));
    await new Promise((r) => setTimeout(r, 5));
    core.failAll("The core stopped");
    await expect(pending).rejects.toThrow("The core stopped");
  });
});
