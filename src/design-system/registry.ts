import { create } from "zustand";
import type { Doc } from "@/doc/schema";
import raw from "./tokens.json";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { upgradeTree } from "./contract";
import { BUILTIN_DOCS, type DesignDocs } from "./docs";
import { withPatternProps } from "./component-props";
import { orgFetch, orgJson } from "@/org/client";
import type { Provenance } from "@/knowledge/types";
import type { Knobs } from "./interview/knobs";

/**
 * Design systems the studio knows about. Every system fills the same role contract (see
 * contract.ts), so any screen can be built with, or moved to, any system. The active system is
 * what new work uses; each root frame records the system it is bound to in `meta.designSystem`.
 */

export const BUILTIN_ID = "builtin";

export interface FontRef {
  family: string;
  /** Closest Google Font, loaded at runtime when the family isn't bundled. */
  googleFont?: string;
  weights?: number[];
}

export interface DesignSystem {
  id: string;
  name: string;
  /**
   * "interview": generated from a design-system project's brand interview. "freeform": the look
   * Qalam AI picked for screens generated without a design system (see freeform.ts).
   */
  source: "builtin" | "extracted" | "imported" | "interview" | "freeform";
  /** Complete, standalone DTCG tree. */
  tree: Tree;
  docs: DesignDocs;
  fonts: FontRef[];
  /** Small data URL of the source image. */
  thumbnail?: string;
  /** "asset:" references of the screenshots it was extracted from: the visual reference for AI work. */
  sources?: string[];
  /** Adjustments the converter made to the model's output (contrast fixes, snapped colours…). */
  notes?: string[];
  /** The project that made it: a design-system project (interview systems), or the Screens project a look was picked in. */
  projectId?: string;
  /** Looks: what Qalam AI picked and why; code built the tokens from these knobs. */
  look?: { rationale: string; knobs: Knobs };
  /** Looks: the designer saved it as a design system, so the pickers list it. */
  kept?: boolean;
  /** Where its facts came from when it isn't the system's own source (a rule Tune added, one you edited), by fact key. */
  provenance?: Record<string, Provenance>;
  /** The system it was copied from (a built-in system's first edit makes a copy). */
  forkedFrom?: string;
  createdAt: number;
  updatedAt: number;
}

export const BUILTIN_SYSTEM: DesignSystem = {
  id: BUILTIN_ID,
  name: "Qalam",
  source: "builtin",
  tree: raw as Tree,
  docs: BUILTIN_DOCS,
  fonts: [{ family: "Inter" }, { family: "IBM Plex Sans Arabic" }, { family: "Plus Jakarta Sans" }],
  createdAt: 0,
  updatedAt: 0,
};

interface RegistryState {
  systems: DesignSystem[];
  activeId: string;
  /** Generate without a design system: Qalam AI picks each new screen's look (per project, see Studio). */
  freeform: boolean;
  add: (ds: DesignSystem, activate?: boolean) => void;
  update: (id: string, patch: Partial<Omit<DesignSystem, "id" | "source">>) => void;
  remove: (id: string) => void;
  setActive: (id: string) => void;
  setFreeform: (on: boolean) => void;
}

/**
 * Design systems belong to the organization: one file each in its design-systems/ folder. They
 * load once when a window opens (hydrateSystems, before anything is drawn); after that each
 * changed system is written on its own and a removed one is deleted. Which system is active is
 * this window's choice, remembered per organization on this computer.
 */
const activeKey = (orgId: string) => `qalam/active-system/${orgId}`;

/** Systems saved before the contract grew get the new tokens, and their own components get props. */
const upgrade = (s: DesignSystem): DesignSystem => ({ ...s, tree: upgradeTree(s.tree), docs: withPatternProps(s.docs) });

/** The systems as they are in the organization's folder (by id): what changed since is written. */
let saved = new Map<string, DesignSystem>();
let orgId: string | null = null;

const initial = { systems: [] as DesignSystem[], activeId: BUILTIN_ID };

export const useSystems = create<RegistryState>((set, get) => ({
  systems: [BUILTIN_SYSTEM, ...initial.systems],
  activeId: initial.activeId,
  freeform: false,
  add: (ds, activate = true) => set({ systems: [...get().systems.filter((s) => s.id !== ds.id), { ...ds, docs: withPatternProps(ds.docs) }], ...(activate ? { activeId: ds.id } : {}) }),
  update: (id, patch) =>
    set({ systems: get().systems.map((s) => (s.id === id && s.source !== "builtin" ? { ...s, ...patch, ...(patch.docs ? { docs: withPatternProps(patch.docs) } : {}), updatedAt: Date.now() } : s)) }),
  remove: (id) => {
    if (id === BUILTIN_ID) return;
    set({ systems: get().systems.filter((s) => s.id !== id), activeId: get().activeId === id ? BUILTIN_ID : get().activeId });
  },
  setActive: (activeId) => {
    if (get().systems.some((s) => s.id === activeId)) set({ activeId });
  },
  setFreeform: (freeform) => set({ freeform }),
}));

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persisting: Promise<void> = Promise.resolve();

