/**
 * The desktop app has no network port: the window's /api/* requests travel to the core (a
 * background process) over a message port, and the answers stream back the same way. These two
 * ends turn that channel into an ordinary fetch: `requester` in the app's main process makes a
 * Response out of the messages, and `serveRequests` in the core answers them with the API.
 *
 * Messages are plain data so either kind of port carries them (Electron's MessagePortMain,
 * Node's MessagePort). Order on a port is kept, so a response's head always comes first.
 */

export type ToCore =
  | { t: "req"; id: number; method: string; url: string; headers: [string, string][]; body: Uint8Array<ArrayBuffer> | null }
  /** The window stopped reading (Stop, a closed page): the core aborts the request. */
  | { t: "abort"; id: number };

export type FromCore =
  | { t: "head"; id: number; status: number; headers: [string, string][] }
  | { t: "chunk"; id: number; data: Uint8Array }
  | { t: "end"; id: number }
  | { t: "fail"; id: number; message: string };

type Listen<M> = (cb: (m: M) => void) => void;
type Send<M> = (m: M) => void;

/** The core's end: answer each request with `handle`, streaming the body as it comes. */
export function serveRequests(listen: Listen<ToCore>, send: Send<FromCore>, handle: (req: Request) => Response | Promise<Response>) {
  const live = new Map<number, AbortController>();
  listen((m) => {
    if (m.t === "abort") return void live.get(m.id)?.abort();
    const ac = new AbortController();
    live.set(m.id, ac);
    void (async () => {
      try {
        const hasBody = m.body && m.body.byteLength > 0 && m.method !== "GET" && m.method !== "HEAD";
        const res = await handle(new Request(m.url, { method: m.method, headers: m.headers, body: hasBody ? m.body : undefined, signal: ac.signal }));
        send({ t: "head", id: m.id, status: res.status, headers: [...res.headers] });
        if (res.body) {
          const reader = res.body.getReader();
          ac.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            send({ t: "chunk", id: m.id, data: value });
          }
        }
        send({ t: "end", id: m.id });
      } catch (e) {
        if (!ac.signal.aborted) send({ t: "fail", id: m.id, message: e instanceof Error ? e.message : String(e) });
      } finally {
        live.delete(m.id);
      }
    })();
  });
}

interface Pending {
  resolve: (res: Response) => void;
  reject: (e: Error) => void;
  stream?: ReadableStreamDefaultController<Uint8Array>;
}

/** The main process's end: a fetch that the core answers. `failAll` ends everything in flight (the core went away). */
export function requester(send: Send<ToCore>, listen: Listen<FromCore>) {
  let seq = 0;
  const pending = new Map<number, Pending>();
  listen((m) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.t === "head") {
      const body = new ReadableStream<Uint8Array>({
        start: (c) => void (p.stream = c),
        cancel: () => {
          pending.delete(m.id);
          send({ t: "abort", id: m.id });
        },
      });
      const nullBody = m.status === 204 || m.status === 304;
      p.resolve(new Response(nullBody ? null : body, { status: m.status, headers: m.headers }));
    } else if (m.t === "chunk") p.stream?.enqueue(m.data);
    else if (m.t === "end") {
      pending.delete(m.id);
      try {
        p.stream?.close();
      } catch {
        // already cancelled by the reader
      }
    } else {
      pending.delete(m.id);
      const err = new Error(m.message);
      if (p.stream) p.stream.error(err);
      else p.reject(err);
    }
  });

  async function fetchFromCore(req: Request): Promise<Response> {
    const id = ++seq;
    const body = req.method === "GET" || req.method === "HEAD" ? null : new Uint8Array(await req.arrayBuffer());
    const url = new URL(req.url);
    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // The core sees an ordinary local http address, the same as in the browser mode.
      send({ t: "req", id, method: req.method, url: `http://localhost${url.pathname}${url.search}`, headers: [...req.headers], body });
    });
  }

  function failAll(reason: string) {
    for (const [id, p] of pending) {
      pending.delete(id);
      const err = new Error(reason);
      if (p.stream) p.stream.error(err);
      else p.reject(err);
    }
  }

  return { fetch: fetchFromCore, failAll };
}
