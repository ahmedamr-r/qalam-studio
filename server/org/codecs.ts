import type { Doc } from "@/doc/schema";
import type { OstCard } from "@/discovery/types";
import type { SourceRecord } from "@/discovery/sources";
import type { Project } from "@/projects/model";
import { contentHash, stableStringify } from "./fsx";

/**
 * How each thing Qalam keeps becomes a readable file, and back, without losing anything.
 *
 * A project is one JSON file: its record, then its document under `doc`. A Discovery board also
 * lifts its cards out of the canvas nodes into `cards` (node id → card), so the tree reads at the
 * top of the file and the geometry stays below. Fields that only matter on this computer (when it
 * was last opened, its thumbnail, the frame count) live in .qalam/local instead, out of Git.
 *
 * A source is two files: the verbatim text as Markdown (quotes point into it by character
 * offset, so nothing else goes in the body), and the rest as JSON beside it.
 */

export const PROJECT_FILE = "project/1";
export const SOURCE_FILE = "source/1";

/** Record fields kept on this computer only. */
export const LOCAL_FIELDS = ["openedAt", "thumbnail", "summary"] as const;
export type LocalFields = Partial<Pick<Project, (typeof LOCAL_FIELDS)[number]>>;

export const isLocalField = (k: string): k is (typeof LOCAL_FIELDS)[number] => (LOCAL_FIELDS as readonly string[]).includes(k);

/** The record without its local fields, and the local fields. */
export function splitLocal(p: Project): { record: Project; local: LocalFields } {
  const record = { ...p };
  const local: LocalFields = {};
  for (const k of LOCAL_FIELDS) {
    if (record[k] !== undefined) (local as Record<string, unknown>)[k] = record[k];
    delete record[k];
  }
  return { record, local };
}

export const recordVersion = (record: Project) => contentHash(stableStringify(splitLocal(record).record));
export const docVersion = (doc: Doc | null) => (doc ? contentHash(stableStringify(doc)) : "none");

type NodeWithMeta = { meta?: Record<string, unknown> };
type Node = Doc["nodes"][string];
const withMeta = (n: Node) => n as unknown as NodeWithMeta;
const asNode = (n: NodeWithMeta) => n as unknown as Node;

/**
 * A board's cards, lifted out of its nodes (node id → card). A card's layer name is always its
 * title (src/discovery/pass.ts keeps them equal), so the file keeps the title only, on the card:
 * editing it there is enough. Other projects keep their nodes as they are.
 */
function liftCards(doc: Doc): { nodes: Doc["nodes"]; cards: Record<string, OstCard> } {
  const cards: Record<string, OstCard> = {};
  const nodes: Doc["nodes"] = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    const meta = withMeta(node).meta;
    if (meta?.ost) {
      cards[id] = meta.ost as OstCard;
      const rest = { ...meta };
      delete rest.ost;
      const copy = { ...withMeta(node) } as NodeWithMeta & { name?: string };
      delete copy.name;
      if (Object.keys(rest).length) copy.meta = rest;
      else delete copy.meta;
      nodes[id] = asNode(copy);
    } else nodes[id] = node;
  }
  return { nodes, cards };
}

function dropCards(nodes: Doc["nodes"], cards: Record<string, OstCard>): Doc["nodes"] {
  const out: Doc["nodes"] = { ...nodes };
  for (const [id, ost] of Object.entries(cards)) {
    const node = out[id];
    if (!node) continue;
    out[id] = asNode({ ...withMeta(node), name: ost.title, meta: { ...(withMeta(node).meta ?? {}), ost } } as NodeWithMeta);
  }
  return out;
}

export interface ProjectFileShape {
  qalam: typeof PROJECT_FILE;
  [key: string]: unknown;
}

/** A project (record and document) as its file, plus the local fields that stay off it. */
export function encodeProject(p: Project, doc: Doc | null): { text: string; local: LocalFields } {
  const { record, local } = splitLocal(p);
  const file: Record<string, unknown> = { qalam: PROJECT_FILE, ...record };
  if (doc) {
    if (p.type === "discovery") {
      const { nodes, cards } = liftCards(doc);
      file.cards = cards;
      file.doc = { ...doc, nodes };
    } else file.doc = doc;
  }
  return { text: stableStringify(file), local };
}

