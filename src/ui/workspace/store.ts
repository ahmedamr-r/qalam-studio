import { create } from "zustand";
import type { Tier } from "@/design-system/edit";

/**
 * The big editors that open over the canvas (Figma's variables modal): the token editor and the
 * component library. They open as a large modal and can go full screen; the size is remembered.
 */

export type WorkspaceKind = "tokens" | "components" | "knowledge";
export type WorkspaceSize = "modal" | "full";

/** What the token editor lists: everything, a tier, a group, or one of the written guides. */
export type TokenScope =
  { kind: "all" } | { kind: "tier"; tier: Tier } | { kind: "group"; tier: Tier; group: string } | { kind: "doc"; doc: "type" | "shape" | "effects" | "language" | "layout" | "contrast" };

/** A node to select in the Knowledge hub (a fact's or decision's ref), with a stamp so opening it twice focuses again. */
export interface KnowledgeFocus {
  ref: string;
  at: number;
  /** The decision's time, when it may be older than the graph's window (the timeline moves back to it). */
  asOf?: number;
}

interface WorkspaceState {
  kind: WorkspaceKind | null;
  size: WorkspaceSize;
  /** The system on show; null follows the active one. */
  systemId: string | null;
  scope: TokenScope;
  /** Component library: the catalog component or pattern on show. */
  component: string | null;
  /** Knowledge hub: what to select and show when it opens (a decision's "Why?", a fact). */
  knowledgeFocus: KnowledgeFocus | null;
  open: (kind: WorkspaceKind, opts?: { component?: string; scope?: TokenScope; systemId?: string; focus?: KnowledgeFocus }) => void;
  close: () => void;
  setSize: (size: WorkspaceSize) => void;
}

const SIZE_KEY = "qalam/workspace-size/v1";

function savedSize(): WorkspaceSize {
  try {
    return window.localStorage.getItem(SIZE_KEY) === "full" ? "full" : "modal";
  } catch {
    return "modal";
  }
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  kind: null,
  size: "modal",
  systemId: null,
  scope: { kind: "all" },
  component: null,
  knowledgeFocus: null,
  open: (kind, opts) =>
    set((s) => ({
      kind,
      size: s.kind ? s.size : savedSize(),
      ...(opts?.component !== undefined ? { component: opts.component } : {}),
      ...(opts?.scope ? { scope: opts.scope } : {}),
      ...(opts?.systemId !== undefined ? { systemId: opts.systemId } : {}),
      ...(kind === "knowledge" ? { knowledgeFocus: opts?.focus ?? null } : {}),
    })),
  close: () => set({ kind: null }),
  setSize: (size) => {
    try {
      window.localStorage.setItem(SIZE_KEY, size);
    } catch {
      /* the size lasts for this session */
    }
    set({ size });
  },
}));

export const openWorkspace = (kind: WorkspaceKind, opts?: Parameters<WorkspaceState["open"]>[1]) => useWorkspace.getState().open(kind, opts);