/** Write what changed since the last write: each changed system, and the removal of each one gone. */
function persist(): Promise<void> {
  clearTimeout(persistTimer);
  const { systems, activeId } = useSystems.getState();
  if (!orgId) return persisting;
  try {
    window.localStorage.setItem(activeKey(orgId), activeId);
  } catch {
    /* storage unavailable: the active system resets next time */
  }
  const now = new Map(systems.filter((x) => x.source !== "builtin").map((x) => [x.id, x]));
  const changed = [...now.values()].filter((x) => saved.get(x.id) !== x);
  const gone = [...saved.keys()].filter((id) => !now.has(id));
  saved = now;
  if (!changed.length && !gone.length) return persisting;
  persisting = persisting.then(async () => {
    for (const x of changed) await orgFetch(`/systems/${x.id}`, { method: "PUT", json: x }).catch(() => {});
    for (const id of gone) await orgFetch(`/systems/${id}`, { method: "DELETE" }).catch(() => {});
  });
  return persisting;
}

/** Load the organization's design systems (before anything that draws with them). */
export async function hydrateSystems(org: string) {
  const list = await orgJson<DesignSystem[]>("/systems").catch(() => [] as DesignSystem[]);
  const systems = list.filter((x) => x && x.id && x.tree).map(upgrade);
  let activeId: string = BUILTIN_ID;
  try {
    activeId = window.localStorage.getItem(activeKey(org)) ?? BUILTIN_ID;
  } catch {
    /* storage unavailable */
  }
  orgId = org;
  saved = new Map(systems.map((x) => [x.id, x]));
  useSystems.setState({ systems: [BUILTIN_SYSTEM, ...systems], activeId: systems.some((x) => x.id === activeId) ? activeId : BUILTIN_ID });
}

/** The organization's systems changed elsewhere (another window, the folder): load them again, keeping what's open here. */
export async function reloadSystems() {
  if (!orgId) return;
  const list = await orgJson<DesignSystem[]>("/systems").catch(() => null);
  if (!list) return;
  const systems = list.filter((x) => x && x.id && x.tree).map(upgrade);
  saved = new Map(systems.map((x) => [x.id, x]));
  const { activeId } = useSystems.getState();
  useSystems.setState({ systems: [BUILTIN_SYSTEM, ...systems], activeId: systems.some((x) => x.id === activeId) ? activeId : BUILTIN_ID });
}

/**
 * Drop a project's looks that no screen uses any more (deleted screens, a stopped run), unless the
 * designer saved them. Run when the project opens, before there is any undo history to restore them.
 */
export function pruneLooks(projectId: string, used: ReadonlySet<string>) {
  const { systems } = useSystems.getState();
  const keep = systems.filter((s) => s.source !== "freeform" || s.kept || s.projectId !== projectId || used.has(s.id));
  if (keep.length !== systems.length) useSystems.setState({ systems: keep });
}

/** Write the systems now (before the page reloads or navigates). */
export const flushSystems = (): Promise<void> => (typeof window !== "undefined" ? persist() : Promise.resolve());

if (typeof window !== "undefined") {
  // Debounced: component edits can change a system many times a second while scrubbing.
  useSystems.subscribe((s, prev) => {
    if (s.systems === prev.systems && s.activeId === prev.activeId) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 250);
  });
}

// ---------------------------------------------------------------------------

export function getSystem(id: string | undefined): DesignSystem | undefined {
  if (!id || id === BUILTIN_ID) return BUILTIN_SYSTEM;
  return useSystems.getState().systems.find((s) => s.id === id);
}

/** The system with this id, or the built-in one when it is missing (e.g. deleted). */
export function systemFor(id: string | undefined): DesignSystem {
  return getSystem(id) ?? BUILTIN_SYSTEM;
}

/** Keyed by the tree itself: every edit makes a new one, and two edits can share a millisecond (updatedAt). */
const sets = new Map<string, { tree: Tree; ts: TokenSet }>();
export function tokenSetFor(id: string | undefined): TokenSet {
  const ds = getSystem(id);
  if (!ds || ds.id === BUILTIN_ID) return BUILTIN;
  const hit = sets.get(ds.id);
  if (hit && hit.tree === ds.tree) return hit.ts;
  const ts = new TokenSet(ds.tree);
  sets.set(ds.id, { tree: ds.tree, ts });
  return ts;
}

/** Where a system came from, as the system pickers label it. */
export const sourceLabel = (s: Pick<DesignSystem, "source">) =>
  s.source === "builtin" ? "Built-in" : s.source === "imported" ? "Edited copy" : s.source === "interview" ? "From a brief" : s.source === "freeform" ? "Saved look" : "Extracted";

export const activeSystem = () => systemFor(useSystems.getState().activeId);
export const activeTokens = () => tokenSetFor(useSystems.getState().activeId);

/** The system a node is bound to: its root frame's, else the built-in one. */
export function dsIdForNode(doc: Doc, id: string): string {
  let n = doc.nodes[id];
  while (n?.parentId) n = doc.nodes[n.parentId];
  const ds = n?.meta.designSystem;
  return ds && getSystem(ds) ? ds : BUILTIN_ID;
}

export const tokensForNode = (doc: Doc, id: string) => tokenSetFor(dsIdForNode(doc, id));

export function useActiveSystem(): DesignSystem {
  return useSystems((s) => s.systems.find((x) => x.id === s.activeId) ?? BUILTIN_SYSTEM);
}
