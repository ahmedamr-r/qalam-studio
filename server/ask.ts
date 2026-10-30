import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { ASK_PACKED_SYSTEM, ASK_SYSTEM, askSchema } from "@/ai/ask";
import { childEnv } from "@/ai/cli";
import { bin, modelOf } from "@/ai/engine";
import { backend, structured } from "@/ai/server";
import { fromCliResult, reportUsage } from "@/ai/usage";
import { sourcesIn, verifyAnswer, type AskAnswer, type Found } from "@/hub/ask";
import { sectionCounts } from "@/hub/topics";
import { goalsText } from "@/goals/text";
import { contextText, readFrontMatter } from "@/org/context-md";
import { orgHref, projectHref, seenHref, topicHref } from "@/projects/model";
import type { OrgIndex, PieceRow } from "./index/indexer";
import { indexFor } from "./index/registry";
import { packFor, search } from "./index/search";
import { serveMcp, type McpTool } from "./mcp";
import { inside } from "./org/fsx";
import { GOALS, type OrgStore } from "./org/store";
import { promptArgs, spawnCli } from "@/ai/commands";

/**
 * Ask the organization: a product team's question, answered from what the organization knows.
 * On Claude Code (AI_BACKEND=cli) Qalam AI digs on its own, in the organization's folder: its
 * search as MCP tools (server/mcp.ts) and read-only Read, Grep and Glob, confined to the folder
 * (--restricted, nothing that runs code, no web). With an API key it gets one call with the
 * organization's knowledge for the question packed in. Either way code checks the answer
 * (src/hub/ask.ts): every quote found word for word in the piece or file it names.
 */

const TIME_LIMIT_MS = 240_000;
const MAX_FILE = 2_000_000;