/** A project file back to its record (without local fields) and document. Null: not a project file. */
export function decodeProject(text: string): { record: Project; doc: Doc | null } | null {
  let file: Record<string, unknown>;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!file || file.qalam !== PROJECT_FILE || typeof file.id !== "string" || typeof file.type !== "string") return null;
  const { qalam: _q, doc: rawDoc, cards, ...record } = file;
  let doc: Doc | null = null;
  if (rawDoc && typeof rawDoc === "object") {
    const d = rawDoc as Doc;
    doc = cards && typeof cards === "object" ? { ...d, nodes: dropCards(d.nodes, cards as Record<string, OstCard>) } : d;
  }
  return { record: record as unknown as Project, doc };
}

// ---------------------------------------------------------------------------
// Sources

/** Front matter values are written as JSON, which YAML reads too. */
function frontMatter(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function readFrontMatter(md: string): { fields: Record<string, unknown>; body: string } | null {
  if (!md.startsWith("---\n")) return null;
  const end = md.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const fields: Record<string, unknown> = {};
  for (const line of md.slice(4, end).split("\n")) {
    const i = line.indexOf(": ");
    if (i <= 0) continue;
    try {
      fields[line.slice(0, i)] = JSON.parse(line.slice(i + 2));
    } catch {
      fields[line.slice(0, i)] = line.slice(i + 2);
    }
  }
  return { fields, body: md.slice(end + 5) };
}

/** A source as its two files: the text (with who/what/when on top) and the rest. */
export function encodeSource(s: SourceRecord): { md: string; data: string } {
  const { text, id, kind, title, origin, projectId, boards, product, addedAt, ...rest } = s;
  const md = frontMatter({ id, kind, title, origin, board: projectId, boards: boards ?? [projectId], product: product ?? null, addedAt, textHash: contentHash(text) }) + text;
  return { md, data: stableStringify({ qalam: SOURCE_FILE, id, ...rest }) };
}

/**
 * Two source files back to the record. When the text was edited outside Qalam, each quote is found
 * again by its words; a quote that's no longer there keeps its old place.
 */
export function decodeSource(md: string, dataText: string): SourceRecord | null {
  const front = readFrontMatter(md);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataText);
  } catch {
    return null;
  }
  if (!front || data.qalam !== SOURCE_FILE || typeof front.fields.id !== "string") return null;
  const f = front.fields;
  const { qalam: _q, ...rest } = data;
  // `board` is where it was added; `boards` all that use it (files from before sharing have only `board`).
  const boards = Array.isArray(f.boards) ? (f.boards as string[]) : typeof f.board === "string" ? [f.board] : [];
  const s = { ...rest, id: f.id, kind: f.kind, title: f.title, origin: f.origin, projectId: f.board, boards, product: (f.product as string | null | undefined) ?? null, addedAt: f.addedAt, text: front.body } as SourceRecord;
  if (f.origin === undefined) delete s.origin;
  if (f.textHash !== contentHash(front.body)) s.quotes = reanchor(front.body, s.quotes ?? []);
  return s;
}

function reanchor(text: string, quotes: SourceRecord["quotes"]): SourceRecord["quotes"] {
  return quotes.map((q) => {
    if (q.parts?.length || text.slice(q.span[0], q.span[1]) === q.text) return q;
    const at = text.indexOf(q.text);
    return at < 0 ? q : { ...q, span: [at, at + q.text.length] as [number, number] };
  });
}

// ---------------------------------------------------------------------------
// Assets

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

export const assetExt = (type: string) => EXT[type.split(";")[0].trim().toLowerCase()] ?? "bin";
export const assetType = (file: string) => Object.entries(EXT).find(([, e]) => file.endsWith(`.${e}`))?.[0] ?? "application/octet-stream";
