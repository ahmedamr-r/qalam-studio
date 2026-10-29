import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { reverses, sameDecision } from "@/decisions/diff";
import { appendEntries, decisionsFromMarkdown, replaceEntry } from "@/decisions/format";
import { monthOf, type Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { Proposal } from "@/discovery/proposals";
import { goalDecisions } from "@/goals/decisions";
import { goalsFromMarkdown, goalsToMarkdown } from "@/goals/goals-md";
import { migrateGoals, textGoalId, type BoardOutcomes } from "@/goals/migrate";
import { outcomesOf } from "@/goals/mirror";
import type { NewGoal } from "@/goals/shape";
import { addGoal, goalById, ordered, patchGoal as patchInTree, removeGoal as removeFromTree, setNorth as setNorthIn, underOf } from "@/goals/tree";
import { emptyGoals, type Goal, type GoalPatch, type GoalsAt, type GoalTree } from "@/goals/types";
import type { BearingLog } from "@/goals/bearings";
import type { StepPinLog } from "@/code/steps";
import type { GoalWork } from "@/goals/breakdown";
import { mapFromMarkdown, mapToMarkdown, type CodeRepo, type ProductMap } from "@/code/map";
import type { JobLog } from "@/goals/jobs";
import { sameTopic } from "@/hub/topics";
import type { SourceRecord } from "@/discovery/sources";
import { topicFromMarkdown, topicToMarkdown } from "@/hub/topic-md";
import { pairKey, type Notice } from "@/hub/checks";
import { applyFiling, type Applied, type Filing, type Topic, type TopicInfo } from "@/hub/topics";
import { factHash } from "@/knowledge/refs";
import { aboutFromMarkdown, aboutToMarkdown, emptyContext, legacyGoals, productFromMarkdown, productToMarkdown, type ContextFields, type Product } from "@/org/context-md";
import type { Project, ProjectType } from "@/projects/model";
import { assetExt, assetType, decodeProject, decodeSource, docVersion, encodeProject, encodeSource, isLocalField, recordVersion, splitLocal, type LocalFields } from "./codecs";
import { assetHash, atomicWrite, contentHash, inside, locked, readJson, slugify, stableStringify, uniqueName } from "./fsx";

/**
 * One organization's folder: what's in it, kept in an index, and every change written as a whole
 * readable file. Projects have two versions (record and document) so a record change from one
 * window never conflicts with a document save from another. Changes made outside Qalam (an
 * editor, Git, Finder) are picked up by a watcher and announced like Qalam's own.
 */

export interface OrgInfo {
  qalam: "org/1";
  id: string;
  name: string;
  createdAt: number;
}

export type OrgEvent = { tab?: string } & (
  | { kind: "project"; id: string; parts: ("record" | "doc")[]; removed?: boolean }
  | { kind: "source"; id: string; boards: string[]; removed?: boolean }
  | { kind: "system"; id: string; removed?: boolean }
  | { kind: "chat"; id: string; removed?: boolean }
  | { kind: "naming" }
  | { kind: "product"; id: string; removed?: boolean }
  | { kind: "about" }
  /** The goal tree changed (goals.md). */
  | { kind: "goal" }
  | { kind: "org" }
  | { kind: "decision"; ids: string[]; boards: string[] }
  /** `filed`: Qalam AI filed new material into the page (what's linked to goals may have grown). */
  | { kind: "topic"; id: string; removed?: boolean; filed?: boolean }
  /** Which problems bear on which goals changed (hub/bearings.jsonl). */
  | { kind: "bearing" }
  /** The jobs planned for goals, or what came of them, changed (hub/jobs.jsonl). */
  | { kind: "job" }
  /** What's pinned at a funnel's steps changed (hub/steps.jsonl). */
  | { kind: "step" }
  /** What others report for a goal, or the goals proposed under it, changed (hub/goals/<goal>.json). */
  | { kind: "goalwork"; goal: string }
  /** What a product does today, from its code, changed (hub/maps/<key>.md). */
  | { kind: "map"; key: string; removed?: boolean }
  | { kind: "notice" }
  | { kind: "relation" }
  /** Something changed in the inbox folder (server/inbox.ts reads what's new). */
  | { kind: "inbox" }
  /** What waits on a board from material added to the organization changed. */
  | { kind: "placement"; board: string }
  /** The engine Qalam AI runs on changed (server/engine.ts): announced to every open organization. */
  | { kind: "engine" }
);


/** The goal tree's file, at the organization's root. */
export const GOALS = "goals.md";
/** How long taking a change to a goal back counts as undoing it (as on a board). */
const GOAL_UNDO_WINDOW = 10 * 60_000;

export class ConflictError extends Error {
  constructor(
    readonly version: string,
    readonly current: unknown,
  ) {
    super("Changed since you last loaded it");
  }
}

export class NotFoundError extends Error {}

/** A goal a board works on can't be taken off: its outcome card is the goal on that board. */
export class GoalInUseError extends Error {
  constructor(readonly boards: string[]) {
    super("A board works on this goal");
  }
}

/** A goal can't sit under itself or anything under it. */
export class GoalCycleError extends Error {}

const PROJECT_DIRS: Record<ProjectType, string> = { discovery: "boards", screens: "screens", system: "design-systems/projects" };
const TYPE_WORD: Record<ProjectType, string> = { discovery: "board", screens: "screens", system: "system" };
const IGNORE = /(^|[/\\])(\.qalam|\.git|node_modules)([/\\]|$)|(^|[/\\])\.[^/\\]*\.tmp$|\.DS_Store$/;

interface ProjectEntry {
  file: string;
  record: Project;
  recordV: string;
  docV: string;
}

interface SourceEntry {
  md: string;
  data: string;
  /** The boards it's on. A source belongs to the organization; boards use it. */
  boards: string[];
  product: string | null;
  /** Its quotes the topic pages have seen (Qalam AI filed them). */
  filed: string[];
}

interface LocalState {
  projects: Record<string, LocalFields>;
  /** When this computer last opened the organization's home ("since your last visit"). */
  visit?: number;
  /** The goals that are this computer's person's ("Which goals are yours?"). */
  mine?: string[];
  /** The repositories and folders this computer reads for the products. */
  code?: CodeRepo[];
}

/** A line of hub/notices.jsonl: a notice dismissed or brought back, a review's finding, a review ran. */
interface NoticeLogEntry {
  dismiss?: string;
  restore?: string;
  found?: Notice;
  /** The review a finding came from; `reviewed`: that review ran (its id). */
  review?: string;
  reviewed?: string | boolean;
  at?: number;
}

/** Two cards on different boards that are the same need (hub/relations.jsonl). */
export interface Relation {
  kind: "same-need";
  a: string;
  b: string;
  at: number;
  by: "you" | "qalam";
}

export class OrgStore {
  readonly events = new EventEmitter();
  private projects = new Map<string, ProjectEntry>();
  private sources = new Map<string, SourceEntry>();
  private systems = new Map<string, string>();
  private chats = new Map<string, string>();
  private assets = new Map<string, string>();
  private products = new Map<string, string>();
  /** The decision log: each month file's decisions. */
  private decisions = new Map<string, Decision[]>();
  /** Topic pages (hub/topics/*.md), by id. */
  private topics = new Map<string, string>();
  private unionChecked = false;
  /** This process's goal decisions in the last minutes: what taking a change back marks undone. */
  private goalRecent: Decision[] = [];
  private local: LocalState = { projects: {} };
  /** Files Qalam itself wrote, by content hash: the watcher skips them. */
  private written = new Map<string, string>();
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  private constructor(
    readonly dir: string,
    private org: OrgInfo,
  ) {
    this.events.setMaxListeners(100);
  }

  get info(): OrgInfo {
    return this.org;
  }

  /** Rename the organization (its folder keeps its name). */
  async rename(name: string) {
    const n = name.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!n) return;
    this.org = { ...this.org, name: n };
    await this.write(this.abs("org.json"), stableStringify(this.org));
    this.emit({ kind: "org" });
  }

  static async open(dir: string): Promise<OrgStore> {
    const info = await readJson<OrgInfo>(path.join(dir, "org.json"));
    if (!info || info.qalam !== "org/1" || !info.id) throw new NotFoundError(`No organization at ${dir}`);
    const store = new OrgStore(dir, info);
    await store.scan();
    await store.migrateGoals();
    return store;
  }

  /** Make a new organization's folder, or turn an existing folder into one (its files stay as they are). */
  static async create(dir: string, info: Omit<OrgInfo, "qalam">): Promise<OrgStore> {
    await atomicWrite(path.join(dir, "org.json"), stableStringify({ qalam: "org/1", ...info }));
    // Local state, caches and AI working memory stay out of Git: added to a .gitignore already there.
    const ignore = path.join(dir, ".gitignore");
    const had = await readFile(ignore, "utf8").catch(() => "");
    const lines = had.split(/\r?\n/).map((l) => l.trim());
    const missing = [".qalam/", "chats/"].filter((l) => !lines.includes(l) && !lines.includes(l.slice(0, -1)));
    if (missing.length) await atomicWrite(ignore, `${had}${had && !had.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
    return OrgStore.open(dir);
  }

  private abs(rel: string): string {
    const f = inside(this.dir, rel);
    if (!f) throw new Error(`Outside the organization: ${rel}`);
    return f;
  }

  private async write(file: string, data: string | Uint8Array) {
    await atomicWrite(file, data);
    this.written.set(file, contentHash(data));
  }

  private emit(e: OrgEvent) {
    this.events.emit("event", e);
  }

  /** Tell this organization's windows (and its inbox) about a change that isn't its files'. */
  announce(e: OrgEvent) {
    this.emit(e);
  }

  // -------------------------------------------------------------------------
  // Reading the folder

  private async files(rel: string, ext: string): Promise<string[]> {
    try {
      return (await readdir(this.abs(rel), { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith(ext) && !d.name.startsWith(".")).map((d) => path.join(this.abs(rel), d.name));
    } catch {
      return [];
    }
  }

  private async scan() {
    for (const dir of Object.values(PROJECT_DIRS)) for (const file of await this.files(dir, ".json")) await this.indexProject(file);
    for (const md of await this.files("sources", ".md")) await this.indexSource(md);
    for (const file of await this.files("design-systems", ".json")) await this.indexSystem(file);
    for (const file of await this.files("products", ".md")) await this.indexProduct(file);
    for (const file of await this.files("decisions", ".md")) await this.indexDecisions(file);
    for (const file of await this.files("hub/topics", ".md")) await this.indexTopic(file);
    for (const file of await this.files("assets", "")) this.assets.set(path.basename(file).replace(/\.[^.]+$/, ""), file);
    try {
      for (const d of await readdir(this.abs("chats"), { withFileTypes: true })) if (d.isDirectory()) for (const file of await this.files(`chats/${d.name}`, ".json")) await this.indexChat(file);
    } catch {
      // no chats yet
    }
    this.local = (await readJson<LocalState>(this.abs(".qalam/local/state.json"))) ?? { projects: {} };
  }

  private async indexProject(file: string): Promise<{ id: string; parts: ("record" | "doc")[] } | null> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return null;
    }
    const decoded = decodeProject(text);
    if (!decoded) return null;
    const { record, doc } = decoded;
    const prev = this.projects.get(record.id);
    const entry: ProjectEntry = { file, record, recordV: recordVersion(record), docV: docVersion(doc) };
    this.projects.set(record.id, entry);
    const parts: ("record" | "doc")[] = [];
    if (prev?.recordV !== entry.recordV) parts.push("record");
    if (prev?.docV !== entry.docV) parts.push("doc");
    return { id: record.id, parts };
  }

  private async indexSource(md: string): Promise<SourceRecord | null> {
    const data = md.replace(/\.md$/, ".json");
    try {
      const s = decodeSource(await readFile(md, "utf8"), await readFile(data, "utf8"));
      if (!s) return null;
      this.sources.set(s.id, { md, data, boards: s.boards ?? [], product: s.product ?? null, filed: s.filed ?? [] });
      return s;
    } catch {
      return null;
    }
  }

  private async indexSystem(file: string): Promise<string | null> {
    if (path.basename(file) === "naming.json") return null;
    const s = await readJson<{ id?: string }>(file);
    if (!s?.id) return null;
    this.systems.set(s.id, file);
    return s.id;
  }

  private async indexProduct(file: string): Promise<Product | null> {
    try {
      const p = productFromMarkdown(await readFile(file, "utf8"));
      if (p) this.products.set(p.id, file);
      return p;
    } catch {
      return null;
    }
  }

  private async indexDecisions(file: string): Promise<Decision[]> {
    try {
      const list = decisionsFromMarkdown(await readFile(file, "utf8"));
      this.decisions.set(file, list);
      return list;
    } catch {
      this.decisions.delete(file);
      return [];
    }
  }

  /** A page written by hand without Qalam's front matter is named after its file. */
  private topicIdFor = (file: string) => `h${factHash(path.basename(file))}`;

  private async indexTopic(file: string): Promise<Topic | null> {
    try {
      const t = topicFromMarkdown(await readFile(file, "utf8"), this.topicIdFor(file));
      if (!t) return null;
      // Two files with the same id (a copied page): the first one keeps it.
      const had = this.topics.get(t.id);
      if (had && had !== file) return null;
      this.topics.set(t.id, file);
      return t;
    } catch {
      return null;
    }
  }

  private async indexChat(file: string): Promise<string | null> {
    const c = await readJson<{ id?: string }>(file);
    if (!c?.id) return null;
    this.chats.set(c.id, file);
    return c.id;
  }

  // -------------------------------------------------------------------------
  // Projects

  private withLocal = (e: ProjectEntry): Project => ({ ...e.record, ...this.local.projects[e.record.id] });

  listProjects(): Project[] {
    return [...this.projects.values()].map(this.withLocal);
  }

  /** A project's file, relative to the organization's folder. */
  projectFile(id: string): string | null {
    const e = this.projects.get(id);
    return e ? path.relative(this.dir, e.file) : null;
  }

  /** A source's text file, relative to the organization's folder. */
  sourceFile(id: string): string | null {
    const e = this.sources.get(id);
    return e ? path.relative(this.dir, e.md) : null;
  }

  /** The decision log's month files, relative to the organization's folder. */
  decisionFiles(): string[] {
    return [...this.decisions.keys()].map((f) => path.relative(this.dir, f)).sort();
  }

  getProject(id: string): { record: Project; version: string } | null {
    const e = this.projects.get(id);
    return e ? { record: this.withLocal(e), version: e.recordV } : null;
  }

  private async readDoc(e: ProjectEntry): Promise<Doc | null> {
    return decodeProject(await readFile(e.file, "utf8"))?.doc ?? null;
  }

  async getDoc(id: string): Promise<{ doc: Doc | null; version: string } | null> {
    const e = this.projects.get(id);
    if (!e) return null;
    return { doc: await this.readDoc(e), version: e.docV };
  }

  private newProjectFile(p: Project): string {
    const dir = this.abs(PROJECT_DIRS[p.type]);
    const used = new Set([...this.projects.values()].map((e) => e.file));
    const name = uniqueName(slugify(p.name, TYPE_WORD[p.type]), ".json", (n) => used.has(path.join(dir, n)));
    return path.join(dir, name);
  }

  private async setLocal(id: string, local: LocalFields | null) {
    if (local && Object.keys(local).length) this.local.projects[id] = local;
    else delete this.local.projects[id];
    await locked(this.abs(".qalam/local/state.json"), () => atomicWrite(this.abs(".qalam/local/state.json"), stableStringify(this.local)));
  }

  /** Write a project's file from its record and document (one write). */
  private async saveProject(record: Project, doc: Doc | null, file: string): Promise<ProjectEntry> {
    const { text } = encodeProject(record, doc);
    await this.write(file, text);
    const entry: ProjectEntry = { file, record: splitLocal(record).record, recordV: recordVersion(record), docV: docVersion(doc) };
    this.projects.set(record.id, entry);
    return entry;
  }

  /** Create a project, or replace its record (its document stays). */
  putProject(p: Project, opts: { ifMatch?: string; tab?: string } = {}): Promise<string> {
    return locked(`project:${p.id}`, async () => {
      const e = this.projects.get(p.id);
      if (e && opts.ifMatch && opts.ifMatch !== e.recordV) throw new ConflictError(e.recordV, this.withLocal(e));
      const doc = e ? await this.readDoc(e) : null;
      const entry = await this.saveProject(p, doc, e?.file ?? this.newProjectFile(p));
      await this.setLocal(p.id, splitLocal(p).local);
      this.emit({ kind: "project", id: p.id, parts: ["record"], tab: opts.tab });
      return entry.recordV;
    });
  }

  /** Change some of a project's fields (null removes one). Never conflicts: only the named fields change. */
  patchProject(id: string, patch: Record<string, unknown>, opts: { tab?: string } = {}): Promise<{ record: Project; version: string }> {
    return locked(`project:${id}`, async () => {
      const e = this.projects.get(id);
      if (!e) throw new NotFoundError(id);
      const entry = await this.applyPatch(e, patch, undefined);
      this.emit({ kind: "project", id, parts: ["record"], tab: opts.tab });
      return { record: this.withLocal(entry), version: entry.recordV };
    });
  }

  /** Apply a record patch; `doc` replaces the document too (undefined: keep it). */
  private async applyPatch(e: ProjectEntry, patch: Record<string, unknown>, doc: Doc | undefined): Promise<ProjectEntry> {
    const record = { ...e.record } as Record<string, unknown>;
    const local = { ...this.local.projects[e.record.id] } as Record<string, unknown>;
    let fileChanged = doc !== undefined;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id" || k === "type") continue;
      const target = isLocalField(k) ? local : record;
      if (v === null || v === undefined) delete target[k];
      else target[k] = v;
      if (!isLocalField(k)) fileChanged = true;
    }
    if (Object.keys(patch).some(isLocalField)) await this.setLocal(e.record.id, local as LocalFields);
    if (!fileChanged) return e;
    return this.saveProject(record as unknown as Project, doc === undefined ? await this.readDoc(e) : doc, e.file);
  }

  /** Save a project's document (and, in the same write, a few record fields). Conflicts when the document changed since `ifMatch`. */
  putDoc(id: string, doc: Doc, opts: { ifMatch?: string; patch?: Record<string, unknown>; tab?: string } = {}): Promise<string> {
    return locked(`project:${id}`, async () => {
      const e = this.projects.get(id);
      if (!e) throw new NotFoundError(id);
      if (opts.ifMatch && opts.ifMatch !== e.docV) throw new ConflictError(e.docV, await this.readDoc(e));
      const entry = await this.applyPatch(e, opts.patch ?? {}, doc);
      this.emit({ kind: "project", id, parts: opts.patch && Object.keys(opts.patch).some((k) => !isLocalField(k)) ? ["record", "doc"] : ["doc"], tab: opts.tab });
      return entry.docV;
    });
  }

  /** A project and everything that's only its: chats, AI traces, local state. Sources stay in the organization; the board leaves them. */
  removeProject(id: string, opts: { tab?: string } = {}): Promise<void> {
    return locked(`project:${id}`, async () => {
      const e = this.projects.get(id);
      if (e) await rm(e.file, { force: true });
      this.projects.delete(id);
      await rm(this.placementsFile(id), { force: true });
      await rm(this.abs(`chats/${id}`), { recursive: true, force: true });
      for (const [cid, file] of this.chats) if (path.dirname(file) === this.abs(`chats/${id}`)) this.chats.delete(cid);
      await rm(this.abs(`.qalam/local/layout/${id}.json`), { force: true });
      for (const [sid, s] of [...this.sources]) if (s.boards.includes(id)) await this.linkSource(sid, id, false, opts);
      await this.setLocal(id, null);
      this.emit({ kind: "project", id, parts: ["record", "doc"], removed: true, tab: opts.tab });
    });
  }

  // -------------------------------------------------------------------------
  // Sources: the organization's; each lists the boards that use it.

  private async readSource(e: SourceEntry): Promise<SourceRecord | null> {
    try {
      const rec = decodeSource(await readFile(e.md, "utf8"), await readFile(e.data, "utf8"));
      return rec ? { ...rec, boards: e.boards, product: e.product } : null;
    } catch {
      return null; // removed meanwhile
    }
  }

  /** The organization's sources, or the ones a board uses. */
  async listSources(board?: string): Promise<SourceRecord[]> {
    const out: SourceRecord[] = [];
    for (const e of this.sources.values()) {
      if (board && !e.boards.includes(board)) continue;
      const rec = await this.readSource(e);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => a.addedAt - b.addedAt);
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    const e = this.sources.get(id);
    return e ? this.readSource(e) : null;
  }

  /**
   * Save a source. A new one is on the board it was added on, for that board's product. A change
   * that doesn't say which boards use it keeps the boards it had (two boards adding it at once
   * don't undo each other).
   */
  putSource(s: SourceRecord, opts: { tab?: string } = {}): Promise<void> {
    return locked(`source:${s.id}`, async () => {
      const prev = this.sources.get(s.id);
      // The boards a source is on change only by linking it (linkSource): a window saving its copy keeps them as they are.
      const boards = prev ? prev.boards : [...new Set(s.boards ?? (s.projectId ? [s.projectId] : []))];
      const product = s.product !== undefined ? s.product : (prev?.product ?? (s.projectId ? (this.projects.get(s.projectId)?.record.product ?? null) : null));
      let md = prev?.md;
      if (!md) {
        const date = new Date(s.addedAt || Date.now()).toISOString().slice(0, 10);
        const dir = this.abs("sources");
        const used = new Set([...this.sources.values()].map((x) => x.md));
        md = path.join(dir, uniqueName(`${date}-${slugify(s.title, "source")}`, ".md", (n) => used.has(path.join(dir, n))));
      }
      // What the topic pages have seen only grows: a board saving its copy doesn't forget it.
      const filed = [...new Set([...(prev?.filed ?? []), ...(s.filed ?? [])])];
      const files = encodeSource({ ...s, boards, product, ...(filed.length ? { filed } : {}) });
      const entry: SourceEntry = { md, data: md.replace(/\.md$/, ".json"), boards, product, filed };
      await this.write(entry.md, files.md);
      await this.write(entry.data, files.data);
      this.sources.set(s.id, entry);
      this.emit({ kind: "source", id: s.id, boards, tab: opts.tab });
    });
  }

  /** Put a source on a board, or take it off (it stays in the organization). */
  linkSource(id: string, board: string, on: boolean, opts: { tab?: string } = {}): Promise<void> {
    return locked(`source:${id}`, async () => {
      const e = this.sources.get(id);
      if (!e) throw new NotFoundError(id);
      if (e.boards.includes(board) === on) return;
      const rec = await this.readSource(e);
      if (!rec) throw new NotFoundError(id);
      const boards = on ? [...e.boards, board] : e.boards.filter((b) => b !== board);
      const files = encodeSource({ ...rec, boards });
      await this.write(e.md, files.md);
      await this.write(e.data, files.data);
      this.sources.set(id, { ...e, boards });
      this.emit({ kind: "source", id, boards: [...new Set([...e.boards, ...boards])], tab: opts.tab });
    });
  }

  /** Delete a source from the organization (every board loses it, and what was proposed from it). */
  async removeSource(id: string, opts: { tab?: string } = {}): Promise<void> {
    await locked(`source:${id}`, async () => {
      const s = this.sources.get(id);
      if (!s) return;
      await rm(s.md, { force: true });
      await rm(s.data, { force: true });
      this.sources.delete(id);
      this.emit({ kind: "source", id, boards: s.boards, removed: true, tab: opts.tab });
    });
    for (const { board, sourceId } of await this.listPlacements()) if (sourceId === id) await this.setPlacements(board, id, null, opts);
  }

  // -------------------------------------------------------------------------
  // Proposals waiting on a board from material added to the organization (server/capture.ts):
  // hub/placements/<board>.json, by source, until the board reviews them.

  private placementsFile = (board: string) => this.abs(`hub/placements/${board}.json`);

  /** What waits on a board, by source. */
  async placementsFor(board: string): Promise<Record<string, Proposal[]>> {
    return (await readJson<{ sources?: Record<string, Proposal[]> }>(this.placementsFile(board)))?.sources ?? {};
  }

  /** What waits on every board. */
  async listPlacements(): Promise<{ board: string; sourceId: string; proposals: Proposal[] }[]> {
    const out: { board: string; sourceId: string; proposals: Proposal[] }[] = [];
    for (const file of await this.files("hub/placements", ".json")) {
      const board = path.basename(file, ".json");
      for (const [sourceId, proposals] of Object.entries(await this.placementsFor(board))) if (proposals.length) out.push({ board, sourceId, proposals });
    }
    return out;
  }

  /** Set what waits on a board from one source (null, or none: nothing waits any more). */
  async setPlacements(board: string, sourceId: string, proposals: Proposal[] | null, opts: { tab?: string } = {}): Promise<void> {
    const file = this.placementsFile(board);
    await locked(file, async () => {
      const sources = await this.placementsFor(board);
      if (proposals?.length) sources[sourceId] = proposals;
      else delete sources[sourceId];
      if (Object.keys(sources).length) await this.write(file, stableStringify({ qalam: "placements/1", board, sources }));
      else await rm(file, { force: true });
    });
    this.emit({ kind: "placement", board, tab: opts.tab });
  }

  /** Some of a source's quotes are now on the topic pages (or were read for them and left off). */
  private markFiled(id: string, quotes: string[], opts: { tab?: string } = {}): Promise<void> {
    return locked(`source:${id}`, async () => {
      const e = this.sources.get(id);
      if (!e || quotes.every((q) => e.filed.includes(q))) return;
      const rec = await this.readSource(e);
      if (!rec) return;
      const filed = [...new Set([...e.filed, ...(rec.filed ?? []), ...quotes])];
      const files = encodeSource({ ...rec, filed });
      await this.write(e.md, files.md);
      await this.write(e.data, files.data);
      this.sources.set(id, { ...e, filed });
      this.emit({ kind: "source", id, boards: e.boards, tab: opts.tab });
    });
  }

  // -------------------------------------------------------------------------
  // Topic pages: what the organization knows about each need, segment and product (hub/topics).

  private async readTopic(id: string): Promise<TopicInfo | null> {
    const file = this.topics.get(id);
    if (!file) return null;
    try {
      const text = await readFile(file, "utf8");
      const t = topicFromMarkdown(text, this.topicIdFor(file));
      return t ? { ...t, id, version: contentHash(text), file: path.relative(this.dir, file) } : null;
    } catch {
      return null; // removed meanwhile
    }
  }

  async listTopics(): Promise<TopicInfo[]> {
    const out: TopicInfo[] = [];
    for (const id of this.topics.keys()) {
      const t = await this.readTopic(id);
      if (t) out.push(t);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getTopic(id: string): Promise<TopicInfo | null> {
    return this.readTopic(id);
  }

  /** Write a page's file (a new page gets one named after its title). */
  private async writeTopic(t: Topic): Promise<string> {
    let file = this.topics.get(t.id);
    if (!file) {
      const dir = this.abs("hub/topics");
      const used = new Set(this.topics.values());
      file = path.join(dir, uniqueName(slugify(t.title, "topic"), ".md", (n) => used.has(path.join(dir, n))));
    }
    const { version: _v, file: _f, ...page } = t as TopicInfo;
    const text = topicToMarkdown(page);
    await this.write(file, text);
    this.topics.set(t.id, file);
    return contentHash(text);
  }

  /** Save a page as people changed it. Conflicts when it changed since `ifMatch` (Qalam AI filed something, another window, an editor). */
  putTopic(t: Topic, opts: { ifMatch?: string; tab?: string } = {}): Promise<string> {
    return locked("topics", async () => {
      const cur = await this.readTopic(t.id);
      if (cur && opts.ifMatch && opts.ifMatch !== cur.version) throw new ConflictError(cur.version, cur);
      const v = await this.writeTopic({ ...t, updatedAt: Date.now() });
      this.emit({ kind: "topic", id: t.id, tab: opts.tab });
      return v;
    });
  }

  removeTopic(id: string, opts: { tab?: string } = {}): Promise<void> {
    return locked("topics", async () => {
      const file = this.topics.get(id);
      if (file) await rm(file, { force: true });
      this.topics.delete(id);
      this.emit({ kind: "topic", id, removed: true, tab: opts.tab });
    });
  }

  /**
   * File what Qalam AI proposed (checked by code first, src/hub/topics.ts sanitizeFiling) into the
   * pages as they are now, and note which quotes the pages have now seen. `from` names the material.
   */
  async fileTopics(f: Filing, o: { from: string; filed?: Record<string, string[]>; tab?: string }): Promise<Applied> {
    const r = await locked("topics", async () => {
      const pages = new Map<string, Topic>();
      for (const ref of new Set([...f.add, ...f.revise, ...f.retire, ...f.dispute].map((x) => x.topic))) {
        if (ref.startsWith("new:")) continue;
        const t = await this.readTopic(ref);
        if (t) pages.set(ref, t);
      }
      const applied = applyFiling(pages, f, { now: Date.now(), newId: () => nanoid(10), from: o.from });
      for (const t of applied.pages) await this.writeTopic(t);
      return applied;
    });
    for (const [id, quotes] of Object.entries(o.filed ?? {})) await this.markFiled(id, quotes, o);
    for (const t of r.pages) this.emit({ kind: "topic", id: t.id, tab: o.tab, filed: true });
    return r;
  }

  // -------------------------------------------------------------------------
  // Which problems bear on which goals (hub/bearings.jsonl): a line per change, never rewritten,
  // so two people's merge in Git. src/goals/bearings.ts folds them.

  async listBearingLog(): Promise<BearingLog[]> {
    return this.readLog<BearingLog>("hub/bearings.jsonl");
  }

  /** Links found by Qalam AI (checked by code first), and its earlier ones they replace taken off. */
  async addBearings(entries: BearingLog[], opts: { tab?: string } = {}): Promise<void> {
    if (!entries.length) return;
    await this.appendLog("hub/bearings.jsonl", entries);
    this.emit({ kind: "bearing", tab: opts.tab });
  }

  // What's pinned at the steps of goals' funnels (hub/steps.jsonl): a line per change, never
  // rewritten, so two people's merge in Git. src/code/steps.ts folds them.

  async listStepLog(): Promise<StepPinLog[]> {
    return this.readLog<StepPinLog>("hub/steps.jsonl");
  }

  async addStepPins(entries: StepPinLog[], opts: { tab?: string } = {}): Promise<void> {
    if (!entries.length) return;
    await this.appendLog("hub/steps.jsonl", entries);
    this.emit({ kind: "step", tab: opts.tab });
  }

  // Jobs for goals (hub/jobs.jsonl): a job, then a line per change to it, never rewritten, so two
  // people's merge in Git. src/goals/jobs.ts folds them.

  async listJobLog(): Promise<JobLog[]> {
    return this.readLog<JobLog>("hub/jobs.jsonl");
  }

  async addJobs(entries: JobLog[], opts: { tab?: string } = {}): Promise<void> {
    if (!entries.length) return;
    await this.appendLog("hub/jobs.jsonl", entries);
    this.emit({ kind: "job", tab: opts.tab });
  }

  // What each product does today, from its code (hub/maps/<key>.md), and the repositories this
  // computer reads for them (.qalam/local).

  private mapFile(key: string) {
    if (!/^[A-Za-z0-9_.-]{1,140}$/.test(key) || key.startsWith(".")) throw new NotFoundError("No such map");
    return this.abs(`hub/maps/${key}.md`);
  }

  async listMaps(): Promise<ProductMap[]> {
    const names = await readdir(this.abs("hub/maps")).catch(() => [] as string[]);
    const out: ProductMap[] = [];
    for (const n of names.filter((n) => n.endsWith(".md")).sort()) {
      const m = mapFromMarkdown(await readFile(this.abs(`hub/maps/${n}`), "utf8").catch(() => ""));
      if (m) out.push(m);
    }
    return out;
  }

  async putMap(map: ProductMap, opts: { tab?: string } = {}): Promise<void> {
    const file = this.mapFile(map.key);
    const products = await this.listProducts();
    const goals = await this.getGoals();
    await locked(file, () => this.write(file, mapToMarkdown(map, { productName: products.find((p) => p.id === map.product)?.name, goalTitle: (id) => goalById(goals, id)?.title })));
    this.emit({ kind: "map", key: map.key, tab: opts.tab });
  }

  async removeMap(key: string, opts: { tab?: string } = {}): Promise<void> {
    await rm(this.mapFile(key), { force: true });
    this.emit({ kind: "map", key, removed: true, tab: opts.tab });
  }

  get codeRepos(): CodeRepo[] {
    return this.local.code ?? [];
  }

  async setCodeRepos(list: CodeRepo[]): Promise<void> {
    this.local.code = list;
    await locked(this.abs(".qalam/local/state.json"), () => atomicWrite(this.abs(".qalam/local/state.json"), stableStringify(this.local)));
  }

  /** Where this computer keeps its copy of a repository's code (never shared: .qalam is out of Git). */
  codeDir(key: string): string {
    if (!/^[A-Za-z0-9_.-]{1,140}$/.test(key) || key.startsWith(".")) throw new NotFoundError("No such repository");
    return this.abs(`.qalam/code/${key}`);
  }

  // A goal's work in progress (hub/goals/<goal>.json): what others report for it, and the goals
  // Qalam AI proposed under it until each is accepted or discarded.

  private goalWorkFile(goal: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(goal)) throw new NotFoundError("No such goal");
    return this.abs(`hub/goals/${goal}.json`);
  }

  async getGoalWork(goal: string): Promise<GoalWork> {
    const j = await readJson<GoalWork & { qalam?: string }>(this.goalWorkFile(goal));
    return j?.qalam === "goal-work/1" ? { ...(j.outside ? { outside: j.outside } : {}), ...(j.breakdown ? { breakdown: j.breakdown } : {}), ...(j.funnel ? { funnel: j.funnel } : {}) } : {};
  }

  async changeGoalWork(goal: string, fn: (w: GoalWork) => GoalWork, opts: { tab?: string } = {}): Promise<GoalWork> {
    const file = this.goalWorkFile(goal);
    let next: GoalWork = {};
    await locked(file, async () => {
      next = fn(await this.getGoalWork(goal));
      if (next.outside || next.breakdown || next.funnel) await this.write(file, stableStringify({ qalam: "goal-work/1", goal, ...next }));
      else await rm(file, { force: true });
    });
    this.emit({ kind: "goalwork", goal, tab: opts.tab });
    return next;
  }

  // -------------------------------------------------------------------------
  // The organization and its products: what they are, for people and for Qalam AI.

  async getAbout(): Promise<ContextFields> {
    try {
      return aboutFromMarkdown(await readFile(this.abs("about.md"), "utf8"));
    } catch {
      return emptyContext();
    }
  }

  /** Save the About. Goals sent with it (a window from before goals.md) go into the goal tree. */
  async putAbout(c: ContextFields & { goals?: string[] }, opts: { tab?: string } = {}): Promise<void> {
    const { goals, ...fields } = c;
    const file = this.abs("about.md");
    await locked(file, () => this.write(file, aboutToMarkdown(fields)));
    this.emit({ kind: "about", tab: opts.tab });
    if (goals?.length) await this.takeInGoals(goals, null, opts);
  }

  async listProducts(): Promise<Product[]> {
    const out: Product[] = [];
    for (const file of this.products.values()) {
      try {
        const p = productFromMarkdown(await readFile(file, "utf8"));
        if (p) out.push(p);
      } catch {
        // removed meanwhile
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Save a product. Goals sent with it (a window from before goals.md) go into the goal tree. */
  async putProduct(product: Product & { goals?: string[] }, opts: { tab?: string } = {}): Promise<void> {
    const { goals, ...p } = product;
    await locked(`product:${p.id}`, async () => {
      let file = this.products.get(p.id);
      if (!file) {
        const dir = this.abs("products");
        const used = new Set(this.products.values());
        file = path.join(dir, uniqueName(slugify(p.name, "product"), ".md", (n) => used.has(path.join(dir, n))));
      }
      await this.write(file, productToMarkdown(p));
      this.products.set(p.id, file);
      this.emit({ kind: "product", id: p.id, tab: opts.tab });
    });
    if (goals?.length) await this.takeInGoals(goals, p.id, opts);
  }

  /** Delete a product: its boards and sources become the whole organization's. */
  async removeProduct(id: string, opts: { tab?: string } = {}): Promise<void> {
    await locked(`product:${id}`, async () => {
      const file = this.products.get(id);
      if (file) await rm(file, { force: true });
      this.products.delete(id);
    });
    for (const e of [...this.projects.values()]) if (e.record.product === id) await this.patchProject(e.record.id, { product: null }, opts);
    for (const [sid, e] of [...this.sources]) {
      if (e.product !== id) continue;
      const rec = await this.readSource(e);
      if (rec) await this.putSource({ ...rec, product: null }, opts);
    }
    this.emit({ kind: "product", id, removed: true, tab: opts.tab });
  }

  // -------------------------------------------------------------------------
  // Goals: one tree with the North Star on top (goals.md). A board's outcome card is its goal on
  // the canvas; the file is where the goal lives (src/goals).

  /** The goals and their version (the file's hash). No file yet: no goals. */
  async getGoals(): Promise<GoalsAt> {
    const text = await readFile(this.abs(GOALS), "utf8").catch(() => "");
    return { ...(text ? goalsFromMarkdown(text) : emptyGoals()), version: contentHash(text), file: GOALS };
  }

  private async writeGoals(t: GoalTree): Promise<string> {
    const names = new Map((await this.listProducts()).map((p) => [p.id, p.name]));
    const text = goalsToMarkdown(t, { product: (id) => names.get(id) });
    await this.write(this.abs(GOALS), text);
    return contentHash(text);
  }

  /**
   * Change the goals, on the file as it is now, under one lock. What it decided goes in the log
   * (src/goals/decisions.ts): taking a change back within minutes marks that decision undone
   * instead, as on a board. A change from the folder (an editor, Git) records nothing: its
   * decisions were recorded where they were made.
   */
  private changeGoals(change: (t: GoalTree) => GoalTree, opts: { ifMatch?: string; by?: Decision["by"]; tab?: string; record?: boolean } = {}): Promise<{ goals: GoalsAt; decisions: Decision[] }> {
    return locked(this.abs(GOALS), async () => {
      const cur = await this.getGoals();
      if (opts.ifMatch && opts.ifMatch !== cur.version) throw new ConflictError(cur.version, cur);
      const { version: _v, file: _f, ...was } = cur;
      const next = ordered(change(was));
      if (stableStringify(next) === stableStringify(ordered(was))) return { goals: cur, decisions: [] };
      const version = await this.writeGoals(next);
      const found = opts.record === false ? [] : goalDecisions(was, next, { now: Date.now(), by: opts.by, newId: () => nanoid(10) });
      const decisions = await this.recordGoalDecisions(found, opts);
      this.emit({ kind: "goal", tab: opts.tab });
      return { goals: { ...next, version, file: GOALS }, decisions };
    });
  }

  private async recordGoalDecisions(found: Decision[], opts: { tab?: string }): Promise<Decision[]> {
    const now = Date.now();
    this.goalRecent = this.goalRecent.filter((d) => now - d.at < GOAL_UNDO_WINDOW);
    const latest = (test: (r: Decision) => boolean) => [...this.goalRecent].reverse().find(test);
    const fresh: Decision[] = [];
    for (const d of found) {
      const back = latest((r) => !r.undone && reverses(d, r));
      const again = back ? undefined : latest((r) => !!r.undone && sameDecision(d, r));
      const mark = back ?? again;
      if (mark) {
        mark.undone = !!back;
        await this.updateDecision(mark.id, { undone: !!back }, opts).catch(() => {});
      } else fresh.push(d);
    }
    if (fresh.length) {
      this.goalRecent.push(...fresh);
      await this.appendDecisions(fresh, opts);
    }
    return fresh;
  }

  /** Add a goal. One given an id that's there already is that goal: two windows making one card's goal make one. */
  async createGoal(input: NewGoal, opts: { by?: Decision["by"]; tab?: string } = {}): Promise<{ goal: Goal; goals: GoalsAt }> {
    let id = input.id ?? `g${nanoid(9)}`;
    const r = await this.changeGoals((t) => {
      if (goalById(t, id)) return t;
      // A card's goal made again from another window, under its own id: the one there.
      const twin = input.on && t.goals.find((g) => g.on?.board === input.on!.board && g.on.card === input.on!.card);
      if (twin) {
        id = twin.id;
        return t;
      }
      const g: Goal = {
        id,
        title: input.title,
        parent: input.parent && goalById(t, input.parent) ? input.parent : null,
        product: input.product ?? null,
        ...(input.metric ? { metric: input.metric } : {}),
        status: input.status ?? "active",
        ...(input.lever ? { lever: input.lever } : {}),
        ...(input.feeds ? { feeds: input.feeds } : {}),
        ...(input.on ? { on: input.on } : {}),
        cites: input.cites ?? [],
        by: input.by ?? "person",
        at: Date.now(),
      };
      const next = addGoal(t, g);
      return input.north === true || (input.north === "if-none" && !t.north && !g.parent) ? setNorthIn(next, g.id) : next;
    }, opts);
    return { goal: goalById(r.goals, id)!, goals: r.goals };
  }

  /** Change a goal. One under itself is refused (GoalCycleError). */
  async patchGoal(id: string, patch: GoalPatch, opts: { ifMatch?: string; by?: Decision["by"]; tab?: string } = {}): Promise<{ goal: Goal; goals: GoalsAt; decisions: Decision[] }> {
    const r = await this.changeGoals((t) => {
      if (!goalById(t, id)) throw new NotFoundError(`No goal ${id}`);
      if (patch.parent && (patch.parent === id || underOf(t, id).some((g) => g.id === patch.parent))) throw new GoalCycleError("A goal can't sit under itself or a goal under it");
      if (patch.parent && !goalById(t, patch.parent)) throw new NotFoundError(`No goal ${patch.parent}`);
      return patchInTree(t, id, patch);
    }, opts);
    return { goal: goalById(r.goals, id)!, goals: r.goals, decisions: r.decisions };
  }

  /** Take a goal off the tree (the goals under it move up). A goal a board's card is on stays (GoalInUseError). */
  async removeGoal(id: string, opts: { by?: Decision["by"]; tab?: string } = {}): Promise<{ goals: GoalsAt; decisions: Decision[] }> {
    const g = goalById(await this.getGoals(), id);
    if (!g) throw new NotFoundError(`No goal ${id}`);
    if (g.on) {
      const e = this.projects.get(g.on.board);
      const doc = e ? await this.readDoc(e).catch(() => null) : null;
      if (doc && (doc.nodes as Record<string, unknown>)[g.on.card]) throw new GoalInUseError([g.on.board]);
    }
    return this.changeGoals((t) => removeFromTree(t, id), opts);
  }

  /** Make a top-level goal the North Star (none: no North Star). */
  async setNorth(id: string | null, opts: { by?: Decision["by"]; tab?: string } = {}): Promise<{ goals: GoalsAt; decisions: Decision[] }> {
    return this.changeGoals((t) => {
      if (id && !goalById(t, id)) throw new NotFoundError(`No goal ${id}`);
      return setNorthIn(id ? patchInTree(t, id, { parent: null }) : t, id);
    }, opts);
  }

  /** Goals written in a context's words (from before goals.md), added where they aren't yet. */
  private async takeInGoals(lines: string[], product: string | null, opts: { tab?: string }) {
    await this.changeGoals((t) => {
      let next = t;
      for (const line of lines) {
        const title = line.replace(/\s+/g, " ").trim().slice(0, 200);
        if (!title || next.goals.some((g) => (g.product ?? null) === product && sameTopic(g.title, title))) continue;
        next = addGoal(next, { id: textGoalId(product ? `${product}:${title}` : title), title, parent: null, product, status: "active", cites: [], by: "person", at: Date.now() });
        if (!product && !next.north) next = setNorthIn(next, next.goals.at(-1)!.id);
      }
      return next;
    }, opts);
  }

  /** The goals that are this computer's person's. */
  get mine(): string[] {
    return this.local.mine ?? [];
  }

  async setMine(ids: string[]): Promise<void> {
    this.local.mine = [...new Set(ids)].slice(0, 200);
    await locked(this.abs(".qalam/local/state.json"), () => atomicWrite(this.abs(".qalam/local/state.json"), stableStringify(this.local)));
  }

  /**
   * Goals written before goals.md (the About's, each product's, the outcome cards on the boards)
   * moved into it, once: when the folder has no goals.md and something says what it aims at. Board
   * files aren't touched: a goal knows its card (`on`), so links hold before any board opens.
   */
  async migrateGoals(): Promise<void> {
    if (await readFile(this.abs(GOALS)).then(() => true, () => false)) return;
    const about = legacyGoals(await this.getAbout());
    const products: { file: string; product: Product; goals: string[] }[] = [];
    for (const file of this.products.values()) {
      const p = productFromMarkdown(await readFile(file, "utf8").catch(() => ""));
      if (!p) continue;
      const { goals, rest } = legacyGoals(p);
      products.push({ file, product: rest, goals });
    }
    const boards: BoardOutcomes[] = [];
    for (const e of this.projects.values()) {
      if (e.record.type !== "discovery") continue;
      const doc = await this.readDoc(e).catch(() => null);
      const outcomes = doc
        ? outcomesOf(doc).map((o) => ({
            card: o.card,
            title: o.ost.title,
            ...(o.ost.metric ? { metric: o.ost.metric } : {}),
            stage: (["active", "achieved", "paused"].includes(o.ost.stage) ? o.ost.stage : "active") as Goal["status"],
            parent: o.parent,
            pieces: o.ost.evidence.flatMap((x) => (x.piece && x.stance !== "against" ? [x.piece] : [])),
          }))
        : [];
      boards.push({ board: e.record.id, product: e.record.product ?? null, createdAt: e.record.createdAt, outcomes });
    }
    if (!about.goals.length && !products.some((p) => p.goals.length) && !boards.some((b) => b.outcomes.some((o) => o.title.trim()))) return;
    await locked(this.abs(GOALS), async () => {
      await this.writeGoals(migrateGoals({ about: about.goals, products: products.map((p) => ({ id: p.product.id, goals: p.goals })), boards, at: this.org.createdAt }));
    });
    if (about.goals.length) await this.write(this.abs("about.md"), aboutToMarkdown(about.rest));
    for (const p of products) if (p.goals.length) await this.write(p.file, productToMarkdown(p.product));
  }

  // -------------------------------------------------------------------------
  // Decisions: a log a month (decisions/<YYYY-MM>.md), added to as boards change.

  /** Decisions, newest first: all of them, a board's, a card's, or a goal's. */
  listDecisions(q: { board?: string; card?: string; goal?: string; limit?: number } = {}): Decision[] {
    const seen = new Set<string>();
    const out: Decision[] = [];
    for (const list of this.decisions.values())
      for (const d of list) {
        if (seen.has(d.id) || (q.board && d.board !== q.board) || (q.card && d.card !== q.card && !cardsOf(d).includes(q.card)) || (q.goal && d.goal !== q.goal)) continue;
        seen.add(d.id);
        out.push(d);
      }
    out.sort((a, b) => b.at - a.at);
    return q.limit ? out.slice(0, q.limit) : out;
  }

  /** Add decisions to their months' logs. One already there (a retried request) isn't added twice. */
  async appendDecisions(list: Decision[], opts: { tab?: string } = {}): Promise<void> {
    if (!list.length) return;
    await this.unionMerge();
    const byMonth = new Map<string, Decision[]>();
    for (const d of list) byMonth.set(monthOf(d.at), [...(byMonth.get(monthOf(d.at)) ?? []), d]);
    for (const [month, ds] of byMonth) {
      const file = this.abs(`decisions/${month}.md`);
      await locked(file, async () => {
        const had = await readFile(file, "utf8").catch(() => null);
        const known = new Set(decisionsFromMarkdown(had ?? "").map((d) => d.id));
        const fresh = ds.filter((d) => !known.has(d.id));
        if (!fresh.length) return;
        const text = appendEntries(had, month, fresh);
        await this.write(file, text);
        this.decisions.set(file, decisionsFromMarkdown(text));
      });
    }
    this.emit({ kind: "decision", ids: list.map((d) => d.id), boards: [...new Set(list.map((d) => d.board))], tab: opts.tab });
  }

  /** Write or correct a decision's why, or mark it undone (it stays in the log). */
  async updateDecision(id: string, patch: { why?: string | null; undone?: boolean }, opts: { tab?: string } = {}): Promise<Decision> {
    const file = [...this.decisions].find(([, list]) => list.some((d) => d.id === id))?.[0];
    if (!file) throw new NotFoundError(id);
    return locked(file, async () => {
      const text = await readFile(file, "utf8");
      const d = decisionsFromMarkdown(text).find((x) => x.id === id);
      if (!d) throw new NotFoundError(id);
      const next: Decision = { ...d };
      if (patch.why !== undefined) {
        if (patch.why?.trim()) next.why = patch.why.trim();
        else delete next.why;
      }
      if (patch.undone !== undefined) {
        if (patch.undone) next.undone = true;
        else delete next.undone;
      }
      const out = replaceEntry(text, next);
      if (out === null) throw new NotFoundError(id);
      await this.write(file, out);
      this.decisions.set(file, decisionsFromMarkdown(out));
      this.emit({ kind: "decision", ids: [id], boards: [d.board], tab: opts.tab });
      return next;
    });
  }

  /** Two people adding to the same log (a month's decisions, the notices, the links) keep both their entries when Git merges (.gitattributes). */
  private async unionMerge() {
    if (this.unionChecked) return;
    this.unionChecked = true;
    const file = this.abs(".gitattributes");
    await locked(file, async () => {
      const had = await readFile(file, "utf8").catch(() => "");
      const lines = had.split(/\r?\n/).map((l) => l.trim());
      const missing = ["decisions/*.md merge=union", "hub/*.jsonl merge=union"].filter((want) => !lines.some((l) => l.startsWith(want.split(" ")[0])));
      if (!missing.length) return;
      await this.write(file, `${had}${had && !had.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
    });
  }

  // -------------------------------------------------------------------------
  // Needs a look: what was dismissed and what Qalam AI's reviews found (hub/notices.jsonl), and
  // cards linked as the same need (hub/relations.jsonl). A line per change, never rewritten, so
  // two people's changes merge in Git.

  private async readLog<T>(rel: string): Promise<T[]> {
    const text = await readFile(this.abs(rel), "utf8").catch(() => "");
    const out: T[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // A line broken by hand (or a merge): the rest still reads.
      }
    }
    return out;
  }

  private async appendLog(rel: string, entries: unknown[]) {
    if (!entries.length) return;
    await this.unionMerge();
    const file = this.abs(rel);
    await locked(file, async () => {
      const had = await readFile(file, "utf8").catch(() => "");
      await this.write(file, `${had}${had && !had.endsWith("\n") ? "\n" : ""}${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
    });
  }

  /** What was dismissed (by key, when), what Qalam AI's latest review found, and when it ran. */
  async noticeState(): Promise<{ dismissed: Map<string, number>; found: Notice[]; reviewedAt: number | null }> {
    const dismissed = new Map<string, number>();
    const byReview = new Map<string, Map<string, Notice>>();
    let latest: { id: string; at: number } | null = null;
    for (const e of await this.readLog<NoticeLogEntry>("hub/notices.jsonl")) {
      if (typeof e.dismiss === "string") dismissed.set(e.dismiss, e.at ?? 0);
      else if (typeof e.restore === "string") dismissed.delete(e.restore);
      else if (e.found && typeof e.found.key === "string") {
        const r = typeof e.review === "string" ? e.review : "";
        byReview.set(r, (byReview.get(r) ?? new Map()).set(e.found.key, e.found));
      } else if (e.reviewed && (e.at ?? 0) >= (latest?.at ?? 0)) latest = { id: typeof e.reviewed === "string" ? e.reviewed : "", at: e.at ?? 0 };
    }
    // A review's findings stand until the next review replaces them.
    const found = latest ? (byReview.get(latest.id) ?? new Map<string, Notice>()) : new Map<string, Notice>();
    return { dismissed, found: [...found.values()], reviewedAt: latest?.at ?? null };
  }

  /** Dismiss a notice (it doesn't come back), or bring it back. */
  async dismissNotice(key: string, on: boolean, opts: { tab?: string } = {}): Promise<void> {
    await this.appendLog("hub/notices.jsonl", [on ? { dismiss: key, at: Date.now() } : { restore: key, at: Date.now() }]);
    this.emit({ kind: "notice", tab: opts.tab });
  }

  /** What a review by Qalam AI found (checked by code first): it replaces the last review's findings. */
  async addFindings(list: Notice[], opts: { tab?: string } = {}): Promise<void> {
    const review = nanoid(8);
    await this.appendLog("hub/notices.jsonl", [...list.map((n) => ({ found: n, review, at: n.at })), { reviewed: review, at: Date.now() }]);
    this.emit({ kind: "notice", tab: opts.tab });
  }

  /** Cards linked as the same need, as they are now. */
  async listRelations(): Promise<Relation[]> {
    const now = new Map<string, Relation>();
    for (const e of await this.readLog<Relation & { removed?: boolean }>("hub/relations.jsonl")) {
      if (e.kind !== "same-need" || typeof e.a !== "string" || typeof e.b !== "string") continue;
      if (e.removed) now.delete(pairKey(e.a, e.b));
      else now.set(pairKey(e.a, e.b), { kind: e.kind, a: e.a, b: e.b, at: e.at ?? 0, by: e.by === "qalam" ? "qalam" : "you" });
    }
    return [...now.values()];
  }

  /** Link two cards on different boards as the same need, or unlink them. */
  async linkCards(a: string, b: string, on: boolean, opts: { tab?: string } = {}): Promise<void> {
    await this.appendLog("hub/relations.jsonl", [{ kind: "same-need", a, b, at: Date.now(), by: "you", ...(on ? {} : { removed: true }) }]);
    this.emit({ kind: "relation", tab: opts.tab });
  }

  /** When this computer last opened the organization's home (before now); now is the last visit. */
  async visit(): Promise<number | null> {
    const prev = this.local.visit ?? null;
    this.local.visit = Date.now();
    await locked(this.abs(".qalam/local/state.json"), () => atomicWrite(this.abs(".qalam/local/state.json"), stableStringify(this.local)));
    return prev;
  }

  /** When this computer last opened the organization's home. */
  get lastVisit(): number | null {
    return this.local.visit ?? null;
  }

  // -------------------------------------------------------------------------
  // Chats and AI traces (AI working memory: kept out of Git by .gitignore)

  async listChats(): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const file of this.chats.values()) {
      const c = await readJson(file);
      if (c) out.push(c);
    }
    return out;
  }

  putChat(chat: { id: string; projectId?: string }, opts: { tab?: string } = {}): Promise<void> {
    return locked(`chat:${chat.id}`, async () => {
      const file = this.abs(`chats/${chat.projectId ?? "_"}/${chat.id}.json`);
      const prev = this.chats.get(chat.id);
      if (prev && prev !== file) await rm(prev, { force: true });
      await this.write(file, stableStringify(chat));
      this.chats.set(chat.id, file);
      this.emit({ kind: "chat", id: chat.id, tab: opts.tab });
    });
  }

  removeChat(id: string): Promise<void> {
    return locked(`chat:${id}`, async () => {
      const file = this.chats.get(id);
      if (file) await rm(file, { force: true });
      this.chats.delete(id);
    });
  }

  async listTraces(projectId: string): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const file of await this.files(`chats/${projectId}/traces`, ".json")) {
      const t = await readJson(file);
      if (t) out.push(t);
    }
    return out;
  }

  putTrace(t: { id: string; projectId: string }): Promise<void> {
    const file = this.abs(`chats/${t.projectId}/traces/${t.id}.json`);
    return locked(file, () => this.write(file, stableStringify(t)));
  }

  removeTrace(projectId: string, id: string): Promise<void> {
    return rm(this.abs(`chats/${projectId}/traces/${id}.json`), { force: true });
  }

  getLayout(projectId: string): Promise<unknown> {
    return readJson(this.abs(`.qalam/local/layout/${projectId}.json`));
  }

  putLayout(projectId: string, layout: unknown): Promise<void> {
    const file = this.abs(`.qalam/local/layout/${projectId}.json`);
    return locked(file, () => atomicWrite(file, stableStringify(layout)));
  }

  // -------------------------------------------------------------------------
  // Images (named by their content, so the same image is kept once)

  getAsset(hash: string): { file: string; type: string } | null {
    const file = this.assets.get(hash);
    return file ? { file, type: assetType(file) } : null;
  }

  async putAsset(hash: string, bytes: Uint8Array, type: string): Promise<void> {
    if (assetHash(bytes) !== hash) throw new Error("The image doesn't match its name");
    if (this.assets.has(hash)) return;
    const file = this.abs(`assets/${hash}.${assetExt(type)}`);
    await locked(file, () => this.write(file, bytes));
    this.assets.set(hash, file);
  }

  // -------------------------------------------------------------------------
  // Design systems (on hold, but saved here so they belong to the organization)

  async listSystems(): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const file of this.systems.values()) {
      const s = await readJson(file);
      if (s) out.push(s);
    }
    return out;
  }

  putSystem(s: { id: string; name?: string }, opts: { tab?: string } = {}): Promise<void> {
    return locked(`system:${s.id}`, async () => {
      let file = this.systems.get(s.id);
      if (!file) {
        const dir = this.abs("design-systems");
        const used = new Set(this.systems.values());
        file = path.join(dir, uniqueName(slugify(s.name ?? "", "design-system"), ".json", (n) => n === "naming.json" || used.has(path.join(dir, n))));
      }
      await this.write(file, stableStringify(s));
      this.systems.set(s.id, file);
      this.emit({ kind: "system", id: s.id, tab: opts.tab });
    });
  }

  removeSystem(id: string, opts: { tab?: string } = {}): Promise<void> {
    return locked(`system:${id}`, async () => {
      const file = this.systems.get(id);
      if (file) await rm(file, { force: true });
      this.systems.delete(id);
      this.emit({ kind: "system", id, removed: true, tab: opts.tab });
    });
  }

  async getNaming(): Promise<unknown[]> {
    return (await readJson<unknown[]>(this.abs("design-systems/naming.json"))) ?? [];
  }

  async putNaming(list: unknown[], opts: { tab?: string } = {}): Promise<void> {
    const file = this.abs("design-systems/naming.json");
    await locked(file, () => this.write(file, stableStringify(list)));
    this.emit({ kind: "naming", tab: opts.tab });
  }

  // -------------------------------------------------------------------------
  // Changes made outside Qalam

  /** Watch the folder for edits made elsewhere (an editor, Git, another Qalam). */
  watch() {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_type, name) => {
        if (!name) return;
        const rel = name.toString();
        if (IGNORE.test(rel)) return;
        clearTimeout(this.pending.get(rel));
        this.pending.set(
          rel,
          setTimeout(() => {
            this.pending.delete(rel);
            void this.reload(rel).catch(() => {});
          }, 150),
        );
      });
    } catch {
      // No recursive watching here: changes from outside show after a restart.
    }
  }

  /** Stop watching, and end the change streams open on this store (their windows reconnect to whatever replaces it). */
  dispose() {
    this.watcher?.close();
    this.watcher = null;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.events.emit("dispose");
    this.events.removeAllListeners();
  }

  /** Bring the index up to date with one changed path, and announce what changed. */
  async reload(rel: string) {
    const file = this.abs(rel);
    let bytes: Buffer | null = null;
    try {
      bytes = await readFile(file);
    } catch {
      bytes = null;
    }
    if (bytes && this.written.get(file) === contentHash(bytes)) return;
    const parts = rel.split("/");
    const projectDir = Object.values(PROJECT_DIRS).find((d) => rel.startsWith(`${d}/`) && rel.slice(d.length + 1).split("/").length === 1);
    if (projectDir && rel.endsWith(".json")) {
      if (bytes) {
        const changed = await this.indexProject(file);
        if (changed?.parts.length) this.emit({ kind: "project", id: changed.id, parts: changed.parts });
      } else {
        const gone = [...this.projects].find(([, e]) => e.file === file);
        if (gone) {
          this.projects.delete(gone[0]);
          this.emit({ kind: "project", id: gone[0], parts: ["record", "doc"], removed: true });
        }
      }
    } else if (parts[0] === "sources" && parts.length === 2 && /\.(md|json)$/.test(rel)) {
      // Either file of a source changed: read the pair again (gone when its text is gone).
      const md = file.replace(/\.json$/, ".md");
      const s = await this.indexSource(md);
      if (s) this.emit({ kind: "source", id: s.id, boards: s.boards ?? [] });
      else {
        const gone = [...this.sources].find(([, e]) => e.md === md);
        if (gone) {
          this.sources.delete(gone[0]);
          this.emit({ kind: "source", id: gone[0], boards: gone[1].boards, removed: true });
        }
      }
    } else if (parts[0] === "design-systems" && parts.length === 2 && rel.endsWith(".json")) {
      if (parts[1] === "naming.json") this.emit({ kind: "naming" });
      else if (bytes) {
        const id = await this.indexSystem(file);
        if (id) this.emit({ kind: "system", id });
      } else {
        const gone = [...this.systems].find(([, f]) => f === file);
        if (gone) {
          this.systems.delete(gone[0]);
          this.emit({ kind: "system", id: gone[0], removed: true });
        }
      }
    } else if (parts[0] === "products" && parts.length === 2 && rel.endsWith(".md")) {
      const p = bytes ? await this.indexProduct(file) : null;
      if (p) this.emit({ kind: "product", id: p.id });
      else {
        const gone = [...this.products].find(([, f]) => f === file);
        if (gone) {
          this.products.delete(gone[0]);
          this.emit({ kind: "product", id: gone[0], removed: true });
        }
      }
    } else if (parts[0] === "decisions" && parts.length === 2 && rel.endsWith(".md")) {
      const before = new Map((this.decisions.get(file) ?? []).map((d) => [d.id, JSON.stringify(d)]));
      const after = bytes ? await this.indexDecisions(file) : [];
      if (!bytes) this.decisions.delete(file);
      const changed = after.filter((d) => before.get(d.id) !== JSON.stringify(d));
      const gone = [...before.keys()].filter((id) => !after.some((d) => d.id === id));
      const boards = new Set(changed.map((d) => d.board));
      for (const id of gone) boards.add((JSON.parse(before.get(id)!) as Decision).board);
      if (changed.length || gone.length) this.emit({ kind: "decision", ids: [...changed.map((d) => d.id), ...gone], boards: [...boards] });
    } else if (parts[0] === "hub" && parts[1] === "topics" && parts.length === 3 && rel.endsWith(".md")) {
      const t = bytes ? await this.indexTopic(file) : null;
      if (t) this.emit({ kind: "topic", id: t.id });
      else {
        const gone = [...this.topics].find(([, f]) => f === file);
        if (gone) {
          this.topics.delete(gone[0]);
          this.emit({ kind: "topic", id: gone[0], removed: true });
        }
      }
    } else if (parts[0] === "inbox" && parts.length === 2) {
      this.emit({ kind: "inbox" });
    } else if (parts[0] === "hub" && parts[1] === "placements" && parts.length === 3 && rel.endsWith(".json")) {
      this.emit({ kind: "placement", board: path.basename(rel, ".json") });
    } else if (rel === "hub/notices.jsonl") {
      this.emit({ kind: "notice" });
    } else if (rel === "hub/relations.jsonl") {
      this.emit({ kind: "relation" });
    } else if (rel === "hub/bearings.jsonl") {
      this.emit({ kind: "bearing" });
    } else if (rel === "hub/jobs.jsonl") {
      this.emit({ kind: "job" });
    } else if (rel === "hub/steps.jsonl") {
      this.emit({ kind: "step" });
    } else if (parts[0] === "hub" && parts[1] === "goals" && parts.length === 3 && rel.endsWith(".json")) {
      this.emit({ kind: "goalwork", goal: path.basename(rel, ".json") });
    } else if (parts[0] === "hub" && parts[1] === "maps" && parts.length === 3 && rel.endsWith(".md")) {
      this.emit({ kind: "map", key: path.basename(rel, ".md"), ...(bytes ? {} : { removed: true }) });
    } else if (rel === "about.md") {
      this.emit({ kind: "about" });
    } else if (rel === GOALS) {
      this.emit({ kind: "goal" });
    } else if (rel === "org.json" && bytes) {
      const info = await readJson<OrgInfo>(file);
      if (info?.qalam === "org/1" && info.id === this.org.id && stableStringify(info) !== stableStringify(this.org)) {
        this.org = info;
        this.emit({ kind: "org" });
      }
    } else if (parts[0] === "assets" && parts.length === 2) {
      const hash = parts[1].replace(/\.[^.]+$/, "");
      if (bytes) this.assets.set(hash, file);
      else this.assets.delete(hash);
    }
  }
}

/** The cards a batch decision touched (accepting or discarding Qalam AI's proposals). */
const cardsOf = (d: Decision): unknown[] => (Array.isArray(d.detail?.cards) ? (d.detail.cards as unknown[]) : []);