export interface AskRequest {
  question: string;
  /** The product in view on the home (none: the whole organization). */
  product?: string | null;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function indexOf(store: OrgStore): OrgIndex | null {
  try {
    return indexFor(store);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What a piece or a file is, for people, and where it opens

function pieceFound(store: OrgStore, row: PieceRow, sourceText: string | null, boardsOf: (source: string) => string[]): Found {
  const org = store.info.id;
  const board = (id: string, card?: string | null) => `${projectHref({ id, type: "discovery" }, org)}${card ? `?card=${encodeURIComponent(card)}` : ""}`;
  const onBoard = row.source ? boardsOf(row.source)[0] : undefined;
  const href =
    row.type === "page"
      ? topicHref(row.ref.split(":")[2], org)
      : row.sub === "screen" || row.sub === "flow"
        ? seenHref(row.ref.split(":")[2], { org })
      : (row.type === "quote" || row.type === "need") && row.source && onBoard
        ? `${board(onBoard)}?source=${encodeURIComponent(row.source)}`
        : row.board
          ? board(row.board, row.card)
          : undefined;
  const label =
    row.type === "quote"
      ? [row.speaker, row.title].filter(Boolean).join(" · ") || "A quote"
      : row.type === "page"
        ? `Topic page: ${row.title ?? ""}`
        : row.type === "decision"
          ? `Decision: ${row.title ?? ""}`
          : row.type === "card"
            ? `“${row.title ?? ""}” on ${store.getProject(row.board ?? "")?.record.name ?? "a board"}`
            : row.type === "need"
              ? `A need in ${row.title ?? "a source"}`
              : row.sub === "screen"
                ? `Screen: ${row.title ?? ""}`
                : row.sub === "flow"
                  ? `Flow: ${row.title ?? ""}`
                  : (row.title ?? row.type);
  return { text: sourceText ? `${row.text}\n${sourceText}` : row.text, label, ...(href ? { href } : {}) };
}

function fileFound(store: OrgStore, rel: string, text: string, boardsOf: (source: string) => string[]): Found {
  const org = store.info.id;
  const parts = rel.split(path.sep);
  const front = rel.endsWith(".md") ? readFrontMatter(text.replace(/\r\n/g, "\n")).fields : {};
  if (parts[0] === "sources" && rel.endsWith(".md") && typeof front.id === "string") {
    const board = boardsOf(front.id)[0];
    return { text, label: typeof front.title === "string" ? front.title : rel, ...(board ? { href: `${projectHref({ id: board, type: "discovery" }, org)}?source=${encodeURIComponent(front.id)}` } : {}) };
  }
  if (parts[0] === "hub" && parts[1] === "topics") {
    const title = /^# +(.*)$/m.exec(text)?.[1]?.trim();
    return { text, label: `Topic page: ${title ?? rel}`, ...(typeof front.id === "string" ? { href: topicHref(front.id, org) } : {}) };
  }
  if (parts[0] === "hub" && parts[1] === "seen" && rel.endsWith(".md")) {
    const key = path.basename(rel, ".md");
    return { text, label: /^# +(.*)$/m.exec(text)?.[1]?.trim() ?? rel, href: seenHref(key, { org }) };
  }
  if (parts[0] === "boards" && rel.endsWith(".json")) {
    try {
      const b = JSON.parse(text) as { id?: string; name?: string };
      return { text, label: b.name ?? rel, ...(b.id ? { href: projectHref({ id: b.id, type: "discovery" }, org) } : {}) };
    } catch {
      return { text, label: rel };
    }
  }
  if (parts[0] === "decisions") return { text, label: `Decisions, ${path.basename(rel, ".md")}`, href: `${orgHref(org)}?tab=decisions` };
  if (parts[0] === "products") return { text, label: typeof front.name === "string" ? front.name : rel };
  if (rel === "about.md") return { text, label: `About ${store.info.name}` };
  return { text, label: rel };
}

/** Each source an answer names, looked up: a piece in the index, or a text file in the folder (not its index). */
async function lookUp(store: OrgStore, ix: OrgIndex | null, sources: string[]): Promise<Map<string, Found>> {
  const out = new Map<string, Found>();
  const all = await store.listSources();
  const boardsOf = (id: string) => (all.find((s) => s.id === id)?.boards ?? []).filter((b) => store.getProject(b));
  for (const source of sources) {
    if (source.startsWith("hub:")) {
      const row = ix?.piecesByRef([source]).get(source);
      if (!row) continue;
      // A quote's words may run on in its source: the source's text counts too.
      const text = row.type === "quote" && row.source ? (all.find((s) => s.id === row.source)?.text ?? null) : null;
      out.set(source, pieceFound(store, row, text, boardsOf));
      continue;
    }
    const abs = path.isAbsolute(source) ? (source.startsWith(store.dir + path.sep) ? source : null) : inside(store.dir, source.replace(/^\.\//, ""));
    if (!abs) continue;
    const rel = path.relative(store.dir, abs);
    if (rel.split(path.sep)[0] === ".qalam") continue;
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile() || st.size > MAX_FILE) continue;
    out.set(source, fileFound(store, rel, await readFile(abs, "utf8"), boardsOf));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The guide: what the folder holds, and what search finds for the question first

interface Guide {
  text: string;
  /** Topic pages by the names an answer may use for them (their file, their id). */
  topicId: (name: string) => string | null;
  topicFiles: string[];
}

async function guide(store: OrgStore, q: AskRequest): Promise<Guide> {
  const products = await store.listProducts();
  const name = (id: string | null | undefined) => (id ? (products.find((p) => p.id === id)?.name ?? id) : "the whole organization");
  const topics = await store.listTopics();
  const out: string[] = ["The organization:", contextText(await store.getAbout(), `${store.info.name}:`) || `${store.info.name} (not described yet)`, ...products.map((p) => contextText(p, `${p.name} (a product):`)).filter(Boolean)];
  const aims = goalsText(await store.getGoals(), { productName: (id) => products.find((p) => p.id === id)?.name, label: `Goals (in ${GOALS})` });
  if (aims) out.push("", aims);
  if (q.product) out.push("", `The team is looking at ${name(q.product)}.`);
  if (topics.length) {
    out.push("", "Topic pages (file · kind · title · what's on it):");
    for (const t of topics) {
      const c = sectionCounts(t);
      out.push(`- ${t.file} · ${t.kind} · ${one(t.title)} · ${[`${c.know} known`, `${c.believe} believed`, `${c.against} against`, `${c.open} open`].join(", ")}`);
    }
  }
  const boards = store.listProjects().filter((p) => p.type === "discovery");
  if (boards.length) out.push("", "Boards (file · name · for):", ...boards.map((b) => `- ${store.projectFile(b.id)} · ${one(b.name)} · ${name(b.product)}`));
  const sources = await store.listSources();
  if (sources.length) out.push("", "Sources (file · title · kind · quotes picked out):", ...sources.map((s) => `- ${store.sourceFile(s.id)} · ${one(s.title)} · ${s.kind} · ${s.quotes.length}`));
  const months = store.decisionFiles();
  if (months.length) out.push("", `Decisions: ${months.join(", ")}`);
  const seen = await store.listSeen();
  if (seen.length) out.push("", "What people see (file · for · screens · flows):", ...seen.map((m) => `- hub/seen/${m.key}.md · ${name(m.product)} · ${m.screens.length} · ${m.flows.map((f) => one(f.name)).join(", ") || "no flow yet"}`));
  const byName = new Map<string, string>();
  for (const t of topics) {
    byName.set(t.file, t.id);
    byName.set(t.id, t.id);
  }
  return { text: out.join("\n"), topicId: (n) => byName.get(n) ?? null, topicFiles: topics.map((t) => t.file) };
}

/** A piece as the tools and the guide show it: its ref, what it is, its words. */
const pieceText = (p: PieceRow) => `${p.ref}\n  ${one(p.line)}\n  ${clip(one(p.text), 600)}`;

// ---------------------------------------------------------------------------
// The organization's tools (MCP), for Claude Code

function orgTools(store: OrgStore, ix: OrgIndex | null, product: string | null | undefined): McpTool[] {
  const num = (v: unknown, d: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : d);
  return [
    {
      name: "search",
      description: "Search the organization's knowledge by words, meaning and links: customers' quotes, the needs seen in sources, cards on boards, assumptions, decisions, topic page lines, what its products are, and their screens and flows from screenshots. Returns each piece's ref (cite it as a source), what it is and where it's from, and its words.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for, in plain words" }, limit: { type: "number", description: "At most this many pieces (default 12)" } }, required: ["query"] },
      run: async (a) => {
        if (!ix) return "Search isn't available here: use Grep over the files.";
        const { hits } = await search(ix, { query: String(a.query ?? ""), product, limit: num(a.limit, 12, 30) });
        return hits.length ? hits.map(pieceText).join("\n\n") : "Nothing found. Try other words, or Grep the files.";
      },
    },
    {
      name: "get",
      description: "One piece by its ref: its words, what it is, and the pieces it links to (the card a quote backs, the quotes a need shows, what a topic page line cites, the card a decision is about).",
      inputSchema: { type: "object", properties: { ref: { type: "string", description: "A piece's ref, as search gave it (hub:…)" } }, required: ["ref"] },
      run: async (a) => {
        const ref = String(a.ref ?? "");
        const row = ix?.piecesByRef([ref]).get(ref);
        if (!row) return `No piece ${ref}.`;
        const links = ix!.links(ref).filter((l) => !/^hub:(source|board):/.test(l.ref) && !/^hub:topic:[^:]+$/.test(l.ref));
        const near = ix!.piecesByRef(links.map((l) => l.ref));
        const linked = links.flatMap((l) => {
          const p = near.get(l.ref);
          return p ? [`- ${l.out ? l.kind : `${l.kind} (from it)`}: ${p.ref} · ${clip(one(p.title ?? p.text), 120)}`] : [];
        });
        return `${pieceText(row)}${linked.length ? `\nLinked:\n${linked.join("\n")}` : ""}`;
      },
    },
    {
      name: "decisions",
      description: "What the team decided on its boards, newest first: what, why, when and on which board, each with its ref. Optionally only those that mention some words.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Words a decision mentions (optional)" }, limit: { type: "number", description: "At most this many (default 20)" } } },
      run: async (a) => {
        const words = String(a.query ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        const list = store.listDecisions().filter((d) => !d.undone && (!words.length || words.some((w) => `${d.what} ${d.why ?? ""} ${d.cardTitle}`.toLowerCase().includes(w))));
        if (!list.length) return "No decisions found.";
        return list
          .slice(0, num(a.limit, 20, 60))
          .map((d) => `hub:decision:${d.id} · ${new Date(d.at).toISOString().slice(0, 10)} · ${d.boardName}\n  ${one(d.what)}${d.why ? `\n  Why: ${one(d.why)}` : ""}`)
          .join("\n\n");
      },
    },
  ];
}

const TOOL_LABEL: Record<string, (a: Record<string, unknown>) => string> = {
  search: (a) => `Searching “${clip(String(a.query ?? ""), 60)}”`,
  get: () => "Following a piece's links",
  decisions: (a) => (a.query ? `Reading decisions about “${clip(String(a.query), 50)}”` : "Reading the decisions"),
};

// ---------------------------------------------------------------------------
// Claude Code, in the organization's folder

function viaAgent(store: OrgStore, ix: OrgIndex | null, q: AskRequest, g: Guide, emit: (label: string) => void, signal: AbortSignal): Promise<{ raw: unknown; model?: string }> {
  return (async () => {
    const mcp = await serveMcp("qalam", orgTools(store, ix, q.product), (tool, args) => emit(TOOL_LABEL[tool]?.(args) ?? tool));
    try {
      const first = ix ? (await search(ix, { query: q.question, product: q.product, limit: 12 })).hits : [];
      const content = [g.text, ...(first.length ? ["", "What the organization's search finds for the question first:", ...first.map(pieceText)] : []), "", `The question: ${q.question}`].join("\n");
      const asked = modelOf("ask");
      return await new Promise<{ raw: unknown; model?: string }>((resolve, reject) => {
        const prompt = promptArgs(ASK_SYSTEM);
        const args = [
          "-p",
          "--input-format", "stream-json",
          "--output-format", "stream-json",
          "--verbose",
          "--json-schema", JSON.stringify(askSchema({ topics: g.topicFiles })),
          ...prompt.args,
          "--model", asked,
          "--effort", "medium",
          // Read-only, inside the organization's folder: no shell, no web, no edits.
          "--tools", "Read,Grep,Glob",
          "--allowedTools", "Read", "Grep", "Glob", "mcp__qalam",
          "--restricted",
          "--permission-mode", "dontAsk",
          "--permission-prompts", "none",
          "--setting-sources", "",
          "--strict-mcp-config",
          "--mcp-config", mcp.config,
          "--disable-slash-commands",
          "--no-session-persistence",
        ];
        const proc = spawnCli(bin(), args, { cwd: store.dir, env: childEnv(16000) });
        proc.on("close", prompt.done);
        const limit = AbortSignal.timeout(TIME_LIMIT_MS);
        const both = AbortSignal.any([signal, limit]);
        const kill = () => proc.kill();
        both.addEventListener("abort", kill, { once: true });
        proc.on("error", (e) => reject(new Error(`Couldn't start Claude Code (${e.message}). Install Claude Code or set CLAUDE_CLI_PATH.`)));
        proc.stdin.on("error", () => {});
        proc.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: content } })}\n`);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
        let model: string | undefined;
        let result: { subtype: string; is_error?: boolean; result?: string; structured_output?: unknown; errors?: string[] } | undefined;
        const rel = (f: unknown) => (typeof f === "string" ? path.relative(store.dir, path.resolve(store.dir, f)) || "the folder" : "a file");
        createInterface({ input: proc.stdout }).on("line", (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "system" && ev.subtype === "init") model = ev.model ?? model;
          else if (ev.type === "assistant")
            for (const b of ev.message?.content ?? []) {
              if (b.type !== "tool_use") continue;
              if (b.name === "Read") emit(`Reading ${rel(b.input?.file_path)}`);
              else if (b.name === "Grep") emit(`Looking for “${clip(String(b.input?.pattern ?? ""), 50)}” in the files`);
              else if (b.name === "Glob") emit(`Listing ${String(b.input?.pattern ?? "files")}`);
            }
          else if (ev.type === "result") result = ev;
        });
        proc.on("close", (code) => {
          both.removeEventListener("abort", kill);
          reportUsage(fromCliResult(result as Parameters<typeof fromCliResult>[0], model ?? asked, "ask"));
          if (signal.aborted) return reject(new DOMException("Stopped.", "AbortError"));
          if (limit.aborted) return reject(new Error("Qalam AI took too long to answer. Try a narrower question."));
          if (!result) return reject(new Error(stderr.trim() || `Claude Code exited with code ${code}.`));
          if (result.is_error || result.subtype !== "success") return reject(new Error(result.result || result.errors?.join("; ") || result.subtype));
          let raw = result.structured_output;
          if (raw == null) {
            const text = result.result ?? "";
            try {
              raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
            } catch {
              return reject(new Error("Qalam AI's answer wasn't in the shape asked for."));
            }
          }
          resolve({ raw, model });
        });
      });
    } finally {
      await mcp.close();
    }
  })();
}

// ---------------------------------------------------------------------------
// An API key: one call, with the organization's knowledge for the question packed in

async function viaPacked(ix: OrgIndex, q: AskRequest, g: Guide): Promise<{ raw: unknown; model?: string }> {
  const p = await packFor(ix, { query: q.question, product: q.product, budget: 12_000, wholeTop: 40 });
  const { data, model } = await structured<Record<string, unknown>>({
    kind: "ask",
    system: ASK_PACKED_SYSTEM,
    schema: askSchema({ sources: p.items.map((i) => i.k), topics: g.topicFiles }),
    effort: "high",
    maxTokens: 12_000,
    content: [{ type: "text", text: [g.text, "", "The organization's knowledge for the question (each piece under its id):", `<organization>\n${p.block}\n</organization>`, "", `The question: ${q.question}`].join("\n") }],
  });
  // Ids back to the pieces they stand for, so the answer is checked like the agent's.
  const refOf = new Map(p.items.map((i) => [i.k, i.ref]));
  const claims = Array.isArray(data?.claims) ? (data.claims as Record<string, unknown>[]) : [];
  for (const c of claims) for (const s of Array.isArray(c?.support) ? (c.support as Record<string, unknown>[]) : []) if (typeof s?.source === "string") s.source = refOf.get(s.source.replace(/^\[|\]$/g, "")) ?? s.source;
  return { raw: data, model };
}

/** Answer a question from what the organization knows, checked by code. `emit` hears what Qalam AI is doing. */
export async function askOrg(store: OrgStore, q: AskRequest, o: { emit: (label: string) => void; signal: AbortSignal }): Promise<AskAnswer> {
  const ix = indexOf(store);
  if (ix) await ix.settled();
  o.emit("Reading the organization's guide");
  const g = await guide(store, q);
  const agent = backend() === "cli";
  if (!agent && !ix) throw new Error("Asking needs the organization's search index (Node 24 or the desktop app).");
  const { raw, model } = agent ? await viaAgent(store, ix, q, g, o.emit, o.signal) : await viaPacked(ix!, q, g);
  o.emit("Checking every quote");
  const found = await lookUp(store, ix, sourcesIn(raw));
  return verifyAnswer(raw, found, { question: q.question, how: agent ? "agent" : "packed", at: Date.now(), model, topic: g.topicId });
}
