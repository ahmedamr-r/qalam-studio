import type { FoundIn, LookResult, ToolRun } from "@/connectors/everywhere";
import type { Hit } from "@/connectors/recipes";
import type { ToolAsk } from "@/connectors/suggest";
import { NoOrgYet, orgPath } from "./client";
import type { ImportResult } from "./connectors";

/*
 * Looking in every connected tool at once, from the window (server/connectors/everywhere.ts): the
 * look (a line per tool as it goes), bringing the ticked ones in, and, under a question, what every
 * tool its kind fits has on it with no model call.
 */

export type Brought = ImportResult & { sources: string[]; pages: string[] };

/** An NDJSON answer: each line to `on` until the result comes (or the error, thrown). */
async function lines<T>(res: Response, on: (m: { type: string } & Record<string, unknown>) => void): Promise<T> {
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const m = JSON.parse(line) as { type: string; data?: T; message?: string } & Record<string, unknown>;
      if (m.type === "result" && m.data) return m.data;
      if (m.type === "error") throw new Error(m.message ?? "It stopped.");
      on(m);
    }
  }
  throw new Error("It stopped before saying how it went.");
}

const post = (path: string, body: unknown, signal?: AbortSignal) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

export const everywhereDb = {
  /** Every connected tool searched for it, side by side; `onRun` hears each tool as it goes. Nothing is taken in. */
  look: async (about: string, o: { tools?: string[]; onRun?: (r: ToolRun) => void; signal?: AbortSignal } = {}) =>
    lines<LookResult>(await post(await orgPath("/everywhere"), { about, ...(o.tools ? { tools: o.tools } : {}) }, o.signal), (m) => {
      if (m.type === "tool" && m.run) o.onRun?.(m.run as ToolRun);
    }),
  /** The ticked ones taken in (`scope`: only under a card; {}: nowhere), as the canvas's product's (null: the organization's). */
  bring: async (picks: { tool: string; hit: Hit }[], o: { scope?: Record<string, string[]>; product?: string | null; onActivity?: (label: string) => void } = {}) =>
    lines<Brought>(await post(await orgPath("/everywhere/bring"), { picks, ...(o.scope ? { scope: o.scope } : {}), ...(o.product !== undefined ? { product: o.product } : {}) }), (m) => {
      if (m.type === "activity" && typeof m.label === "string") o.onActivity?.(m.label);
    }),
  /** Under a question: what every tool its kind fits has on it, searched with its words. */
  words: async (ask: ToolAsk, question: string): Promise<FoundIn[]> => {
    let path: string;
    try {
      path = await orgPath("/everywhere/words");
    } catch (e) {
      if (!(e instanceof NoOrgYet)) throw e;
      path = "/api/everywhere/words";
    }
    const res = await post(path, { kind: ask.kind, words: ask.lookFor ?? "", question });
    const j = (await res.json().catch(() => null)) as { found?: FoundIn[]; message?: string } | null;
    if (!res.ok || !j?.found) throw new Error(j?.message ?? `Qalam couldn't answer (${res.status})`);
    return j.found;
  },
};
